// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Keypair, Networks } from "@stellar/stellar-sdk";
import {
  DEFAULT_TESTNET_RPC_URL,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  USDC_PUBNET_ADDRESS,
  USDC_TESTNET_ADDRESS,
} from "@x402/stellar";

import { AppraisalConfigError, configFromEnv } from "./config.js";

const facilitator = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const payee = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));

const MINIMAL_ENV = {
  FACILITATOR_SECRET: facilitator.secret(),
  PAY_TO: payee.publicKey(),
};

function assertConfigError(
  env: Record<string, string | undefined>,
  variable: string,
  message?: RegExp,
): void {
  assert.throws(
    () => configFromEnv(env),
    (error: unknown) => {
      assert.ok(error instanceof AppraisalConfigError);
      assert.equal(error.variable, variable);
      assert.match(error.message, new RegExp(`^${variable}:`));
      if (message) assert.match(error.message, message);
      return true;
    },
  );
}

describe("configFromEnv valid configurations", () => {
  test("builds a minimal testnet config with safe defaults", () => {
    const config = configFromEnv(MINIMAL_ENV);

    assert.deepEqual(config, {
      facilitatorSecret: facilitator.secret(),
      payTo: payee.publicKey(),
      asset: USDC_TESTNET_ADDRESS,
      price: 0.1,
      network: STELLAR_TESTNET_CAIP2,
      networkPassphrase: Networks.TESTNET,
      rpcUrl: DEFAULT_TESTNET_RPC_URL,
      port: 4021,
      trustedProxyIps: [],
    });
  });

  test("parses and normalizes trusted proxy socket addresses", () => {
    assert.deepEqual(
      configFromEnv({ ...MINIMAL_ENV, TRUSTED_PROXY_IPS: "127.0.0.1, ::ffff:127.0.0.1, 2001:db8::1" }).trustedProxyIps,
      ["127.0.0.1", "2001:db8::1"],
    );
  });

  test("rejects non-IP trusted proxy values", () => {
    assertConfigError({ ...MINIMAL_ENV, TRUSTED_PROXY_IPS: "invalid" }, "TRUSTED_PROXY_IPS");
  });

  test("rejects unsupported networks", () => {
    assertConfigError(
      { ...MINIMAL_ENV, X402_NETWORK: "stellar:mainnet" },
      "X402_NETWORK",
      /unsupported network/,
    );
  });

  test("rejects a network/passphrase mismatch", () => {
    assertConfigError(
      {
        ...MINIMAL_ENV,
        X402_NETWORK: STELLAR_TESTNET_CAIP2,
        NETWORK_PASSPHRASE: Networks.PUBLIC,
      },
      "NETWORK_PASSPHRASE",
      /does not match/,
    );
  });

  test("requires a custom RPC URL for pubnet", () => {
    assertConfigError(
      {
        ...MINIMAL_ENV,
        X402_NETWORK: STELLAR_PUBNET_CAIP2,
        NETWORK_PASSPHRASE: Networks.PUBLIC,
      },
      "RPC_URL",
      /required when X402_NETWORK=stellar:pubnet/,
    );
  });

  test("rejects malformed Stellar keys and addresses", () => {
    assertConfigError(
      { ...MINIMAL_ENV, FACILITATOR_SECRET: "not-a-secret" },
      "FACILITATOR_SECRET",
    );
    assertConfigError({ ...MINIMAL_ENV, PAY_TO: "not-an-address" }, "PAY_TO");
    assertConfigError(
      { ...MINIMAL_ENV, PAYMENT_ASSET: "not-a-contract" },
      "PAYMENT_ASSET",
    );
  });

  test("rejects malformed RPC URLs", () => {
    assertConfigError(
      { ...MINIMAL_ENV, RPC_URL: "not-a-url" },
      "RPC_URL",
    );
    assertConfigError(
      { ...MINIMAL_ENV, RPC_URL: "ftp://rpc.example.com" },
      "RPC_URL",
    );
  });

  test("rejects RPC URLs containing credentials without echoing them", () => {
    const cases = [
      {
        url: "https://alice:secret123@rpc.example.com",
        credentials: ["alice", "secret123"],
      },
      {
        url: "https://alice@rpc.example.com",
        credentials: ["alice"],
      },
      {
        url: "https://:secret123@rpc.example.com",
        credentials: ["secret123"],
      },
      {
        url: "http://admin:pass@localhost:8000",
        credentials: ["admin", "pass"],
      },
    ];

    for (const { url, credentials } of cases) {
      assert.throws(
        () => configFromEnv({ ...MINIMAL_ENV, RPC_URL: url }),
        (error: unknown) => {
          assert.ok(error instanceof AppraisalConfigError);
          assert.equal(error.variable, "RPC_URL");
          assert.match(error.message, /must not contain credentials/);
          for (const secret of credentials) {
            assert.ok(
              !error.message.includes(secret),
              `Error message should not echo credential: ${secret}`,
            );
          }
          return true;
        },
      );
    }
  });
});

describe("RPC URL embedded credentials", () => {
  for (const credentials of ["private-user@", ":private-password@", "private-user:private-password@", "private%2Duser:private%2Dpassword@"]) {
    test(`rejects credential form ${credentials.indexOf(":") >= 0 ? "password" : "username"}`, () => {
      assert.throws(() => configFromEnv({ ...MINIMAL_ENV, RPC_URL: `https://${credentials}rpc.example/` }), (error: unknown) => {
        assert.ok(error instanceof AppraisalConfigError);
        assert.equal(error.variable, "RPC_URL");
        assert.match(error.message, /must not contain credentials/);
        assert.doesNotMatch(error.stack ?? error.message, /private-user|private-password|private%2D/);
        assert.equal(error.cause, undefined);
        return true;
      });
    });
  }
  for (const RPC_URL of ["http://localhost:8000", "https://rpc.example/path"]) {
    test(`accepts credential-free ${RPC_URL}`, () => {
      assert.equal(configFromEnv({ ...MINIMAL_ENV, RPC_URL }).rpcUrl, RPC_URL);
    });
  }
});
