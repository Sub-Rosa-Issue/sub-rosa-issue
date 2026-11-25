import { normalizeError } from "@sub-rosa/logging/errors";
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("packages.sdk.scripts.mainnet-verify");
// Read-only mainnet proof checker — no transactions, no secrets required.
//
// Verifies the deployed Round contract and settled round 1 match frozen
// artifacts. The committed manifest is the source of truth: the deployment's
// contract id, network passphrase, wasm hash, and escrow token are compared
// against it before the settlement proof is accepted, so this script cannot
// pass against a different deployment than the one readiness pins.

import { rpc } from "@stellar/stellar-sdk";

import { SubRosaClient } from "../src/client.js";
import {
  loadMainnetReadinessFixture,
  loadMainnetManifest,
} from "../src/mainnet-manifest.js";
import {
  assertDeploymentMatches,
  fetchContractWasmHash,
  fixtureDeployment,
  fixtureReader,
  readLiveDeployment,
  verifySettledRoundProof,
} from "../src/mainnet-readiness.js";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/** Value that follows a flag, or undefined when it was passed bare. */
function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const next = process.argv[index + 1];
  return next !== undefined && !next.startsWith("--") ? next : undefined;
}

async function main() {
  const dryRun =
    process.argv.includes("--dry-run") || process.env.MAINNET_DRY_RUN === "1";
  // `--fixture` may be bare: replay the committed recording.
  // `--fixture` may be bare, in which case the committed recording is replayed.
  const replayFixture = hasFlag("--fixture");
  const fixturePath = replayFixture ? argValue("--fixture") : undefined;

  const loaded = loadMainnetManifest(hasFlag("--manifest") ? argValue("--manifest") : undefined);
  const manifest = loaded.manifest;

  diagnostics.info("sub-rosa-mainnet-settlement-proof-read-only", "Sub Rosa — mainnet settlement proof (read-only)\n");
  diagnostics.info("checklist", "Checklist:");
  diagnostics.info("contract-id-matches-frozen-artifact", "  [ ] Contract id matches frozen artifact");
  diagnostics.info("network-passphrase-matches-frozen-artifact", "  [ ] Network passphrase matches frozen artifact");
  diagnostics.info("wasm-hash-matches-frozen-artifact", "  [ ] Deployed wasm hash matches frozen artifact");
  diagnostics.info("token-contract-matches-frozen-artifact", "  [ ] Escrow token contract matches frozen artifact");
  diagnostics.info("round-1-status-is-settled", "  [ ] Round 1 status is Settled");
  diagnostics.info("drand-reveal-round-r-matches-artifact", "  [ ] Drand reveal round R matches artifact");
  diagnostics.info("bid-escrow-stroops-match-micro-smoke-amounts-1-5-xlm", "  [ ] Bid/escrow stroops match micro smoke amounts (1 / 5 XLM)");
  diagnostics.info("bidder-marked-valid-settled", "  [ ] Bidder marked valid + settled\n");

  const roundId = BigInt(process.env.ROUND_ID ?? String(manifest.settledRoundId));
  const expected = {
    bidStroops: manifest.bidStroops,
    escrowStroops: manifest.escrowStroops,
    revealRound: Number(manifest.revealRound),
  };

  if (replayFixture) {
    const { fixture, path } = loadMainnetReadinessFixture(fixturePath);
    diagnostics.info("fixture-mode", "Replaying a recorded deployment", {
      path,
      rpc: "none",
    });
    assertDeploymentMatches(manifest, fixtureDeployment(fixture), path);
    await verifySettledRoundProof(fixtureReader(fixture), roundId, expected);
    diagnostics.info("mainnet-verify-passed", "✅ MAINNET VERIFY PASSED (fixture)");
    return;
  }

  if (dryRun) {
    diagnostics.info("dry-run-would-read-rpc-only-re-run-without-dry-run-to-f", "DRY-RUN — would read RPC only. Re-run without --dry-run to fetch live state.\n");
    diagnostics.info("expected", "Expected:");
    diagnostics.info("progress", JSON.stringify(
      {
        contractId: manifest.contractId,
        networkPassphrase: manifest.networkPassphrase,
        wasmHash: manifest.wasmHash,
        tokenContract: manifest.tokenContract,
        roundId: manifest.settledRoundId,
        status: manifest.status,
        revealRound: manifest.revealRound,
        bidStroops: manifest.bidStroops.toString(),
        escrowStroops: manifest.escrowStroops.toString(),
      },
      null,
      2,
    ));
    return;
  }

  const rpcUrl = process.env.RPC_URL ?? manifest.rpcUrl;
  const networkPassphrase = process.env.NETWORK_PASSPHRASE ?? manifest.networkPassphrase;
  const contractId = process.env.ROUND_CONTRACT_ID ?? manifest.contractId;

  const reader = new SubRosaClient({
    rpcUrl,
    networkPassphrase,
    contractId,
    publicKey: process.env.MAINNET_READER_PUBKEY ?? "GCDARJFKKSTJYAZC647H4ZSSSPXPPSKOWOHGMUNCT22VG74KXZ5BHVNR",
  });

  const server = new rpc.Server(rpcUrl);
  const live = await readLiveDeployment(
    reader,
    server,
    contractId,
    (id) => fetchContractWasmHash(server, id),
  );
  const comparison = assertDeploymentMatches(manifest, live, loaded.path);
  diagnostics.info("deployment-matches-manifest", "Deployment matches the committed manifest", {
    contractId: live.contractId ?? null,
    wasmHash: live.wasmHash ?? null,
    tokenContract: live.tokenContract ?? null,
    fields: comparison.fields.map((f) => f.field).join(","),
  });

  await verifySettledRoundProof(reader, roundId, expected);

  diagnostics.info("mainnet-verify-passed", "✅ MAINNET VERIFY PASSED");
  diagnostics.info("contract", "   contract:", { "value1_0": contractId });
  diagnostics.info("round", "   round:   ", { "value1_0": roundId.toString(), "value2_1": "status:", "status_2": manifest.status });
  diagnostics.info("r", "   R:       ", { "value1_0": manifest.revealRound.toString() });
  diagnostics.info("bid", "   bid:     ", { "bidXlm_0": manifest.bidXlm, "value2_1": "XLM" });
  diagnostics.info("escrow", "   escrow:  ", { "escrowXlm_0": manifest.escrowXlm, "value2_1": "XLM" });
  diagnostics.info("token", "   token:   ", { "value1_0": manifest.tokenContract, "value2_1": "label:", "label_2": manifest.escrowToken });
}

main().catch((err) => {
  diagnostics.error("mainnet-verify-failed", "\n❌ MAINNET VERIFY FAILED");
  diagnostics.error("progress-2", normalizeError(err));
  process.exit(1);
});
