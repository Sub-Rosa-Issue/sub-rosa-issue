# `@sub-rosa/appraisal-api`

x402-gated appraisal API. Agents pay per call in **USDC (SEP-41)** over Soroban;
the server self-facilitates — verifies the signed payment and settles on-chain
via RPC (no relayer, no mock) — then returns a **deterministic** valuation used
to size a sealed bid.

This package is an **integration boundary**. The HTTP shape, validation rules,
and error strings are part of the public contract. Anything documented here is
covered by fixtures in `src/fixtures/`.

## Request / response

### `POST /appraise` (x402-protected)

```json
{
  "itemRef": "sub-rosa://grant/42",
  "basePrice": 100,
  "category": "grant",
  "attributes": {
    "quality": 80,
    "demand": 60,
    "scarcity": 40,
    "risk": 20
  }
}
```

A successful response (200) returns:

```json
{
  "model": "subrosa-appraisal/v1",
  "itemRef": "sub-rosa://grant/42",
  "inputsHash": "ebbf2b155420d547f8630be982a1f87a11ab0bc3b183cbf57a1c1281779b3c14",
  "fairValue": 121.42,
  "low": 121.42,
  "high": 121.42,
  "confidence": 1,
  "suggestedMaxBid": 115.35,
  "rationale": [
    "base 100 USDC scaled by quality×1.3, demand×1.08, scarcity×0.94, risk×0.92",
    "category 'grant' multiplier ×1",
    "4/4 attributes supplied → confidence 1",
    "suggested max bid is fair value × 0.95 to preserve margin"
  ],
  "payment": {
    "transaction": "…",
    "network": "stellar:testnet",
    "payer": "G…"
  }
}
```

`POST /appraise` is **payment-protected**. Without an `X-PAYMENT` header the
server replies **HTTP 402** with the payment requirements (token, amount,
payTo, network). After the agent signs the Soroban auth entry and retries with
the header, the server settles on-chain and returns the appraisal body plus a
`payment` block carrying the on-chain transaction hash.

The other endpoints are free (used for healthchecks / discovery):

| Method | Path       | Purpose                          |
| ------ | ---------- | -------------------------------- |
| GET    | `/`        | Discovery: price, asset, network |
| GET    | `/healthz` | Health check                     |

## Schema fixtures

The canonical request/response shapes and the per-failure-mode payloads live as
JSON next to the source so integrators can copy-paste them.

| Fixture file                             | Shape                              | Expected server behavior |
| ---------------------------------------- | ---------------------------------- | ------------------------ |
| `src/fixtures/valid-request.json`        | Well-formed POST body              | `200 OK`, body matches `valid-response.json` |
| `src/fixtures/valid-response.json`       | Canonical 200 body                 | Stable shape, every field documented above |
| `src/fixtures/missing-fields.json`       | `itemRef` and `basePrice` omitted  | **400** — `itemRef must be a non-empty string` |
| `src/fixtures/wrong-types.json`          | Arrays / strings where scalars expected | **400** — `itemRef must be a non-empty string` (first field checked) |
| `src/fixtures/oversized-text.json`       | `itemRef` / `category` past the documented length caps | **400** — `itemRef must be at most 256 characters` (and `category` cap of 64) |
| `src/fixtures/invalid-score-values.json` | Attribute scores of wrong JSON type | **400** — `attributes.<field> must be a number` |

These are the **exact** payloads exercised by `src/appraisal-fixtures.test.ts`.
The fixture names are exported from `src/fixtures/index.ts` for use in other
packages should they want to assert against the same payloads.

## Validation rules (stable)

The validator returns **human-displayable** error strings. Treat them as part
of the public contract; if you change one, update the matching fixture and the
matching test.

| Rule | Error message |
| ---- | ------------- |
| `itemRef` missing / not a string / empty | `itemRef must be a non-empty string` |
| `itemRef` longer than 256 characters      | `itemRef must be at most 256 characters` |
| `basePrice` not a finite number > 0       | `basePrice must be a finite number > 0` |
| `category` present but not a string       | `category must be a string` |
| `category` longer than 64 characters      | `category must be at most 64 characters` |
| `attributes` present but not an object    | `attributes must be an object` |
| Any score not a finite number (string, boolean, array, object, null, NaN, Infinity) | `attributes.<field> must be a number` |
| Body is not a JSON object                 | `body must be a JSON object` |

Numeric scores outside `0..100` are **clamped** rather than rejected: integrators
may submit raw 0–100 survey data without coercing it first. NaN/Infinity *are*
rejected because they would otherwise propagate invalidly into the math.

## Quick start

```bash
pnpm appraisal:start   # boots the server on :4021
pnpm appraisal:test    # unit + fixture tests (no external calls)
pnpm appraisal:typecheck
```

For a paid end-to-end against testnet:
```bash
pnpm appraisal:e2e     # x402 handshake + on-chain settlement
```

## Determinism

The valuation is a pure function of `(itemRef, basePrice, category, attributes)`.
`inputsHash` is `sha256` of the canonical-JSON form (sorted keys, sorted
attribute keys) so an auditor can bind a paid appraisal to the exact request
that produced it. Two structurally identical requests with differently ordered
keys hash to the same value.

## License

MIT — see the root `LICENSE`.
