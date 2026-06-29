/**
 * Tiny redaction helper for keeper log output.
 *
 * Protects public/contributor logs from accidentally leaking signer secrets,
 * RPC credentials, or hex-encoded private-key–like values while preserving
 * safe operational fields (round id, status, revealed/skipped counts, etc.).
 *
 * This is a lightweight safety guard — it is *not* a general-purpose sanitizer.
 */

// Stellar secret Ed25519 seed: version byte 0x90 → base32 "S" + 55 chars.
// Pattern: S followed by 55 base32 chars [A-Z2-7] (case-sensitive).
const STELLAR_SECRET_RE = /S[A-Z2-7]{55}/g;

// 32-byte hex-encoded secret (64 hex chars), e.g. auditor secretKey or
// any private-key–sized value that could appear in an error message.
const HEX_SECRET_RE = /\b[0-9a-fA-F]{64}\b/g;

// RPC URL (or any https URL) with embedded credentials before the host.
//   https://user:pass@host → https://…@host
//   https://token@host      → https://…@host
const URL_CREDENTIALS_RE = /(https?:\/\/)[^@\s]+@/gi;

/**
 * Redact sensitive values from a string intended for logging.
 *
 * Recognised patterns:
 *  - Stellar secret keys (S…)
 *  - 64-hex-char strings that look like private keys
 *  - Userinfo credentials in https URLs
 *
 * Safe operational content such as round ids, status tags, bidder public
 * addresses, counts, and descriptive text is left intact.
 */
export function redact(raw: string): string {
  let s = raw;

  // 1. Redact credentials embedded in URLs first (before @ removal).
  s = s.replace(URL_CREDENTIALS_RE, "$1…@");

  // 2. Redact Stellar secret keys.
  s = s.replace(STELLAR_SECRET_RE, "S…REDACTED");

  // 3. Redact hex-encoded secrets.
  s = s.replace(HEX_SECRET_RE, "…REDACTED");

  return s;
}
