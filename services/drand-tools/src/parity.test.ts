import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { QUICKNET_HASH as DRAND_TOOLS_HASH, timeOfRound } from "./quicknet.js";
import { encodeG1 } from "./encode.js";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";

import { QUICKNET_HASH as TLOCK_HASH } from "@sub-rosa/tlock";
import { drandSignatureToSoroban } from "@sub-rosa/tlock";
import { classifyDrandRound } from "@sub-rosa/tlock";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorPath = path.resolve(__dirname, "../../../test-vectors/quicknet.json");
const vectors = JSON.parse(fs.readFileSync(vectorPath, "utf-8"));

test("Parity between tlock and drand-tools on quicknet parameters", () => {
  for (const vec of vectors) {
    // 1. Chain hash mismatch
    assert.equal(DRAND_TOOLS_HASH, vec.chain_hash, "drand-tools chain hash must match vector");
    assert.equal(TLOCK_HASH, vec.chain_hash, "tlock chain hash must match vector");

    // 2. Round time parity (Fail on a one-second boundary difference)
    // drand-tools timeOfRound returns seconds
    const info = {
      genesis_time: vec.genesis_time,
      period: vec.period,
    };
    const drandToolsTimeS = timeOfRound(info as any, vec.round);
    const drandToolsTimeMs = drandToolsTimeS * 1000;
    
    // tlock classifyDrandRound computes expected publishAtMs
    const tlockRes = classifyDrandRound(vec.round, info as any, drandToolsTimeMs);
    assert.equal(tlockRes.publishAtMs, drandToolsTimeMs, "tlock and drand-tools must agree exactly on round time");
    
    // Test the 1-second boundary difference
    const tlockBefore = classifyDrandRound(vec.round, info as any, drandToolsTimeMs - 1000);
    assert.equal(tlockBefore.status, "future", "tlock should classify 1s before as future");
    
    const tlockAfter = classifyDrandRound(vec.round, info as any, drandToolsTimeMs + 1000);
    // Could be fresh or stale, but definitely not future.
    assert.notEqual(tlockAfter.status, "future", "tlock should classify 1s after as past/fresh/stale");

    // 3. Beacon encoding parity
    const drandToolsEncoded = encodeG1(bls.G1.Point.fromHex(vec.signature));
    const tlockEncoded = drandSignatureToSoroban(vec.signature);
    assert.deepEqual(drandToolsEncoded, tlockEncoded, "G1 encoding must exactly match between tlock and drand-tools");
  }
});
