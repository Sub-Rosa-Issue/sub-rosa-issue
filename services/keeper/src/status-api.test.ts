import { buildStatusResponse } from "./status-api.js";

describe("buildStatusResponse", () => {
  it("returns ok:true", () => {
    const r = buildStatusResponse();
    expect(r.ok).toBe(true);
  });

  it("includes summary counts", () => {
    const r = buildStatusResponse();
    expect(typeof r.summary.total).toBe("number");
    expect(typeof r.summary.settled).toBe("number");
  });

  it("includes updatedAt timestamp", () => {
    const r = buildStatusResponse();
    expect(r.updatedAt).toBeTruthy();
  });
});
