import fs from "fs";
import os from "os";
import path from "path";
import { loadQueue, saveQueue, enqueue, updateEntry, getPending } from "./queue.js";

let tmpFile: string;
beforeEach(() => { tmpFile = path.join(os.tmpdir(), `queue-test-${Date.now()}.json`); });
afterEach(() => { try { fs.unlinkSync(tmpFile); } catch {} });

describe("keeper queue", () => {
  it("returns empty queue when file does not exist", () => {
    const q = loadQueue(tmpFile);
    expect(q.entries).toHaveLength(0);
  });

  it("enqueues a new round", () => {
    enqueue("round-1", tmpFile);
    const q = loadQueue(tmpFile);
    expect(q.entries).toHaveLength(1);
    expect(q.entries[0].roundId).toBe("round-1");
    expect(q.entries[0].status).toBe("pending");
  });

  it("does not duplicate an existing round", () => {
    enqueue("round-1", tmpFile);
    enqueue("round-1", tmpFile);
    expect(loadQueue(tmpFile).entries).toHaveLength(1);
  });

  it("updates entry status", () => {
    enqueue("round-1", tmpFile);
    updateEntry("round-1", { status: "settled" }, tmpFile);
    const q = loadQueue(tmpFile);
    expect(q.entries[0].status).toBe("settled");
    expect(q.entries[0].attempts).toBe(1);
  });

  it("returns only pending entries", () => {
    enqueue("r1", tmpFile); enqueue("r2", tmpFile);
    updateEntry("r1", { status: "settled" }, tmpFile);
    const pending = getPending(tmpFile);
    expect(pending).toHaveLength(1);
    expect(pending[0].roundId).toBe("r2");
  });

  it("persists across reloads", () => {
    enqueue("r-persist", tmpFile);
    const q2 = loadQueue(tmpFile);
    expect(q2.entries.find(e => e.roundId === "r-persist")).toBeTruthy();
  });
});
