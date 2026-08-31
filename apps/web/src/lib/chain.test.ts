import assert from "node:assert/strict";
import { test } from "node:test";

import { formatEscrowAmount } from "./amount";

test("formatEscrowAmount preserves exact 4-decimal display above Number.MAX_SAFE_INTEGER", () => {
  assert.equal(formatEscrowAmount(9007199254740992n, "token"), "900719925.4741 token");
  assert.equal(formatEscrowAmount(9007199254741500n, "token"), "900719925.4742 token");
});

test("formatEscrowAmount keeps four-decimal display for standard escrow values", () => {
  assert.equal(formatEscrowAmount(10_000_000n, "token"), "1.0000 token");
  assert.equal(formatEscrowAmount(1_000_000n, "token"), "0.1000 token");
  assert.equal(formatEscrowAmount(123_456_789n, "token"), "12.3457 token");
});
