import { test } from "node:test";
import assert from "node:assert/strict";

import { redact } from "./redact.js";

// ── Stellar secret keys ─────────────────────────────────────────────────────

test("redact masks a Stellar secret key (S…)", () => {
  const secret = "SAEWB7H37Z2U6NYBKZQ5O5EU457O64QZ6H6VSF6SLBCYNZ5SG4UBHZVT";
  assert.match(secret, /^S[A-Z2-7]{55}$/, "fixture looks like a real secret");
  assert.equal(redact(secret), "S…REDACTED");
});

test("redact masks a Stellar secret when embedded in a log message", () => {
  const msg =
    "signer config: SAEWB7H37Z2U6NYBKZQ5O5EU457O64QZ6H6VSF6SLBCYNZ5SG4UBHZVT doing things";
  assert.equal(
    redact(msg),
    "signer config: S…REDACTED doing things",
  );
});

test("redact masks multiple secrets in the same string", () => {
  const msg =
    "a: SAEWB7H37Z2U6NYBKZQ5O5EU457O64QZ6H6VSF6SLBCYNZ5SG4UBHZVT b: SDRL4FGXJLW2G2J2RYM57CJRC4FZHK37NE3LBZ5XS6QKUZ6OP3NZL5CU";
  assert.equal(
    redact(msg),
    "a: S…REDACTED b: S…REDACTED",
  );
});

test("redact does not mask a Stellar public key (G…)", () => {
  const msg = "public key: GA4G4K2W5X2VX2F5H2Z5G4K2W5X2VX2F5H2Z5G4K2W5X2VX2F5H2Z5";
  // Public keys start with G, so they don't match the S... pattern.
  assert.equal(redact(msg), msg);
});

// ── Hex-encoded secrets ─────────────────────────────────────────────────────

test("redact masks a 64-char hex string", () => {
  const hex = "0352d1841643949f36a5f4a42e37cfae0c78f7a71e8cba7f75635655910dd391";
  assert.equal(redact(hex), "…REDACTED");
});

test("redact masks a hex secret embedded in a log line", () => {
  const msg =
    "auditor secretHex: 0352d1841643949f36a5f4a42e37cfae0c78f7a71e8cba7f75635655910dd391";
  assert.equal(
    redact(msg),
    "auditor secretHex: …REDACTED",
  );
});

test("redact does NOT mask short hex strings (hashes, round ids, etc.)", () => {
  const msg = "round 42: tx 0xabcdef1234567890";
  assert.equal(redact(msg), msg);
});

test("redact does NOT mask a 64-char string that starts with 0x (not a raw hex key)", () => {
  // 0x prefix makes it 66 chars, so the 64-char pattern won't match.
  const msg = "tx 0x0352d1841643949f36a5f4a42e37cfae0c78f7a71e8cba7f75635655910dd391";
  assert.equal(redact(msg), msg);
});

// ── RPC URLs with credentials ───────────────────────────────────────────────

test("redact masks credentials in an RPC URL", () => {
  const url = "https://user:supersecret@rpc.example.com";
  assert.equal(redact(url), "https://…@rpc.example.com");
});

test("redact masks token-based RPC URL", () => {
  const url = "https://tokensecret123@rpc.example.com";
  assert.equal(redact(url), "https://…@rpc.example.com");
});

test("redact does NOT alter a plain RPC URL without credentials", () => {
  const url = "https://soroban-testnet.stellar.org";
  assert.equal(redact(url), url);
});

test("redact preserves the hostname in credential URLs", () => {
  const url = "https://admin:pass@mainnet.stellar.org:443/custom-path";
  assert.equal(
    redact(url),
    "https://…@mainnet.stellar.org:443/custom-path",
  );
});

// ── Safe operational fields are preserved ───────────────────────────────────

test("redact preserves round IDs", () => {
  const msg = "round 42: status=Settled R=100500 revealed=3 skipped=1";
  assert.equal(redact(msg), msg);
});

test("redact preserves json-like output with safe fields", () => {
  const msg = `{"roundId":"42","finalStatus":"Settled","openedReveal":true,"revealed":["GB..."],"skipped":[]}`;
  assert.equal(redact(msg), msg);
});

test("redact preserves bidder addresses, status tags, counts", () => {
  const msg = "revealing 5 bidder(s) — GA4G4K2W5X2VX2F5H2Z5G4K2 reports Open";
  assert.equal(redact(msg), msg);
});

// ── Multiple sensitive patterns in one message ──────────────────────────────

test("redact handles all patterns in one message", () => {
  const msg = [
    'secret: SAEWB7H37Z2U6NYBKZQ5O5EU457O64QZ6H6VSF6SLBCYNZ5SG4UBHZVT',
    'hex: 0352d1841643949f36a5f4a42e37cfae0c78f7a71e8cba7f75635655910dd391',
    'url: https://admin:pass@rpc.example.com',
    'round 42: Settled',
  ].join(" ");
  const want = [
    'secret: S…REDACTED',
    'hex: …REDACTED',
    'url: https://…@rpc.example.com',
    'round 42: Settled',
  ].join(" ");
  assert.equal(redact(msg), want);
});
