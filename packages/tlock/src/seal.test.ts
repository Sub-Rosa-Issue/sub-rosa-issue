// Copyright (c) 2026 Sub Rosa contributors
import { test } from "node:test";
import assert from "node:assert/strict";

import { quicknet, currentRound } from "./quicknet.js";
import { sealBid, openBid, generateNonce } from "./seal.js";
import { commitment, toHex } from "./commitment.js";
import { generateAuditorKeypair, openIdentity } from "./auditor.js";
import { openPayload, payloadCommitment, sealPayload } from "./payload.js";

// These tests hit the live Drand quicknet network (no mock).
const NET_TIMEOUT = 30_000;

test(
  "seal then open against a real quicknet round recovers value+nonce; H matches",
  { timeout: NET_TIMEOUT },
  async () => {
    const client = quicknet();
    // A finalized round (~15s ago) whose signature is already published.
    const round = (await currentRound(client)) - 5;

    const value = 1234n;
    const nonce = generateNonce();
    const auditor = generateAuditorKeypair();
    const identity = new TextEncoder().encode("GBIDDER...alice");

    const sealed = await sealBid({
      value,
      nonce,
      round,
      client,
      identity,
      auditorPublicKey: auditor.publicKey,
    });

    // Ciphertext must fit the contract's MAX_CIPHERTEXT (4096 bytes).
    assert.ok(sealed.ciphertext.length <= 4096, `ciphertext ${sealed.ciphertext.length}B`);

    const opened = await openBid(sealed.ciphertext, client);
    assert.equal(opened.value, value);
    assert.deepEqual([...opened.nonce], [...nonce]);

    // The decrypted value+nonce hash to the same H the contract checks at
    // reveal — i.e. this reveal would be accepted on-chain.
    assert.equal(toHex(commitment(opened.value, opened.nonce)), toHex(sealed.commitment));

    // Auditor (and only the auditor) recovers the identity.
    assert.deepEqual([...openIdentity(sealed.auditorBlob, auditor.secretKey)], [...identity]);
  },
);

test(
  "structured proposal payload seals and opens against a real quicknet round",
  { timeout: NET_TIMEOUT },
  async () => {
    const client = quicknet();
    const round = (await currentRound(client)) - 5;
    const amount = 12_000_0000000n;
    const nonce = generateNonce();
    const payload = new TextEncoder().encode(
      '{"price":"12000 USDC","timeline":"4 weeks","approach":"manual Soroban review"}',
    );
    const auditor = generateAuditorKeypair();
    const identity = new TextEncoder().encode("GPROVIDER...alice");

    const sealed = await sealPayload({
      amount,
      nonce,
      payload,
      round,
      client,
      identity,
      auditorPublicKey: auditor.publicKey,
    });
    const opened = await openPayload(sealed.ciphertext, client);

    assert.ok(sealed.ciphertext.length <= 4096, `ciphertext ${sealed.ciphertext.length}B`);
    assert.equal(opened.amount, amount);
    assert.deepEqual(opened.nonce, nonce);
    assert.deepEqual(opened.payload, payload);
    assert.equal(toHex(payloadCommitment(opened)), toHex(sealed.commitment));
    assert.deepEqual(openIdentity(sealed.auditorBlob, auditor.secretKey), identity);
  },
);

test(
  "wrong value/nonce does not match the commitment (would be rejected on-chain)",
  { timeout: NET_TIMEOUT },
  async () => {
    const client = quicknet();
    const round = (await currentRound(client)) - 5;
    const value = 555n;
    const nonce = generateNonce();
    const sealed = await sealBid({ value, nonce, round, client });
    const opened = await openBid(sealed.ciphertext, client);

    const wrongNonce = new Uint8Array(32).fill(0x42);
    assert.notEqual(toHex(commitment(opened.value, wrongNonce)), toHex(sealed.commitment));
    assert.notEqual(toHex(commitment(opened.value + 1n, opened.nonce)), toHex(sealed.commitment));
  },
);

test("sealBid rejects a non-positive Drand round", async () => {
  const client = quicknet();
  for (const round of [0, -1, -100]) {
    await assert.rejects(
      sealBid({ value: 1n, nonce: generateNonce(), round, client }),
      /round must be a positive integer/,
    );
  }
});

test("openBid rejects an empty ciphertext", async () => {
  const client = quicknet();
  await assert.rejects(
    openBid(new Uint8Array(0), client),
    /ciphertext must not be empty/,
  );
});

test(
  "a bid sealed to a future round cannot be opened — the seal holds",
  { timeout: NET_TIMEOUT },
  async () => {
    const client = quicknet();
    // Far in the future: its signature does not exist yet.
    const futureRound = (await currentRound(client)) + 1_000_000;
    const sealed = await sealBid({
      value: 999n,
      nonce: generateNonce(),
      round: futureRound,
      client,
    });
    await assert.rejects(openBid(sealed.ciphertext, client));
  },
);

test("sealBid rejects non-positive or non-integer round numbers", async () => {
  const client = quicknet();
  const nonce = generateNonce();
  const value = 100n;

  await assert.rejects(
    () => sealBid({ value, nonce, round: 0, client }),
    (err: any) => err instanceof RangeError && /round must be a positive integer/.test(err.message),
  );
  await assert.rejects(
    () => sealBid({ value, nonce, round: -5, client }),
    (err: any) => err instanceof RangeError && /round must be a positive integer/.test(err.message),
  );
  await assert.rejects(
    () => sealBid({ value, nonce, round: 1.5, client }),
    (err: any) => err instanceof RangeError && /round must be a positive integer/.test(err.message),
  );
  await assert.rejects(
    () => sealBid({ value, nonce, round: NaN, client }),
    (err: any) => err instanceof RangeError && /round must be a positive integer/.test(err.message),
  );
});

test("sealBid rejects invalid nonce lengths", async () => {
  const client = quicknet();
  const value = 100n;
  const round = 1000;

  await assert.rejects(
    () => sealBid({ value, nonce: new Uint8Array(16), round, client }),
    /nonce must be 32 bytes/,
  );
  await assert.rejects(
    () => sealBid({ value, nonce: new Uint8Array(31), round, client }),
    /nonce must be 32 bytes/,
  );
  await assert.rejects(
    () => sealBid({ value, nonce: new Uint8Array(33), round, client }),
    /nonce must be 32 bytes/,
  );
});

test("openBid rejects empty ciphertext", async () => {
  const client = quicknet();
  await assert.rejects(
    () => openBid(new Uint8Array(0), client),
    /ciphertext is empty/,
  );
});

