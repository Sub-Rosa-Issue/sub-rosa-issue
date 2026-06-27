import { recoverIdentities } from "./auditor-recovery.js";

const BLOB = {
  roundId: "round-test-1",
  entries: [
    {
      commitHash: "abc123",
      encryptedIdentity: Buffer.from("alice@example.com").toString("base64"),
      bidderPublicKey: "GABC",
    },
    {
      commitHash: "def456",
      encryptedIdentity: Buffer.from("bob@example.com").toString("base64"),
    },
  ],
  createdAt: "2026-06-27T00:00:00Z",
};

describe("recoverIdentities", () => {
  it("returns one identity per entry", () => {
    const result = recoverIdentities(BLOB, "STEST");
    expect(result).toHaveLength(2);
  });

  it("maps commitHash correctly", () => {
    const result = recoverIdentities(BLOB, "STEST");
    expect(result[0].commitHash).toBe("abc123");
    expect(result[1].commitHash).toBe("def456");
  });

  it("includes bidderPublicKey when present", () => {
    const result = recoverIdentities(BLOB, "STEST");
    expect(result[0].bidderPublicKey).toBe("GABC");
    expect(result[1].bidderPublicKey).toBeUndefined();
  });

  it("decodes base64 identity", () => {
    const result = recoverIdentities(BLOB, "STEST");
    expect(result[0].identity).toBe("alice@example.com");
  });
});
