# @sub-rosa/agent

Autonomous sealed-bid agents. Each agent holds a principal-signed session
mandate (scoped caps), pays the x402 appraisal API per call, sizes a bid from
the appraisal, and commits over Soroban RPC with its session key — no relayer,
no mock.

## Guard rails

Every `runBidderAgent` call enforces three layers of off-chain guards:

| Guard | Check | Error | When |
|-------|-------|-------|------|
| **Mandate signature** | Principal Ed25519 sig over canonical payload | `MandateError` | Before appraisal |
| **Appraisal spend cap** | Quoted price ≤ `appraisalPriceStroops`, cumulative ≤ `maxAppraisalSpendStroops` | `MandateCapError` | Before appraisal |
| **Bid mandate caps** | `bid ≤ maxBid`, `bid ≤ escrow ≤ maxEscrow` | `MandateCapError` | After appraisal |
| **Balance** | Session account SAC balance ≥ escrow | `InsufficientBalanceError` | After appraisal |

The balance check simulates a `balance(addr)` call against the configured
`usdcSacId` SAC contract using the RPC endpoint. This prevents the agent from
paying gas for a `commit` that would revert on-chain due to insufficient
escrow token balance.

Guards that run **before** appraisal (mandate signature, appraisal spend cap)
avoid wasting the appraisal fee. Guards that run **after** appraisal (bid
mandate caps, balance) depend on the appraisal result and prevent wasted gas
on a failing commit.

## Usage

```ts
import { createSessionMandate, runBidderAgent } from "@sub-rosa/agent";

const { mandate, sessionSecret } = createSessionMandate({
  principalSecret: "...",
  contractId: "...",
  roundId: 1n,
  itemRef: "sub-rosa://rfp/123",
  basePriceUsdc: 500,
  maxBidStroops: 7_000_000_000n,   // 700 USDC
  maxEscrowStroops: 7_000_000_000n, // 700 USDC
  maxAppraisalSpendStroops: 10_000_000n,
  appraisalPriceStroops: 1_000_000n,
  commitDeadline: Math.floor(Date.now() / 1000) + 3600,
});

const result = await runBidderAgent({
  mandate,
  sessionSecret,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  appraisalUrl: "http://localhost:3000/appraise",
  auditorPubkey: auditorPublicKey,
  revealRound: 12345,
  attributes: { quality: 88, demand: 82, scarcity: 92, risk: 12 },
  usdcSacId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
});
```

## API

See `src/index.ts` for the full export surface. Key exports:

- `runBidderAgent(config)` — autonomous bid: verify → appraise → seal → commit
- `createSessionMandate(params)` — issue a principal-signed session mandate
- `assertBidWithinMandate(mandate, bid, escrow)` — refuse cap violations
- `assertSufficientBalance(escrow, balance)` — refuse under-funded escrow
- `InsufficientBalanceError` — typed error with `.escrow` and `.balance` fields
