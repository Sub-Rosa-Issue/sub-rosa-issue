// SPDX-License-Identifier: MIT
// Sealed-ciphertext wire-format tests.
//
// These are the structural half of the bid acceptance rule: what a tlock
// ciphertext declares about itself, read back without decrypting and without
// touching the network. The blobs come from the real `sealBid`, so the parser
// is checked against the sealer it has to agree with — an offline Drand client
// stands in for quicknet and returns the chain's static public key, which is
// the only thing `timelockEncrypt` needs from the network.

import { test } from "node:test";
import assert from "node:assert/strict";

import { QUICKNET_HASH, type DrandClient } from "./quicknet.js";
import { sealBid, type SealedBid } from "./seal.js";
import { commitment, NONCE_BYTES, PREIMAGE_BYTES } from "./commitment.js";
import {
  AGE_VERSION,
  ARMOR_LINE_WIDTH,
  TLOCK_ARMOR_FOOTER,
  TLOCK_ARMOR_HEADER,
  SEALED_BID_PLAINTEXT_BYTES,
  isSealedBidPayload,
  parseSealedPayload,
} from "./ciphertext.js";

// The real quicknet chain public key. Only `chain().info()` is consulted during
// encryption, so a stub over these values produces genuine tlock output offline.
const QUICKNET_PUBLIC_KEY =
  "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a";

const offlineClient = {
  chain: () => ({
    info: async () => ({
      hash: QUICKNET_HASH,
      public_key: QUICKNET_PUBLIC_KEY,
      schemeID: "bls-unchained-g1-rfc9380",
    }),
  }),
} as unknown as DrandClient;

const ROUND = 1_234_567;
const VALUE = 8_675_309n;
const NONCE = new Uint8Array(NONCE_BYTES).fill(0x2a);

/** Seal a bid offline. Each call re-encrypts, so ciphertexts differ. */
async function sealFixture(overrides?: {
  value?: bigint;
  nonce?: Uint8Array;
  round?: number;
}): Promise<SealedBid> {
  return sealBid({
    value: overrides?.value ?? VALUE,
    nonce: overrides?.nonce ?? NONCE,
    round: overrides?.round ?? ROUND,
    client: offlineClient,
  });
}

const armored = (sealed: SealedBid): string =>
  new TextDecoder().decode(sealed.ciphertext);

const reasonOf = (ciphertext: Uint8Array | string): string | null => {
  const parsed = parseSealedPayload(ciphertext);
  return parsed.ok ? null : parsed.reason;
};

// ── Armor and age-payload plumbing (used to build malformed fixtures) ─────

interface AgeParts {
  /** Version line, recipient line, stanza body lines, and the MAC line. */
  header: string[];
  /** The binary body, which may itself contain newlines. */
  body: string;
}

/** Decode the ASCII armor into the age payload it wraps. */
function dearmor(text: string): string {
  const inner = text
    .slice(TLOCK_ARMOR_HEADER.length, text.length - TLOCK_ARMOR_FOOTER.length)
    .split("\n")
    .filter((line) => line.length > 0)
    .join("");
  return Buffer.from(inner, "base64").toString("latin1");
}

/** Split an age payload into its header lines and its body. */
function splitAge(payload: string): AgeParts {
  const lines = payload.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("--- ")) {
      return { header: lines.slice(0, i + 1), body: lines.slice(i + 1).join("\n") };
    }
  }
  throw new Error("fixture has no MAC line");
}

/** Re-wrap an age payload in the armor `tlock-js` writes. */
function rearmor(payload: string): string {
  const base64 = Buffer.from(payload, "latin1").toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += ARMOR_LINE_WIDTH) {
    lines.push(base64.slice(i, i + ARMOR_LINE_WIDTH));
  }
  // `encodeArmor` puts a blank line before the footer when the last base64
  // line lands exactly on the armor width.
  const footer =
    lines[lines.length - 1].length === ARMOR_LINE_WIDTH
      ? `\n${TLOCK_ARMOR_FOOTER}`
      : TLOCK_ARMOR_FOOTER;
  return `${TLOCK_ARMOR_HEADER}\n${lines.join("\n")}\n${footer}\n`;
}

/** Rebuild a sealed blob with a different `-> tlock` recipient line. */
function withRecipient(sealed: SealedBid, recipient: string): string {
  return withHeaderLine(sealed, 1, recipient);
}

/** Rebuild a sealed blob with the nth age-header line replaced. */
function withHeaderLine(sealed: SealedBid, index: number, line: string): string {
  const { header, body } = splitAge(dearmor(armored(sealed)));
  header[index] = line;
  return [header.join("\n"), body].join("\n");
}

// ── A real seal parses ────────────────────────────────────────────────────

test("a sealBid ciphertext parses into the round and chain it was sealed for", async () => {
  const sealed = await sealFixture();
  const parsed = parseSealedPayload(sealed.ciphertext);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.header.round, ROUND);
  assert.equal(parsed.header.chainHash, QUICKNET_HASH);
  // The implied plaintext length is the 48-byte commitment preimage and
  // nothing else — that is what ties this blob to a bid.
  assert.equal(parsed.header.plaintextBytes, SEALED_BID_PLAINTEXT_BYTES);
  assert.equal(parsed.header.plaintextBytes, PREIMAGE_BYTES);
  assert.equal(isSealedBidPayload(parsed.header), true);
});

test("the same seal parses identically from raw bytes and from its armored text", async () => {
  const sealed = await sealFixture();
  assert.deepEqual(
    parseSealedPayload(sealed.ciphertext),
    parseSealedPayload(armored(sealed)),
  );
});

test("a sealed payload is the age v1 shape the opener reads", async () => {
  const sealed = await sealFixture();
  const { header } = splitAge(dearmor(armored(sealed)));
  assert.equal(header[0], AGE_VERSION);
  assert.equal(header[1], `-> tlock ${ROUND} ${QUICKNET_HASH}`);
  assert.ok(header[header.length - 1].startsWith("--- "));
});

test("sealing the same value and nonce twice yields the same commitment", async () => {
  const a = await sealFixture();
  const b = await sealFixture();
  assert.deepEqual([...a.commitment], [...commitment(VALUE, NONCE)]);
  assert.deepEqual([...a.commitment], [...b.commitment]);
  // The file key and body nonce are fresh per seal, so the ciphertexts differ
  // even though the commitment — the thing the contract checks — does not.
  assert.notEqual(armored(a), armored(b));
});

// ── Truncation and corruption ─────────────────────────────────────────────

test("a ciphertext truncated mid-armor is rejected", async () => {
  const sealed = await sealFixture();
  assert.equal(reasonOf(sealed.ciphertext.slice(0, 20)), "missing_header");
  assert.equal(
    reasonOf(sealed.ciphertext.slice(0, sealed.ciphertext.length - 200)),
    "missing_footer",
  );
});

test("a ciphertext with its armor stripped is rejected", async () => {
  const sealed = await sealFixture();
  const inner = armored(sealed)
    .slice(TLOCK_ARMOR_HEADER.length, armored(sealed).length - TLOCK_ARMOR_FOOTER.length)
    .split("\n")
    .filter((line) => line.length > 0)
    .join("");
  assert.equal(reasonOf(inner), "missing_header");
});

test("a ciphertext with its base64 cut short is rejected", async () => {
  const sealed = await sealFixture();
  const lines = armored(sealed).split("\n");
  // One column short of a full line: base64 that no longer lands on a
  // 4-character boundary, which is what a clipped copy of the blob looks like.
  const clipped = [lines[0], lines[1].slice(0, ARMOR_LINE_WIDTH - 1), TLOCK_ARMOR_FOOTER, ""];
  assert.equal(reasonOf(clipped.join("\n")), "invalid_base64");
});

test("a ciphertext with a corrupted base64 character is rejected", async () => {
  const sealed = await sealFixture();
  const lines = armored(sealed).split("\n");
  lines[1] = "!".repeat(lines[1].length);
  assert.equal(reasonOf(lines.join("\n")), "invalid_base64");
});

test("a ciphertext that is not UTF-8 text is rejected", () => {
  assert.equal(reasonOf(new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x80])), "not_utf8");
});

test("a ciphertext with an unknown age version is rejected", async () => {
  const sealed = await sealFixture();
  const text = rearmor(withHeaderLine(sealed, 0, "age-encryption.org/v2"));
  assert.equal(reasonOf(text), "missing_version");
});

test("a ciphertext whose recipient is not a tlock stanza is rejected", async () => {
  const sealed = await sealFixture();
  const text = rearmor(withRecipient(sealed, `-> X25519 ${ROUND} ${QUICKNET_HASH}`));
  assert.equal(reasonOf(text), "not_tlock");
});

test("a ciphertext with a malformed tlock stanza is rejected", async () => {
  const sealed = await sealFixture();
  // The round argument is not a number.
  assert.equal(reasonOf(rearmor(withRecipient(sealed, "-> tlock not-a-round"))), "malformed_recipient");
  // The chain hash is not a 32-byte hex value.
  assert.equal(reasonOf(rearmor(withRecipient(sealed, `-> tlock ${ROUND} deadbeef`))), "malformed_recipient");
  // Round 0 is genesis, which the encrypter refuses.
  assert.equal(reasonOf(rearmor(withRecipient(sealed, `-> tlock 0 ${QUICKNET_HASH}`))), "malformed_recipient");
});

test("a ciphertext with its MAC line removed is rejected", async () => {
  const sealed = await sealFixture();
  const { header, body } = splitAge(dearmor(armored(sealed)));
  header.length = header.length - 1;
  assert.notEqual(reasonOf(rearmor([...header, body].join("\n"))), null);
});

test("a ciphertext padded with more than 1024 whitespace characters is rejected", async () => {
  const sealed = await sealFixture();
  assert.equal(reasonOf(" ".repeat(1025) + armored(sealed)), "excessive_padding");
});

test("leading and trailing whitespace within the armor limit is tolerated", async () => {
  const sealed = await sealFixture();
  // `openBid` trims before decoding, so the parser must trim too.
  assert.equal(parseSealedPayload(`\n${armored(sealed)}\n`).ok, true);
});

// ── Round and chain binding ───────────────────────────────────────────────

test("a seal reports the round it was sealed to, so cross-round blobs are detectable", async () => {
  const early = await sealFixture({ round: 1_000_000 });
  const late = await sealFixture({ round: 9_000_000 });
  const a = parseSealedPayload(early.ciphertext);
  const b = parseSealedPayload(late.ciphertext);
  assert.equal(a.ok && a.header.round, 1_000_000);
  assert.equal(b.ok && b.header.round, 9_000_000);
});

test("a seal reports the chain hash it is bound to", async () => {
  const sealed = await sealFixture();
  const parsed = parseSealedPayload(rearmor(withRecipient(sealed, `-> tlock ${ROUND} ${"a".repeat(64)}`)));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.header.chainHash, "a".repeat(64));
  assert.notEqual(parsed.ok && parsed.header.chainHash, QUICKNET_HASH);
});

test("a swapped ciphertext still parses — the commitment check is what catches it", async () => {
  // Two bidders, two seals. Taking one bidder's ciphertext with the other
  // bidder's commitment leaves a structurally perfect blob, which is exactly
  // why the commitment has to be re-derived rather than trusted.
  const alice = await sealFixture({ value: 700n, nonce: new Uint8Array(32).fill(1) });
  const bob = await sealFixture({ value: 900n, nonce: new Uint8Array(32).fill(2) });
  const swapped = { ...alice, commitment: bob.commitment };

  const parsed = parseSealedPayload(swapped.ciphertext);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.header.plaintextBytes, SEALED_BID_PLAINTEXT_BYTES);
  assert.notDeepEqual([...swapped.commitment], [...commitment(700n, new Uint8Array(32).fill(1))]);
});

// ── Plaintext length ──────────────────────────────────────────────────────

test("only a 48-byte plaintext counts as a bid seal", async () => {
  const sealed = await sealFixture();
  const parsed = parseSealedPayload(sealed.ciphertext);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  // The length is inferred from the body, so a payload carrying any other
  // plaintext is a valid age file but not a valid bid seal.
  assert.equal(isSealedBidPayload(parsed.header), true);
  for (const bytes of [0, 47, 49, 96]) {
    assert.equal(
      isSealedBidPayload({ ...parsed.header, plaintextBytes: bytes }),
      false,
      `plaintextBytes=${bytes} must not pass`,
    );
  }
});
