import { writeFileSync } from "node:fs";
import { commitment, toHex } from "../src/commitment.js";
import { generateAuditorKeypair } from "../src/auditor.js";
import { generateNonce } from "../src/seal.js";

function generateVectors() {
  const vectors = [];
  
  // Vector 1: Standard values
  const nonce1 = new Uint8Array(32).fill(0x42);
  const value1 = 1000000n;
  const round1 = 12345;
  const identity1 = new TextEncoder().encode("alice");
  const auditor1 = generateAuditorKeypair();
  
  vectors.push({
    inputs: {
      value: value1.toString(),
      nonce: toHex(nonce1),
      round: round1,
      identity: toHex(identity1),
      auditorSecretKey: toHex(auditor1.secretKey),
      auditorPublicKey: toHex(auditor1.publicKey)
    },
    expected: {
      commitment: toHex(commitment(value1, nonce1))
    }
  });

  // Vector 2: Edge case value = 0n
  const nonce2 = generateNonce();
  const value2 = 0n;
  const round2 = 999999;
  const identity2 = new TextEncoder().encode("bob");
  const auditor2 = generateAuditorKeypair();

  vectors.push({
    inputs: {
      value: value2.toString(),
      nonce: toHex(nonce2),
      round: round2,
      identity: toHex(identity2),
      auditorSecretKey: toHex(auditor2.secretKey),
      auditorPublicKey: toHex(auditor2.publicKey)
    },
    expected: {
      commitment: toHex(commitment(value2, nonce2))
    }
  });

  writeFileSync(
    new URL("../src/sealBid-vectors.json", import.meta.url),
    JSON.stringify(vectors, null, 2)
  );
  console.log("Vectors generated in src/sealBid-vectors.json");
}

generateVectors();
