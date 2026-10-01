// Copyright (c) 2026 Sub Rosa contributors
// Durable recovery journal shared with the SDK submit path.
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  SubmissionIdentity,
  SubmissionJournal,
  SubmissionRecord,
} from "@sub-rosa/sdk";
import { submissionKey } from "@sub-rosa/sdk";

export const DEFAULT_SUBMISSION_JOURNAL_PATH = ".keeper-submissions.json";

interface JournalFile {
  version: 1;
  network: string;
  contractId: string;
  records: Record<string, SubmissionRecord>;
}

export class SubmissionJournalBindingError extends Error {
  constructor(field: "network" | "contractId", expected: string, actual: string) {
    super(`submission journal ${field} ${JSON.stringify(actual)} does not match configured ${JSON.stringify(expected)}`);
    this.name = "SubmissionJournalBindingError";
  }
}

export interface FileSubmissionJournalOptions {
  network: string;
  contractId: string;
  path?: string;
}

/** File-backed journal; records hashes and operation metadata only, never XDR or keys. */
export class FileSubmissionJournal implements SubmissionJournal {
  readonly filePath: string;
  private readonly network: string;
  private readonly contractId: string;
  private data: JournalFile;

  constructor(options: FileSubmissionJournalOptions) {
    this.filePath = options.path ?? process.env.KEEPER_SUBMISSION_PATH ?? DEFAULT_SUBMISSION_JOURNAL_PATH;
    this.network = options.network;
    this.contractId = options.contractId;
    this.data = this.load();
  }

  private load(): JournalFile {
    if (!fs.existsSync(this.filePath)) {
      return { version: 1, network: this.network, contractId: this.contractId, records: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<JournalFile>;
    if (parsed.network !== this.network) {
      throw new SubmissionJournalBindingError("network", this.network, String(parsed.network ?? ""));
    }
    if (parsed.contractId !== this.contractId) {
      throw new SubmissionJournalBindingError("contractId", this.contractId, String(parsed.contractId ?? ""));
    }
    if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object" || Array.isArray(parsed.records)) {
      throw new Error(`unsupported or malformed submission journal at ${this.filePath}`);
    }
    const records: Record<string, SubmissionRecord> = {};
    for (const [key, value] of Object.entries(parsed.records)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`malformed submission record at ${this.filePath}`);
      }
      const record = value as SubmissionRecord;
      if (
        typeof record.operation !== "string" ||
        !(typeof record.roundId === "string" || record.roundId === null) ||
        typeof record.hash !== "string" || !record.hash ||
        !["pending", "confirmed", "expired", "failed"].includes(record.state) ||
        !Number.isFinite(record.submittedAtMs) ||
        !Number.isFinite(record.expiresAtMs) ||
        record.network !== this.network ||
        record.contractId !== this.contractId ||
        key !== submissionKey(record)
      ) {
        throw new Error(`malformed or mismatched submission record at ${this.filePath}`);
      }
      records[key] = { ...record };
    }
    return { version: 1, network: this.network, contractId: this.contractId, records };
  }

  async get(identity: SubmissionIdentity): Promise<SubmissionRecord | undefined> {
    this.assertBinding(identity);
    const record = this.data.records[submissionKey(identity)];
    return record ? { ...record } : undefined;
  }

  async put(record: SubmissionRecord): Promise<void> {
    this.assertBinding(record);
    this.data.records[submissionKey(record)] = { ...record };
    const directory = path.dirname(this.filePath);
    if (directory !== ".") fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }

  private assertBinding(identity: SubmissionIdentity): void {
    if (identity.network !== this.network) {
      throw new SubmissionJournalBindingError("network", this.network, identity.network);
    }
    if (identity.contractId !== this.contractId) {
      throw new SubmissionJournalBindingError("contractId", this.contractId, identity.contractId);
    }
  }
}
