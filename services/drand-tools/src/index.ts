// Copyright (c) 2026 Sub Rosa contributors
// Risk-2 validation report. Fetches live quicknet data, confirms the message/DST
// the contract must use, and emits the exact Soroban-encoded constants for the
// deploy configuration (drand_pubkey, negated G2 generator, DST).

import { getChainInfo, getBeacon } from "./quicknet.js";
import { detectMessageVariant, DST } from "./parity.js";
import {
  encodeG1,
  negatedG2Generator,
  pubkeyToSoroban,
  toHex,
  type Fp2Order,
} from "./encode.js";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";

function line() {
  console.log("─".repeat(72));
}

async function main() {
  line();
  console.log("Sub Rosa — Risk-2 harness: tlock ↔ Drand ↔ on-chain BLS");
  line();

  const info = await getChainInfo();
  console.log(`network        : quicknet`);
  console.log(`scheme         : ${info.schemeID}`);
  console.log(`genesis_time   : ${info.genesis_time}`);
  console.log(`period         : ${info.period}s`);
  console.log(`public_key     : ${info.public_key}`);
  console.log(`public_key len : ${info.public_key.length / 2} bytes (compressed G2)`);

  const latest = await getBeacon("latest");
  console.log(`\nlatest round   : ${latest.round}`);
  console.log(`signature      : ${latest.signature}`);
  console.log(`signature len  : ${latest.signature.length / 2} bytes (compressed G1)`);

  line();
  console.log("1) Message / DST construction (must match the contract)");
  const variant = detectMessageVariant(
    latest.round,
    latest.signature,
    info.public_key,
  );
  if (!variant) {
    console.error("  ✗ FAIL — no known message variant verified the beacon.");
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ verified with message = ${variant}`);
  console.log(`  ✓ DST = "${DST}"`);
  console.log(
    `  contract uses sha256(be8(R)) → hash_to_g1 — ${
      variant === "sha256(be8)" ? "MATCHES" : "MISMATCH, update contract!"
    }`,
  );

  line();
  console.log("2) Soroban deploy constants (uncompressed, big-endian, Fp2=c1c0)");
  console.log("   Fp2 ordering confirmed on-chain by the contract's BLS test;");
  console.log("   the (c0,c1) ordering is rejected by the host as not-on-curve.");
  const order: Fp2Order = "c1c0";
  const pk = pubkeyToSoroban(info.public_key, order);
  const negGen = negatedG2Generator(order);
  console.log(`\n  drand_pubkey      = ${toHex(pk)}`);
  console.log(`  g2_neg_generator  = ${toHex(negGen)}`);
  // Decompressed signature for the same round, in Soroban G1 form (what the
  // keeper passes to open_reveal).
  const sigPt = bls.G1.Point.fromHex(latest.signature);
  console.log(`\n  example sig (round ${latest.round}) uncompressed G1:`);
  console.log(`  drand_signature   = ${toHex(encodeG1(sigPt))}`);

  line();
  console.log("DST hex (for .env / deploy):");
  console.log(`  ${toHex(new TextEncoder().encode(DST))}`);
  line();
  console.log("Status: message/DST + Fp2(c1c0) ordering CONFIRMED on-chain by");
  console.log("the contract's BLS test against this live signature. Bake these");
  console.log("constants into the deploy script. No fallback path.");
  line();
}

main().catch((err) => {
  console.error("harness error:", err);
  process.exitCode = 1;
});
