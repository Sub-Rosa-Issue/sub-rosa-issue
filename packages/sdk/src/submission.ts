// SPDX-License-Identifier: MIT

/** A stable identity for one logical contract operation. */
export interface SubmissionIdentity {
  operation: string;
  roundId: string | null;
  network: string;
  contractId: string;
  /** Distinguishes repeated operations in the same round (for example bidder reveals). */
  discriminator?: string;
}

export type SubmissionState = "pending" | "confirmed" | "expired" | "failed";

export interface SubmissionRecord extends SubmissionIdentity {
  hash: string;
  state: SubmissionState;
  submittedAtMs: number;
  expiresAtMs: number;
  relayerTransactionId?: string | null;
  resultXdr?: string;
  failure?: string;
}

/** Durable storage supplied by the host application; never store signed XDR or secrets. */
export interface SubmissionJournal {
  get(identity: SubmissionIdentity): Promise<SubmissionRecord | undefined>;
  put(record: SubmissionRecord): Promise<void>;
}

export function submissionKey(identity: SubmissionIdentity): string {
  return JSON.stringify([
    identity.network,
    identity.contractId,
    identity.operation,
    identity.roundId,
    identity.discriminator ?? "",
  ]);
}
