// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { BidState, GlobalConfig, Round } from "@sub-rosa/round-bindings";

import { SubRosaDeploymentMismatchError } from "./errors.js";
import {
  loadMainnetManifest,
  loadMainnetReadinessFixture,
} from "./mainnet-manifest.js";
import {
  MAINNET_ARTIFACTS,
  MAINNET_MANIFEST,
  MAINNET_MICRO_MAX_ESCROW,
  MAINNET_XLM_SAC_ID,
  parseMainnetManifest,
  type MainnetManifest,
} from "./mainnet-artifacts.js";
import {
  assertDeploymentMatches,
  assertMainnetConfirmed,
  assertMicroAmounts,
  assertReadinessForExecute,
  compareDeployment,
  defaultMainnetReadinessInput,
  fixtureDeployment,
  hasBlockingFailures,
  parseMainnetReadinessFixture,
  runMainnetReadiness,
  summarizeDeploymentValue,
  verifySettledRoundProof,
  type MainnetLiveDeployment,
  type MainnetReadinessDeps,
  type MainnetReadinessFixture,
  type ReadinessReader,
} from "./mainnet-readiness.js";
import { MAINNET_CONFIRM_PHRASE } from "./mainnet-artifacts.js";

const mockRpc = (
  balance = "1000000000",
  overrides: Partial<NonNullable<MainnetReadinessDeps["rpc"]>> = {},
): NonNullable<MainnetReadinessDeps["rpc"]> =>
  ({
    getHealth: async () => ({ status: "healthy", latestLedger: 123, ledgerRetentionWindow: 1000, oldestLedger: 1 }),
    getLatestLedger: async () => ({ sequence: 123 }),
    getLedgerEntries: async () => ({ entries: [], latestLedger: 123 }),
    getAccountEntry: async () =>
      ({ balance: () => ({ toString: () => balance }) }),
    getNetwork: async () => ({ passphrase: MAINNET_MANIFEST.networkPassphrase, protocolVersion: "22" }),
    simulateTransaction: async () => ({ result: { retval: 0n } }),
    ...overrides,
  }) as unknown as NonNullable<MainnetReadinessDeps["rpc"]>;

const CONTRACT_ID = MAINNET_MANIFEST.contractId;
const BIDDER = "GBIDDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const settledRound = {
  auditor_pubkey: Buffer.alloc(32),
  bidders: [BIDDER],
  clearing_rule: { tag: "HighestBid", values: undefined },
  commit_deadline: 100n,
  item_ref: Buffer.alloc(32),
  operator: "GOPERATOR",
  reveal_deadline: 1_000n,
  reveal_round: BigInt(MAINNET_MANIFEST.revealRound),
  status: { tag: "Settled", values: undefined },
  winner: BIDDER,
  winning_bid: MAINNET_MANIFEST.bidStroops,
} as Round;

const settledBidState: BidState = {
  commitment: Buffer.alloc(32),
  escrow: MAINNET_MANIFEST.escrowStroops,
  revealed_nonce: Buffer.alloc(32),
  revealed_value: MAINNET_MANIFEST.bidStroops,
  settled: true,
  valid: true,
};

const mockReader = (
  overrides: Partial<ReadinessReader> = {},
): ReadinessReader => ({
  contractId: CONTRACT_ID,
  networkPassphrase: MAINNET_MANIFEST.networkPassphrase,
  getConfig: async () => ({ usdc: MAINNET_XLM_SAC_ID }) as unknown as GlobalConfig,
  getRound: async () => settledRound,
  getBidders: async () => [BIDDER],
  getBidState: async () => settledBidState,
  ...overrides,
});

/** A recorded deployment that matches the committed manifest exactly. */
const committedFixture = (): MainnetReadinessFixture => {
  const { fixture } = loadMainnetReadinessFixture();
  return fixture;
};

const matchingLive = (): MainnetLiveDeployment => ({
  contractId: MAINNET_MANIFEST.contractId,
  networkPassphrase: MAINNET_MANIFEST.networkPassphrase,
  wasmHash: MAINNET_MANIFEST.wasmHash,
  tokenContract: MAINNET_MANIFEST.tokenContract,
});

const fixtureRun = async (fixture: MainnetReadinessFixture) =>
  runMainnetReadiness(
    defaultMainnetReadinessInput({ fixture, manifestSource: "fixture" }),
  );

describe("assertMainnetConfirmed", () => {
  it("accepts the required confirmation phrase", () => {
    assert.doesNotThrow(() =>
      assertMainnetConfirmed({ MAINNET_CONFIRM: MAINNET_CONFIRM_PHRASE }),
    );
  });

  it("rejects missing or wrong confirmation", () => {
    assert.throws(() => assertMainnetConfirmed({}), /MAINNET_CONFIRM/);
    assert.throws(
      () => assertMainnetConfirmed({ MAINNET_CONFIRM: "yes" }),
      /MAINNET_CONFIRM/,
    );
  });
});

describe("assertMicroAmounts", () => {
  it("accepts micro amounts within the escrow cap", () => {
    assert.doesNotThrow(() => assertMicroAmounts(500_000n, 1_000_000n));
  });

  it("rejects bid above escrow or above cap", () => {
    assert.throws(
      () => assertMicroAmounts(2_000_000n, 1_000_000n),
      /cannot exceed escrow/,
    );
    assert.throws(
      () => assertMicroAmounts(1n, MAINNET_MICRO_MAX_ESCROW + 1n),
      /exceeds MAINNET_MICRO_MAX_ESCROW/,
    );
  });
});

describe("committed manifest", () => {
  it("parses the committed file into the in-module manifest", () => {
    const { manifest, path, sha256 } = loadMainnetManifest();
    assert.equal(path.replaceAll("\\", "/").endsWith("packages/sdk/mainnet-artifacts.json"), true);
    assert.match(sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(manifest, MAINNET_MANIFEST);
  });

  it("keeps MAINNET_ARTIFACTS and the manifest in step", () => {
    assert.equal(MAINNET_MANIFEST.contractId, MAINNET_ARTIFACTS.contractId);
    assert.equal(MAINNET_MANIFEST.wasmHash, MAINNET_ARTIFACTS.wasmHash);
    assert.equal(MAINNET_MANIFEST.networkPassphrase, MAINNET_ARTIFACTS.networkPassphrase);
    assert.equal(MAINNET_MANIFEST.bidStroops, MAINNET_ARTIFACTS.bidStroops);
    assert.equal(MAINNET_MANIFEST.settledRoundId, BigInt(MAINNET_ARTIFACTS.settledRoundId));
    assert.equal(MAINNET_MANIFEST.tokenContract, MAINNET_XLM_SAC_ID);
  });

  it("is idempotent, so a parsed manifest can be re-validated", () => {
    assert.deepEqual(parseMainnetManifest(MAINNET_MANIFEST), MAINNET_MANIFEST);
  });

  it("rejects an unknown field so a typo cannot skip a comparison", () => {
    const raw = { ...MAINNET_MANIFEST, wasmHashh: MAINNET_MANIFEST.wasmHash };
    assert.throws(
      () => parseMainnetManifest(raw),
      /unknown field/,
    );
  });

  it("rejects malformed deployment identity fields", () => {
    assert.throws(
      () => parseMainnetManifest({ ...MAINNET_MANIFEST, contractId: "CA7KSDEY" }),
      /contractId/,
    );
    assert.throws(
      () => parseMainnetManifest({ ...MAINNET_MANIFEST, wasmHash: "not-a-hash" }),
      /wasmHash/,
    );
    assert.throws(
      () => parseMainnetManifest({ ...MAINNET_MANIFEST, tokenContract: "USDC" }),
      /tokenContract/,
    );
    assert.throws(
      () => parseMainnetManifest({ ...MAINNET_MANIFEST, rpcUrl: "http://rpc.example" }),
      /https/,
    );
    assert.throws(
      () => parseMainnetManifest({ ...MAINNET_MANIFEST, bidStroops: "60000000" }),
      /bid cannot exceed escrow/,
    );
  });

  it("rejects a manifest that is not an object", () => {
    assert.throws(() => parseMainnetManifest([]), /JSON object/);
    assert.throws(() => parseMainnetManifest(null), /JSON object/);
  });
});

describe("summarizeDeploymentValue", () => {
  it("prints public identifiers verbatim", () => {
    assert.equal(
      summarizeDeploymentValue("contractId", MAINNET_MANIFEST.contractId),
      MAINNET_MANIFEST.contractId,
    );
    assert.equal(
      summarizeDeploymentValue("wasmHash", MAINNET_MANIFEST.wasmHash),
      MAINNET_MANIFEST.wasmHash,
    );
  });

  it("fingerprints a passphrase instead of echoing it", () => {
    const summary = summarizeDeploymentValue(
      "networkPassphrase",
      MAINNET_MANIFEST.networkPassphrase,
    );
    assert.equal(summary.includes(MAINNET_MANIFEST.networkPassphrase), false);
    assert.match(summary, /passphrase fingerprint [0-9a-f]{12}/);
  });

  it("redacts anything shaped like a Stellar secret key", () => {
    const secret = `S${"A".repeat(55)}`;
    const summary = summarizeDeploymentValue("networkPassphrase", secret);
    assert.equal(summary, "<redacted: secret-key-like>");
    assert.equal(summary.includes(secret), false);
  });

  it("marks missing values as unread", () => {
    assert.equal(summarizeDeploymentValue("wasmHash", null), "<unread>");
  });
});

describe("compareDeployment", () => {
  it("matches every field of a matching deployment", () => {
    const comparison = compareDeployment(MAINNET_MANIFEST, matchingLive());
    assert.equal(comparison.matched, true);
    assert.deepEqual(comparison.mismatched, []);
    assert.equal(comparison.mismatchedFieldNames, "");
  });

  it("normalises hash and contract id case", () => {
    const comparison = compareDeployment(MAINNET_MANIFEST, {
      ...matchingLive(),
      wasmHash: MAINNET_MANIFEST.wasmHash.toUpperCase(),
      contractId: MAINNET_MANIFEST.contractId.toLowerCase(),
    });
    assert.equal(comparison.matched, true);
  });

  const mismatches: Array<{
    field: keyof MainnetLiveDeployment;
    value: string;
    expected: string;
  }> = [
    {
      field: "contractId",
      value: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      expected: "contractId",
    },
    {
      field: "networkPassphrase",
      value: "Test SDF Network ; September 2015",
      expected: "networkPassphrase",
    },
    {
      field: "wasmHash",
      value: "deadbeef".repeat(8),
      expected: "wasmHash",
    },
    {
      field: "tokenContract",
      value: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      expected: "tokenContract",
    },
  ];

  for (const { field, value, expected } of mismatches) {
    it(`flags a mismatched ${expected}`, () => {
      const comparison = compareDeployment(MAINNET_MANIFEST, {
        ...matchingLive(),
        [field]: value,
      });
      assert.equal(comparison.matched, false);
      assert.deepEqual(comparison.mismatchedFieldNames, expected);
      assert.equal(comparison.mismatched[0]?.ok, false);
    });
  }

  it("never reports an unreadable field as a match", () => {
    const comparison = compareDeployment(MAINNET_MANIFEST, {
      ...matchingLive(),
      tokenContract: null,
    });
    assert.equal(comparison.matched, false);
    assert.equal(comparison.unreadable.length, 1);
    assert.equal(comparison.unreadable[0]?.field, "tokenContract");
    assert.equal(comparison.unreadable[0]?.actual, null);
  });
});

describe("assertDeploymentMatches", () => {
  it("passes on a matching deployment and names the field on mismatch", () => {
    assert.doesNotThrow(() =>
      assertDeploymentMatches(MAINNET_MANIFEST, matchingLive(), "manifest.json"),
    );
    try {
      assertDeploymentMatches(
        MAINNET_MANIFEST,
        { ...matchingLive(), wasmHash: "deadbeef".repeat(8) },
        "mainnet-artifacts.json",
      );
      assert.fail("expected a mismatch");
    } catch (err) {
      assert.ok(err instanceof SubRosaDeploymentMismatchError);
      assert.deepEqual(err.fields, ["wasmHash"]);
      assert.equal(err.manifestSource, "mainnet-artifacts.json");
      assert.match(err.message, /wasmHash/);
    }
  });
});

describe("runMainnetReadiness — fixture mode (no mainnet RPC)", () => {
  it("passes with the committed fixture", async () => {
    const report = await fixtureRun(committedFixture());
    assert.equal(report.mode, "fixture");
    assert.equal(report.blockCount, 0);
    assert.equal(hasBlockingFailures(report.checks), false);
    assert.equal(report.deployment?.matched, true);
    assert.equal(report.passCount >= 6, true);
  });

  it("never touches the injected dependencies", async () => {
    const boom = async (): Promise<never> => {
      throw new Error("no RPC in fixture mode");
    };
    const report = await runMainnetReadiness(
      defaultMainnetReadinessInput({ fixture: committedFixture() }),
      {
        rpc: {
          getHealth: boom,
          getLatestLedger: boom,
          getLedgerEntries: boom,
          getAccountEntry: boom,
          getNetwork: boom,
          simulateTransaction: boom,
        } as unknown as NonNullable<MainnetReadinessDeps["rpc"]>,
        reader: {
          getRound: boom,
          getBidders: boom,
          getBidState: boom,
          getConfig: boom,
        } as unknown as ReadinessReader,
        fetchWasmHash: boom,
        sacBalance: boom,
      },
    );
    assert.equal(report.mode, "fixture");
    assert.equal(report.blockCount, 0);
  });

  const fieldMutations: Array<{
    name: string;
    checkId: string;
    field: string;
    mutate: (f: MainnetReadinessFixture) => MainnetReadinessFixture;
  }> = [
    {
      name: "wasm hash",
      checkId: "wasm-hash",
      field: "wasmHash",
      mutate: (f) => ({ ...f, wasmHash: "deadbeef".repeat(8) }),
    },
    {
      name: "network passphrase",
      checkId: "network-passphrase",
      field: "networkPassphrase",
      mutate: (f) => ({ ...f, networkPassphrase: "Test SDF Network ; September 2015" }),
    },
    {
      name: "contract id",
      checkId: "contract-id",
      field: "contractId",
      mutate: (f) => ({
        ...f,
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      }),
    },
    {
      name: "escrow token contract",
      checkId: "token-contract",
      field: "tokenContract",
      mutate: (f) => ({
        ...f,
        tokenContract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      }),
    },
  ];

  for (const { name, checkId, field, mutate } of fieldMutations) {
    it(`blocks on a mismatched ${name} and names the field`, async () => {
      const report = await fixtureRun(mutate(committedFixture()));
      const fieldCheck = report.checks.find((c) => c.id === checkId);
      assert.equal(fieldCheck?.status, "block", `${name} must block`);
      assert.equal(hasBlockingFailures(report.checks), true);
      assert.equal(report.deployment?.matched, false);
      assert.equal(report.deployment?.mismatchedFieldNames, field);
      assert.throws(
        () => assertReadinessForExecute(report.checks),
        new RegExp(checkId),
      );
      try {
        assertDeploymentMatches(
          MAINNET_MANIFEST,
          fixtureDeployment(mutate(committedFixture())),
        );
        assert.fail("expected a mismatch");
      } catch (err) {
        assert.ok(err instanceof SubRosaDeploymentMismatchError);
        assert.deepEqual(err.fields, [field]);
      }
    });
  }

  it("blocks a recorded balance that is not zero", async () => {
    const report = await runMainnetReadiness(
      defaultMainnetReadinessInput({
        fixture: { ...committedFixture(), contractBalance: "1000" },
        withBalances: true,
      }),
    );
    assert.equal(
      report.checks.find((c) => c.id === "contract-balance")?.status,
      "block",
    );
  });

  it("blocks when the recorded round is not settled", async () => {
    const base = committedFixture();
    const report = await fixtureRun({
      ...base,
      round: { ...base.round, status: "Cleared" },
    });
    const settled = report.checks.find((c) => c.id === "settled-round");
    assert.equal(settled?.status, "block");
    assert.match(settled?.message ?? "", /Cleared/);
  });
});

describe("parseMainnetReadinessFixture", () => {
  it("rejects a fixture that is missing a field", () => {
    const base = committedFixture() as unknown as Record<string, unknown>;
    const { tokenContract: _dropped, ...withoutToken } = base;
    assert.throws(
      () => parseMainnetReadinessFixture(withoutToken),
      /tokenContract/,
    );
  });

  it("rejects a non-decimal stroop value", () => {
    const base = committedFixture();
    assert.throws(
      () =>
        parseMainnetReadinessFixture({
          ...base,
          round: {
            ...base.round,
            bid: { ...base.round.bid, escrow: "5e7" },
          },
        }),
      /decimal integer string/,
    );
  });

  it("requires a bidder list", () => {
    const base = committedFixture();
    assert.throws(
      () =>
        parseMainnetReadinessFixture({
          ...base,
          round: { ...base.round, bidders: [] },
        }),
      /bidders/,
    );
  });
});

describe("runMainnetReadiness — live comparison", () => {
  it("returns dry-run warnings without live RPC dependencies", async () => {
    const report = await runMainnetReadiness(
      defaultMainnetReadinessInput({ live: false, withBalances: true }),
    );

    assert.equal(report.mode, "dry-run");
    assert.ok(report.warnCount >= 3);
    assert.equal(hasBlockingFailures(report.checks), false);
  });

  it("passes live checks with mocked dependencies", async () => {
    const report = await runMainnetReadiness(
      defaultMainnetReadinessInput({
        withBalances: true,
        operatorAccount: "GOPERATOR",
      }),
      {
        reader: mockReader(),
        rpc: mockRpc("500000000"),
        fetchWasmHash: async () => MAINNET_MANIFEST.wasmHash,
        sacBalance: async (addr) => (addr === CONTRACT_ID ? 0n : 1n),
      },
    );

    assert.equal(hasBlockingFailures(report.checks), false);
    assert.ok(report.passCount >= 8);
    assert.equal(report.deployment?.matched, true);
  });

  const liveMismatches: Array<{
    name: string;
    checkId: string;
    deps: MainnetReadinessDeps;
  }> = [
    {
      name: "wasm hash",
      checkId: "wasm-hash",
      deps: { fetchWasmHash: async () => "deadbeef".repeat(8) },
    },
    {
      name: "network passphrase",
      checkId: "network-passphrase",
      deps: {
        rpc: mockRpc("500000000", {
          getNetwork: async () => ({
            passphrase: "Test SDF Network ; September 2015",
            protocolVersion: "22",
          }),
        }),
      },
    },
    {
      name: "escrow token contract",
      checkId: "token-contract",
      deps: {
        reader: mockReader({
          getConfig: async () =>
            ({
              usdc: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
            }) as unknown as GlobalConfig,
        }),
      },
    },
    {
      name: "unreadable escrow token contract",
      checkId: "token-contract",
      deps: {
        reader: mockReader({
          getConfig: async () => {
            throw new Error("config not found");
          },
        }),
      },
    },
    {
      name: "contract id the client is bound to",
      checkId: "contract-id",
      deps: {
        reader: mockReader({
          contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        }),
      },
    },
  ];

  for (const { name, checkId, deps } of liveMismatches) {
    it(`blocks on a mismatched live ${name}`, async () => {
      const report = await runMainnetReadiness(defaultMainnetReadinessInput(), {
        reader: mockReader(),
        rpc: mockRpc("500000000"),
        fetchWasmHash: async () => MAINNET_MANIFEST.wasmHash,
        ...deps,
      });
      const fieldCheck = report.checks.find((c) => c.id === checkId);
      assert.equal(fieldCheck?.status, "block", `${name} must block`);
      assert.equal(hasBlockingFailures(report.checks), true);
      assert.throws(() => assertReadinessForExecute(report.checks), new RegExp(checkId));
    });
  }

  it("blocks on config drift without reading the network", async () => {
    // dry-run: the config/manifest comparison happens before any RPC use.
    const report = await runMainnetReadiness(
      defaultMainnetReadinessInput({
        live: false,
        networkPassphrase: "Test SDF Network ; September 2015",
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      }),
    );
    assert.equal(
      report.checks.find((c) => c.id === "config-network-passphrase")?.status,
      "block",
    );
    assert.equal(
      report.checks.find((c) => c.id === "config-contract-id")?.status,
      "block",
    );
  });

  it("blocks every deployment field when no read-only client is available", async () => {
    const report = await runMainnetReadiness(defaultMainnetReadinessInput(), {
      rpc: mockRpc("500000000"),
    });
    for (const id of ["contract-id", "network-passphrase", "wasm-hash", "token-contract"]) {
      assert.equal(
        report.checks.find((c) => c.id === id)?.status,
        "block",
        `${id} must block without a client`,
      );
    }
  });

  it("refuses to read a balance for a token the manifest does not pin", async () => {
    const report = await runMainnetReadiness(
      defaultMainnetReadinessInput({
        withBalances: true,
        tokenSacId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      }),
      {
        reader: mockReader(),
        rpc: mockRpc("500000000"),
        fetchWasmHash: async () => MAINNET_MANIFEST.wasmHash,
        sacBalance: async () => {
          throw new Error("should not be called");
        },
      },
    );
    const balance = report.checks.find((c) => c.id === "contract-balance");
    assert.equal(balance?.status, "block");
    assert.match(balance?.message ?? "", /manifest pins/);
  });
});

describe("readiness output", () => {
  it("names the mismatched fields in the formatted report", async () => {
    const report = await fixtureRun({
      ...committedFixture(),
      wasmHash: "deadbeef".repeat(8),
      tokenContract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    });
    const { formatReadinessReport } = await import("./mainnet-readiness.js");
    const text = formatReadinessReport(report);
    assert.match(text, /Mismatched deployment fields: wasmHash, tokenContract/);
    assert.match(text, /Manifest: fixture/);
  });

  it("keeps a passphrase out of the report even if one is misconfigured", async () => {
    const secret = `S${"B".repeat(55)}`;
    const report = await fixtureRun({
      ...committedFixture(),
      networkPassphrase: secret,
    });
    const { formatReadinessReport } = await import("./mainnet-readiness.js");
    const text = formatReadinessReport(report);
    assert.equal(text.includes(secret), false);
    assert.match(text, /Network passphrase: .*disagrees with the committed manifest/);
  });
});

describe("no secret key is required", () => {
  it("completes a fixture run with no secrets in the environment", async () => {
    const before = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (/SECRET|SEED|MNEMONIC/i.test(key)) delete process.env[key];
    }
    try {
      const report = await fixtureRun(committedFixture());
      assert.equal(report.blockCount, 0);
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, before);
    }
  });

  it("keeps secret handling out of the readiness code and scripts", () => {
    const sources = [
      "src/mainnet-readiness.ts",
      "src/mainnet-manifest.ts",
      "src/mainnet-artifacts.ts",
      "scripts/mainnet-ready.ts",
      "scripts/mainnet-verify.ts",
    ];
    for (const file of sources) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      assert.equal(/fromSecret\(/.test(text), false, `${file} must not derive keys`);
      assert.equal(/\bsecretKey\b/.test(text), false, `${file} must not configure a signer`);
      assert.equal(/_SECRET\b/.test(text), false, `${file} must not read *_SECRET env vars`);
    }
  });
});

describe("verifySettledRoundProof", () => {
  it("passes when round state matches frozen artifacts", async () => {
    const reader = {
      getRound: async () => settledRound,
      getBidders: async () => [BIDDER],
      getBidState: async () => settledBidState,
    };

    await verifySettledRoundProof(reader, 1n, {
      bidStroops: MAINNET_MANIFEST.bidStroops,
      escrowStroops: MAINNET_MANIFEST.escrowStroops,
      revealRound: Number(MAINNET_MANIFEST.revealRound),
    });
  });

  it("fails when status is not settled", async () => {
    const reader = {
      getRound: async () =>
        ({ ...settledRound, status: { tag: "Open", values: undefined } }) as Round,
      getBidders: async () => [BIDDER],
      getBidState: async () => settledBidState,
    };

    await assert.rejects(
      () =>
        verifySettledRoundProof(reader, 1n, {
          bidStroops: MAINNET_MANIFEST.bidStroops,
          escrowStroops: MAINNET_MANIFEST.escrowStroops,
          revealRound: Number(MAINNET_MANIFEST.revealRound),
        }),
      /Settled/,
    );
  });
});
