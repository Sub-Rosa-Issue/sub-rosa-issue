import * as fs from "fs";
import * as path from "path";

// 0600 = owner read/write only (Unix). On Windows, we set read-only + hidden
// as a close approximation since full ACL management is platform-specific.
const FILE_PERMISSIONS = 0o600;

export interface WatchedRound {
  roundId: string;
  contractId?: string;
  network?: string;
  revealRound?: string;
  lastStatus: string;
  retryCount: number;
  lastError?: string;
  lastAction?: string;
}

export interface StoreData {
  rounds: Record<string, WatchedRound>;
}

export class KeeperStore {
  private readonly storePath: string;
  private data: StoreData;

  constructor(storePath?: string) {
    this.storePath =
      storePath || process.env.KEEPER_STORE_PATH || ".keeper-store.json";
    this.data = this.loadStore();
  }

  private loadStore(): StoreData {
    if (!fs.existsSync(this.storePath)) {
      return { rounds: {} };
    }

    // Tighten existing file permissions to owner-only when safely opened.
    try {
      fs.chmodSync(this.storePath, FILE_PERMISSIONS);
    } catch (chmodErr) {
      // chmod may fail on some platforms; ignore gracefully.
      console.warn("[Store] Could not set file permissions on load:", chmodErr);
    }

    try {
      const content = fs.readFileSync(this.storePath, "utf-8");
      if (!content.trim()) return { rounds: {} };
      const parsed = JSON.parse(content) as Partial<StoreData>;
      if (!parsed.rounds || typeof parsed.rounds !== "object") {
        return { rounds: {} };
      }
      return parsed as StoreData;
    } catch (e) {
      console.warn(`[Store] Failed to parse ${this.storePath}. Backing up corrupted file and starting fresh.`);
      try {
        fs.renameSync(this.storePath, `${this.storePath}.corrupted.${Date.now()}`);
      } catch (backupErr) {
        console.error(`[Store] Could not backup corrupted file:`, backupErr);
      }
      return { rounds: {} };
    }
  }

  private saveStore(): void {
    try {
      // Ensure directory exists if path has one
      const dir = path.dirname(this.storePath);
      if (dir !== ".") {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), "utf-8");
      // Restrict file to owner-only permissions (0600) to prevent other users
      // on the host from reading sensitive keeper state.
      try {
        fs.chmodSync(this.storePath, FILE_PERMISSIONS);
      } catch (chmodErr) {
        // chmod may fail on some platforms; ignore gracefully.
        console.warn("[Store] Could not set file permissions:", chmodErr);
      }
    } catch (e) {
      console.error(`[Store] Failed to save store to ${this.storePath}:`, e);
    }
  }

  public addRound(roundId: bigint | number | string, extra: Partial<WatchedRound> = {}): void {
    const idStr = String(roundId);
    if (!this.data.rounds[idStr]) {
      this.data.rounds[idStr] = {
        roundId: idStr,
        lastStatus: "Unknown",
        retryCount: 0,
        ...extra,
      };
    } else {
      // If it exists, we can optionally update its fields
      this.data.rounds[idStr] = {
        ...this.data.rounds[idStr],
        ...extra,
      };
    }
    this.saveStore();
  }

  public removeRound(roundId: bigint | number | string): void {
    const idStr = String(roundId);
    if (this.data.rounds[idStr]) {
      delete this.data.rounds[idStr];
      this.saveStore();
    }
  }

  public updateRound(roundId: bigint | number | string, update: Partial<WatchedRound>): void {
    const idStr = String(roundId);
    if (this.data.rounds[idStr]) {
      this.data.rounds[idStr] = { ...this.data.rounds[idStr], ...update };
      this.saveStore();
    }
  }

  public getRound(roundId: bigint | number | string): WatchedRound | undefined {
    return this.data.rounds[String(roundId)];
  }

  public listRounds(): WatchedRound[] {
    // Return sorted by roundId mathematically
    return Object.values(this.data.rounds).sort((a, b) => {
      const aBig = BigInt(a.roundId);
      const bBig = BigInt(b.roundId);
      return aBig < bBig ? -1 : aBig > bBig ? 1 : 0;
    });
  }

  public getRawData(): StoreData {
    return this.data;
  }
}
