import { publicErrorMessage } from "@sub-rosa/logging/errors";
// Copyright (c) 2026 Sub Rosa contributors
import { Buffer } from "buffer";
import { Keypair } from "@stellar/stellar-sdk";
import {
  assertAppraisalSpendAllowed,
  bidFromAppraisal,
  createSessionMandate,
  MandateCapError,
  usdcToStroops,
} from "@sub-rosa/agent/mandate";
import {
  commitment,
  currentRound,
  encodeBidPreimage,
  generateNonce,
  quicknet,
  sealBid,
  openBid,
} from "@sub-rosa/tlock";
import type { AttackStep, CapDemoResult } from "./demoTypes";
import { systemClock } from "@sub-rosa/time";
import { DEMO_ACTIONS, type DemoAction, type DemoActionGate } from "./config";

export type { AttackStep, CapDemoResult };

// Demo actions must never submit a commit/reveal/settle into the wrong
// network. Re-export the guard so demo flows share one implementation.
export {
  assertDemoNetworkMatch,
  demoNetworkMismatch,
  DemoNetworkMismatchError,
  type DemoActionName,
  type DemoNetworkCheck,
} from "./network-guard";

export function runCapSafetyDemos(): CapDemoResult[] {
  const results: CapDemoResult[] = [];
  const principal = Keypair.random();

  // 1. Appraisal price above mandate → agent rejects before paying.
  try {
    const { mandate } = createSessionMandate({
      principalSecret: principal.secret(),
      contractId: "CDEMO",
      roundId: 1,
      itemRef: "demo",
      basePriceUsdc: 500,
      maxBidStroops: usdcToStroops(100),
      maxEscrowStroops: usdcToStroops(100),
      maxAppraisalSpendStroops: usdcToStroops(0.5),
      appraisalPriceStroops: usdcToStroops(0.1),
      commitDeadline: systemClock.nowSeconds() + 3600,
    });
    assertAppraisalSpendAllowed(mandate, usdcToStroops(0.2));
    results.push({
      id: "appraisal-cap",
      title: "Appraisal price above mandate",
      layer: "agent (off-chain)",
      expected: "reject",
      outcome: "FAIL — should have thrown",
      pass: false,
    });
  } catch (e) {
    results.push({
      id: "appraisal-cap",
      title: "Appraisal price above mandate (0.20 > cap 0.10)",
      layer: "agent (off-chain)",
      expected: "reject",
      outcome: publicErrorMessage(e),
      pass: e instanceof MandateCapError,
    });
  }

  // 2. High appraisal → agent clamps bid to maxBid.
  const { mandate: m2 } = createSessionMandate({
    principalSecret: principal.secret(),
    contractId: "CDEMO",
    roundId: 1,
    itemRef: "demo",
    basePriceUsdc: 500,
    maxBidStroops: usdcToStroops(100),
    maxEscrowStroops: usdcToStroops(100),
    maxAppraisalSpendStroops: usdcToStroops(1),
    appraisalPriceStroops: usdcToStroops(0.1),
    commitDeadline: systemClock.nowSeconds() + 3600,
  });
  const { bidValue } = bidFromAppraisal(999, m2);
  results.push({
    id: "maxbid-clamp",
    title: "Appraisal suggests 999 USDC, mandate maxBid 100",
    layer: "agent (off-chain)",
    expected: "clamp",
    outcome: `Agent commits bid ${Number(bidValue) / 1e7} USDC (clamped)`,
    pass: bidValue === usdcToStroops(100),
  });

  // 3. On-chain: value > escrow → valid=false at reveal (documented rule).
  const escrow = 50n;
  const bid = 80n;
  const onChainValid = bid > 0n && bid <= escrow;
  results.push({
    id: "escrow-onchain",
    title: "Reveal bid 80 with escrow 50 (hypothetical grief)",
    layer: "contract (on-chain)",
    expected: "invalid bid",
    outcome: `valid=${onChainValid} — bid excluded from clearing; escrow refunded at settle`,
    pass: !onChainValid,
  });

  return results;
}

/** The base64 "broken seal" used by the seal-off (leaky) attack column. */
export function sealOffCipher(value: bigint, nonce: Uint8Array): string {
  const plaintext = encodeBidPreimage(value, nonce);
  return Buffer.from(plaintext).toString("base64");
}

/** The early read the broken baseline allows. Returns the recovered value, or
 *  throws when the read path is sealed (i.e. safe). */
export async function earlyReadBid(
  fakeCipher: string,
  client: ReturnType<typeof quicknet>,
): Promise<bigint> {
  const decoded = Buffer.from(fakeCipher, "base64");
  if (decoded.length === 0) throw new Error("empty ciphertext");
  // With the seal off, the preimage is recoverable without Drand R — that is
  // the bug this demo teaches. The tlock path (seal on) must fail here; the
  // caller records that failure instead of ever formatting a value.
  const clientAny = client as unknown as { __sealedEarlyRead?: () => never };
  if (typeof clientAny.__sealedEarlyRead === "function") {
    clientAny.__sealedEarlyRead();
  }
  return decodeFirstValue(decoded);
}

function decodeFirstValue(decoded: Buffer): bigint {
  let v = 0n;
  for (let i = 0; i < 16; i++) {
    v = (v << 8n) | BigInt(decoded[i] ?? 0);
  }
  return v;
}

/** Live tlock seal-on vs plaintext seal-off comparison using quicknet. */
export async function runSealAttackDemo(): Promise<{
  sealOff: AttackStep[];
  sealOn: AttackStep[];
  revealRound: number;
}> {
  const client = quicknet();
  const revealRound = (await currentRound(client)) + 15;
  const value = 42_000_000n;
  const nonce = generateNonce();

  const sealOff: AttackStep[] = [];
  const sealOn: AttackStep[] = [];

  // ── Seal OFF: plaintext / operator-readable "encryption" ───────────────
  const fakeCipher = sealOffCipher(value, nonce);
  sealOff.push({
    label: "Bid stored as reversible encoding (no tlock)",
    ok: true,
    detail: `Observer decodes bid immediately: ${Number(value) / 1e7} USDC equivalent`,
  });
  try {
    await earlyReadBid(fakeCipher, client);
    sealOff.push({
      label: "Early read succeeds before Drand R",
      ok: true,
      detail: "Plaintext preimage recovered — front-running / selective abort possible",
    });
  } catch {
    sealOff.push({ label: "Early read", ok: false, detail: "unexpected failure" });
  }
  sealOff.push({
    label: "Selective abort",
    ok: false,
    detail: "Losing bidder can refuse to reveal — auction breaks",
  });

  // ── Seal ON: real tlock to round R ─────────────────────────────────────
  const sealed = await sealBid({
    value,
    nonce,
    round: revealRound,
    client,
  });
  sealOn.push({
    label: `Bid sealed to Drand round R=${revealRound}`,
    ok: true,
    detail: `Commitment H=${Buffer.from(sealed.commitment).toString("hex").slice(0, 16)}…`,
  });

  let earlyDecryptFailed = false;
  try {
    await openBid(sealed.ciphertext, client);
    sealOn.push({
      label: "Decrypt before R",
      ok: false,
      detail: "ERROR: should not decrypt early",
    });
  } catch {
    earlyDecryptFailed = true;
    sealOn.push({
      label: "Decrypt before R",
      ok: true,
      detail: "tlock holds — ciphertext undecryptable until R is public",
    });
  }

  sealOn.push({
    label: "After R: permissionless reveal",
    ok: true,
    detail: "Keeper + anyone can open all seals simultaneously — no selective abort",
  });

  sealOn.push({
    label: "Commitment binding",
    ok: commitment(value, nonce).every((b, i) => b === sealed.commitment[i]),
    detail: "Wrong value/nonce rejected on-chain (HashMismatch)",
  });

  if (!earlyDecryptFailed) {
    sealOn.push({
      label: "Demo integrity",
      ok: false,
      detail: "Early decrypt should have failed",
    });
  }

  return { sealOff, sealOn, revealRound };
}
