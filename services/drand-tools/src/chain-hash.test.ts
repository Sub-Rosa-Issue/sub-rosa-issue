import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CHAIN_HASH_INVALID_ERROR,
  CHAIN_HASH_MISMATCH_ERROR,
  CHAIN_HASH_REQUIRED_ERROR,
  DRAND_API_URL_ENV,
  DRAND_CHAIN_HASH_ENV,
  DrandChainHashMismatchError,
  getBeacon,
  getChainInfo,
  loadDrandConfig,
  type Beacon,
  type ChainInfo,
} from "./quicknet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorPath = path.resolve(__dirname, "../../../test-vectors/quicknet.json");
const [fixture] = JSON.parse(fs.readFileSync(vectorPath, "utf-8")) as Array<{
  round: number;
  chain_hash: string;
  period: number;
  genesis_time: number;
  schemeID: string;
  signature: string;
  public_key: string;
  randomness?: string;
}>;

const API_BASE = "https://drand.invalid";
const MISMATCHED_HASH = "0".repeat(64);

function chainInfo(hash: string = fixture.chain_hash): ChainInfo {
  return {
    public_key: fixture.public_key,
    period: fixture.period,
    genesis_time: fixture.genesis_time,
    hash,
    schemeID: fixture.schemeID,
  };
}

function beacon(): Beacon {
  return {
    round: fixture.round,
    randomness: fixture.randomness ?? fixture.signature,
    signature: fixture.signature,
  };
}

function setEnv(
  t: TestContext,
  values: Record<string, string | undefined>,
): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function stubDrand(
  t: TestContext,
  info: ChainInfo,
  calls: string[],
): void {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push(url);
    const body = url.endsWith("/info") ? info : beacon();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

async function fetchRoundAfterChainCheck(): Promise<ChainInfo> {
  const config = loadDrandConfig();
  const info = await getChainInfo(config);
  await getBeacon(fixture.round, config);
  return info;
}

test("matching chain-hash fixture is accepted before round data", async (t) => {
  const calls: string[] = [];
  setEnv(t, {
    [DRAND_CHAIN_HASH_ENV]: fixture.chain_hash,
    [DRAND_API_URL_ENV]: API_BASE,
  });
  stubDrand(t, chainInfo(), calls);

  assert.deepEqual(await fetchRoundAfterChainCheck(), chainInfo());
  assert.deepEqual(calls, [
    `${API_BASE}/${fixture.chain_hash}/info`,
    `${API_BASE}/${fixture.chain_hash}/public/${fixture.round}`,
  ]);
});

test("mismatching chain-hash fixture rejects before round data", async (t) => {
  const calls: string[] = [];
  setEnv(t, {
    [DRAND_CHAIN_HASH_ENV]: fixture.chain_hash,
    [DRAND_API_URL_ENV]: API_BASE,
  });
  stubDrand(t, chainInfo(MISMATCHED_HASH), calls);

  await assert.rejects(
    fetchRoundAfterChainCheck(),
    (err: unknown) => {
      assert.ok(err instanceof DrandChainHashMismatchError);
      assert.equal(err.code, "DRAND_CHAIN_HASH_MISMATCH");
      assert.equal(err.message, CHAIN_HASH_MISMATCH_ERROR);
      assert.ok(!`${err.name}: ${err.message}`.includes(MISMATCHED_HASH));
      assert.ok(!`${err.name}: ${err.message}`.includes(fixture.chain_hash));
      return true;
    },
  );
  assert.deepEqual(calls, [`${API_BASE}/${fixture.chain_hash}/info`]);
});

test("missing configured chain hash fails before any fetch", async (t) => {
  const calls: string[] = [];
  setEnv(t, {
    [DRAND_CHAIN_HASH_ENV]: undefined,
    [DRAND_API_URL_ENV]: API_BASE,
  });
  stubDrand(t, chainInfo(), calls);

  await assert.rejects(fetchRoundAfterChainCheck(), {
    message: CHAIN_HASH_REQUIRED_ERROR,
  });
  assert.deepEqual(calls, []);
});

test("malformed configured chain hash fails before any fetch", async (t) => {
  const calls: string[] = [];
  setEnv(t, {
    [DRAND_CHAIN_HASH_ENV]: "not-a-chain-hash",
    [DRAND_API_URL_ENV]: API_BASE,
  });
  stubDrand(t, chainInfo(), calls);

  await assert.rejects(fetchRoundAfterChainCheck(), {
    message: CHAIN_HASH_INVALID_ERROR,
  });
  assert.deepEqual(calls, []);
});
