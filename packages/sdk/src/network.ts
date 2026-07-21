import { Contract, rpc } from "@stellar/stellar-sdk";
import { SubRosaNetworkMismatchError } from "./errors.js";

export type NetworkValidationServer = Pick<
  rpc.Server,
  "getNetwork" | "getLedgerEntries"
>;

export interface ContractNetworkValidationConfig {
  networkPassphrase: string;
  contractId: string;
  rpcUrl: string;
}

/**
 * Confirm that the RPC is on the configured network and that the contract
 * exists there. Contract StrKeys do not encode a network, so both checks are
 * required to catch a contract ID copied from another deployment.
 */
export async function validateContractNetwork(
  server: NetworkValidationServer,
  config: ContractNetworkValidationConfig,
): Promise<void> {
  const network = await server.getNetwork();
  if (network.passphrase !== config.networkPassphrase) {
    throw new SubRosaNetworkMismatchError({
      contractId: config.contractId,
      configuredPassphrase: config.networkPassphrase,
      rpcPassphrase: network.passphrase,
      rpcUrl: config.rpcUrl,
      reason: "passphrase",
    });
  }

  const contractKey = new Contract(config.contractId).getFootprint();
  const response = await server.getLedgerEntries(contractKey);
  if (response.entries.length === 0) {
    throw new SubRosaNetworkMismatchError({
      contractId: config.contractId,
      configuredPassphrase: config.networkPassphrase,
      rpcPassphrase: network.passphrase,
      rpcUrl: config.rpcUrl,
      reason: "contract_not_found",
    });
  }
}
