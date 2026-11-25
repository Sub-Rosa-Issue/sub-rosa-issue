// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TRANSACTION_PHASES,
  transactionStatusAnnouncement,
  type TransactionAnnouncementState,
} from "./transaction-status.js";

const STATES: TransactionAnnouncementState[] = ["working", "success", "error"];
const SEALED_VALUE = "12.50";
const CIPHERTEXT = "aabbccddeeff0011";

test("commit, reveal, settle, and retry announcements stay polite and omit sealed values", () => {
  for (const phase of TRANSACTION_PHASES) {
    for (const state of STATES) {
      const text = transactionStatusAnnouncement(phase, state);
      assert.match(text, /Sealed bid values are not announced\./);
      assert.equal(text.includes(SEALED_VALUE), false);
      assert.equal(text.includes(CIPHERTEXT), false);
    }
  }
  assert.match(transactionStatusAnnouncement("settle", "success"), /Settlement finished/);
  assert.match(transactionStatusAnnouncement("retry", "working"), /Retrying the transaction status/);
});

test("the sealed amount field is outside the polite transaction status region", () => {
  const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const demo = readFileSync(resolve(srcDir, "pages/DemoPage.tsx"), "utf8");
  const announcer = readFileSync(resolve(srcDir, "components/TransactionStatusAnnouncer.tsx"), "utf8");
  const guideStart = demo.indexOf("className={`phase-guide");
  const amountInput = demo.indexOf("phase-input--amount");
  assert.ok(guideStart > 0 && amountInput > guideStart);
  const guideOpen = demo.slice(guideStart, amountInput);
  assert.equal(guideOpen.includes("aria-live"), false);
  assert.match(announcer, /aria-live="polite"/);
  assert.match(demo, /TransactionStatusAnnouncer/);
  assert.match(demo, /transactionStatusAnnouncement/);
});
