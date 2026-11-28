import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { WEB_SECURITY_HEADERS } from "./security-headers";

test("Vercel and static-host header configuration match the documented web policy", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const staticConfig = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
  assert.equal(config.headers[0].source, "/(.*)");
  assert.match(staticConfig, /^\/\*$/m);
  assert.deepEqual(
    Object.fromEntries(config.headers[0].headers.map(({ key, value }: { key: string; value: string }) => [key, value])),
    WEB_SECURITY_HEADERS,
  );
  for (const [name, value] of Object.entries(WEB_SECURITY_HEADERS)) {
    assert.ok(staticConfig.includes(`${name}: ${value}`));
  }
});
