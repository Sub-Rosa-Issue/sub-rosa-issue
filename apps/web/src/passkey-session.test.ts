// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { systemClock } from "@sub-rosa/time";
import {
  SubRosaClient,
  SubRosaNetworkMismatchError,
  SubRosaSessionMismatchError,
} from "@sub-rosa/sdk";
import { sealFixture } from "../../../packages/sdk/src/testing/seal-fixture";
import {
  createPasskeySession,
  commitWithPasskeySession,
  type PasskeySession,
} from "./passkey-config";

describe("Passkey session binding fixture test", async () => {
  const fixtureKeypair = Keypair.random();
  const FIXTURE_SEED = fixtureKeypair.secret();
  const FIXTURE_PUBLIC = fixtureKeypair.publicKey();

  const FIXTURE_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
  const SWAPPED_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 9));
  const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
  const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

  it("records the session creation time", () => {
    const before = systemClock.nowMs();
    const session = createPasskeySession({
      contractId: FIXTURE_CONTRACT_ID,
      networkPassphrase: TESTNET_PASSPHRASE,
      account: FIXTURE_PUBLIC,
    });
    const createdAt = Date.parse(session.createdAt!);
    assert.ok(createdAt >= before && createdAt <= systemClock.nowMs());
  });

  const commitParams = {
    roundId: 1,
    sealed: await sealFixture({ contractId: FIXTURE_CONTRACT_ID, bidderId: FIXTURE_PUBLIC, value: 50_000n }),
    escrow: 100_000n,
    bidder: FIXTURE_PUBLIC,
  };

  function createFixtureClient(options: {
    contractId?: string;
    networkPassphrase?: string;
  } = {}) {
    const contractId = options.contractId ?? FIXTURE_CONTRACT_ID;
    const networkPassphrase = options.networkPassphrase ?? TESTNET_PASSPHRASE;
    let submitted = false;

    const client = new SubRosaClient({
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase,
      contractId,
      secretKey: FIXTURE_SEED,
      _server: {
        getNetwork: async () => ({
          passphrase: networkPassphrase,
          protocolVersion: "23",
        }),
        getLedgerEntries: async () => ({
          entries: [{}],
          latestLedger: 123,
        }),
      } as never,
    });

    // Mock contract commit to detect submission
    Object.defineProperty(client.contract, "commit", {
      configurable: true,
      value: async () => {
        submitted = true;
        return {
          signAndSend: async () => ({
            result: { unwrap: () => ({}) },
          }),
        };
      },
    });

    return { client, hasSubmitted: () => submitted };
  }

  it("A matching session can commit in the fixture test", async () => {
    const { client, hasSubmitted } = createFixtureClient();

    const matchingSession = createPasskeySession({
      contractId: FIXTURE_CONTRACT_ID,
      networkPassphrase: TESTNET_PASSPHRASE,
      account: FIXTURE_PUBLIC,
    });

    await commitWithPasskeySession(matchingSession, client, commitParams);
    assert.equal(hasSubmitted(), true, "matching session should have submitted commit");
  });

  it("A swapped contract id does not submit", async () => {
    const { client, hasSubmitted } = createFixtureClient();

    const swappedSession: PasskeySession = {
      contractId: SWAPPED_CONTRACT_ID,
      networkPassphrase: TESTNET_PASSPHRASE,
      account: FIXTURE_PUBLIC,
    };

    await assert.rejects(
      commitWithPasskeySession(swappedSession, client, commitParams),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.ok(error instanceof SubRosaSessionMismatchError);
        assert.equal((error as SubRosaNetworkMismatchError).reason, "contract_mismatch");
        return true;
      },
    );

    assert.equal(hasSubmitted(), false, "swapped contract id must not submit to contract");
  });

  it("A swapped passphrase does not submit", async () => {
    const { client, hasSubmitted } = createFixtureClient();

    const swappedSession: PasskeySession = {
      contractId: FIXTURE_CONTRACT_ID,
      networkPassphrase: PUBLIC_PASSPHRASE,
      account: FIXTURE_PUBLIC,
    };

    await assert.rejects(
      commitWithPasskeySession(swappedSession, client, commitParams),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaNetworkMismatchError);
        assert.ok(error instanceof SubRosaSessionMismatchError);
        assert.equal((error as SubRosaNetworkMismatchError).reason, "session_mismatch");
        return true;
      },
    );

    assert.equal(hasSubmitted(), false, "swapped network passphrase must not submit to contract");
  });

  it("The error text does not contain the fixture seed", async () => {
    const { client } = createFixtureClient();

    const swappedSession: PasskeySession = {
      contractId: SWAPPED_CONTRACT_ID,
      networkPassphrase: PUBLIC_PASSPHRASE,
      account: FIXTURE_PUBLIC,
    };

    await assert.rejects(
      commitWithPasskeySession(swappedSession, client, commitParams),
      (error: unknown) => {
        assert.ok(error instanceof SubRosaSessionMismatchError);
        assert.ok(!error.message.includes(FIXTURE_SEED), "error must omit the fixture seed");
        assert.doesNotMatch(error.message, /\bS[A-Z2-7]{55}\b/);
        return true;
      },
    );
  });
});
