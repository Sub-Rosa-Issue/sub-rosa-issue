// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.appraisal-api.src.run");
import { configFromEnv } from "./config.js";
import { buildAppraisalServer } from "./server.js";
import { assertAssetGuard, ASSET_FIXTURES } from "@sub-rosa/sdk/asset-config";
import { validateContractNetwork } from "@sub-rosa/sdk/network";
import { rpc } from "@stellar/stellar-sdk";
import { DEFAULT_TOKEN_DECIMALS } from "@x402/stellar";

const config = configFromEnv();

assertAssetGuard({
  networkPassphrase: config.networkPassphrase!,
  contractId: config.asset,
  decimals: DEFAULT_TOKEN_DECIMALS,
}, ASSET_FIXTURES.valid.sac);

const serverRpc = new rpc.Server(config.rpcUrl);
await validateContractNetwork(serverRpc, {
  networkPassphrase: config.networkPassphrase!,
  contractId: config.asset,
  rpcUrl: config.rpcUrl
});

const server = await buildAppraisalServer(config);
server.listen(config.port, () => {
  diagnostics.info("sub-rosa-appraisal-api-on", `sub-rosa appraisal API on :${config.port} — POST /appraise costs ${config.price} on ${config.network}`);
  diagnostics.info("asset", `  asset ${config.asset}`);
  diagnostics.info("payto", `  payTo ${config.payTo}`);
});
