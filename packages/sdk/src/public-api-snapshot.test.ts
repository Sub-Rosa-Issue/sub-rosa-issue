import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as sdk from "./index.js";

const EXPECTED_EXPORTS = [
  "ASSET_FIXTURES",
  "AssetConfigError",
  "KeeperStatusClient",
  "MAINNET_ARTIFACTS",
  "MAINNET_CONFIRM_PHRASE",
  "MAINNET_DEPLOY_MIN_XLM_STROOPS",
  "MAINNET_MICRO_MAX_ESCROW",
  "MAINNET_MIN_FEE_RESERVE_STROOPS",
  "MAX_AUDITOR_BLOB_BYTES",
  "MAX_CIPHERTEXT_BYTES",
  "RECEIPT_VERSION",
  "RoundContract",
  "RoundErrors",
  "StatusApiError",
  "SubRosaClient",
  "SubRosaClientConfigError",
  "SubRosaMissingReturnValueError",
  "SubRosaSubmitError",
  "SubRosaTimeoutError",
  "SubRosaTransactionError",
  "assertMainnetConfirmed",
  "assertMicroAmounts",
  "assertReadinessForExecute",
  "createOzChannelsSubmitter",
  "createOzChannelsSubmitterFromEnv",
  "createSacBalanceReader",
  "defaultMainnetReadinessInput",
  "fetchContractWasmHash",
  "fetchKeeperStatus",
  "formatReadinessReport",
  "hasBlockingFailures",
  "nativeXlmSacId",
  "networkFingerprint",
  "normalizeRoundId",
  "normalizeSorobanContractId",
  "parseReceipt",
  "runMainnetReadiness",
  "serializeReceipt",
  "tryDecodeBase64",
  "tryDecodeHex",
  "validateAssetConfig",
  "validateAssetConfigs",
  "validateEncryptedBlob",
  "verifyReceipt",
  "verifySettledRoundProof",
];

describe("SDK public API snapshot", () => {
  it("should match the expected named exports", () => {
    const actual = Object.keys(sdk).sort();
    const expected = [...EXPECTED_EXPORTS].sort();
    assert.deepEqual(actual, expected);
  });
});
