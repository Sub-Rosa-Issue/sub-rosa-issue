export class SubRosaNetworkMismatchError extends Error {
  readonly name = "SubRosaNetworkMismatchError";
  readonly networkPassphrase: string;
  readonly rpcUrl: string;

  constructor(networkPassphrase: string, rpcUrl: string, message: string) {
    super(message);
    this.networkPassphrase = networkPassphrase;
    this.rpcUrl = rpcUrl;
  }
}
