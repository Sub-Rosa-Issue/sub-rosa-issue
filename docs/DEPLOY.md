# Deploy & environment variables

Sub Rosa **does not require a committed `.env` file**. Secrets stay out of git; you inject them where each layer runs.

## Three layers

| Layer | Needs env? | When vars are read |
| --- | --- | --- |
| **Jury UI** (`apps/web`) | Optional | **Build time** (`VITE_*` baked into static JS) |
| **Keeper / appraisal API** | Yes (secrets) | **Runtime** (shell, systemd, Fly/Railway secrets) |
| **One-off scripts** (deploy, e2e) | Yes | **Runtime** (inline `VAR=… command` or CI secrets) |

---

## 1. Jury UI — ship without any env

The demo works from **embedded `DEMO_TRACE`** (`demo-trace.generated.ts` from `pnpm agents:e2e`). No `.env` needed.

```bash
pnpm install
pnpm web:build
# static output → apps/web/dist
```

Host `dist/` on Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3, etc.

**Build settings (generic):**

| Setting | Value |
| --- | --- |
| Install | `pnpm install` |
| Build | `pnpm web:build` |
| Output directory | `apps/web/dist` |
| Node | 22+ |

---

## 2. Jury UI — optional live contract poll

Only if you want **“Poll live contract”** on the deployed site, set these **before `pnpm web:build`** in the hosting UI (Vercel → Settings → Environment Variables, etc.).

Copy from `apps/web/.env.example`:

```bash
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
VITE_CONTRACT_ID=CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y
VITE_ROUND_ID=1
```

**Mainnet example** (live poll against mainnet smoke):

```bash
VITE_RPC_URL=https://rpc.ankr.com/stellar_soroban
VITE_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
VITE_CONTRACT_ID=CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX
VITE_ROUND_ID=1
```

Important: Vite only exposes vars prefixed with `VITE_`. They are **public** in the browser bundle — never put secret keys here.

### Local dev (optional)

```bash
cp apps/web/.env.example apps/web/.env.local
# edit VITE_* then:
pnpm web:dev
```

`.env.local` is gitignored; not required for production.

---

## 3. Keeper watch mode (runtime secrets)

Runs on a server/VM, not in the static site. No `.env` file required — export vars in the process manager:

```bash
export KEEPER_SECRET="S…"
export ROUND_CONTRACT_ID="C…"
export RPC_URL="https://soroban-testnet.stellar.org"
export NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
export WATCH_POLL_MS=15000
export WATCH_ROUND_IDS=1

pnpm keeper:watch
```

Or one line:

```bash
KEEPER_SECRET=S… ROUND_CONTRACT_ID=C… pnpm keeper:watch
```

On Fly.io / Railway / GitHub Actions: put the same names in **Secrets**, not in the web build.

See root `.env.example` for the full keeper variable list.

---

## 4. Deploy & settle scripts (runtime, inline)

Scripts read env at invocation — no `.env` file on disk:

```bash
OPERATOR_SECRET=S… pnpm mainnet:deploy

OPERATOR_SECRET=S… \
ROUND_CONTRACT_ID=CA7KSDEY… \
RPC_URL=https://rpc.ankr.com/stellar_soroban \
pnpm mainnet:settle
```

E2E scripts (`lifecycle:e2e`, `agents:e2e`) generate ephemeral keys via Stellar CLI — they do not need a root `.env` either.

---

## 5. Appraisal API (if you host it)

Runtime env for `pnpm appraisal:start`:

| Var | Purpose |
| --- | --- |
| `FACILITATOR_SECRET` | Signs/submits x402 settle txs |
| `PAY_TO` / server key | Receives USDC |
| `X402_NETWORK` | `stellar:testnet` (default) or `stellar:pubnet` |
| `NETWORK_PASSPHRASE` | Optional; when set, must match `X402_NETWORK` |
| `RPC_URL` | Soroban RPC; required for pubnet |
| `PAYMENT_ASSET` | SEP-41 contract; defaults to USDC for the selected network |
| `PRICE` | Appraisal price (default 0.10) |
| `PORT` | HTTP port (default 4021) |

Minimal local/testnet configuration:

```bash
export FACILITATOR_SECRET="S…"
export PAY_TO="G…"
export X402_NETWORK="stellar:testnet"
export NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

pnpm appraisal:start
```

Testnet defaults to the canonical testnet USDC contract, Soroban testnet RPC,
price `0.10`, and port `4021`. For pubnet, set
`X402_NETWORK=stellar:pubnet`, the public-network passphrase, and an explicit
`RPC_URL`; the default payment asset then changes to pubnet USDC.

Configuration errors fail before the HTTP server starts and name the affected
variable, for example:

```text
FACILITATOR_SECRET: missing required env var
PRICE: must be a finite number greater than 0
X402_NETWORK: unsupported network "stellar:mainnet"
NETWORK_PASSPHRASE: does not match X402_NETWORK=stellar:testnet
RPC_URL: is required when X402_NETWORK=stellar:pubnet
```

Agents point at the public URL via `X402_APPRAISAL_URL` — not baked into the web UI.

---

## Quick decision tree

```
Shipping jury demo only?
  → pnpm web:build, upload dist/, no env

Want live on-chain overlay on the site?
  → set VITE_* in hosting build env, then build

Running keeper 24/7?
  → KEEPER_SECRET + ROUND_CONTRACT_ID on the server (runtime)

Deploying new contract round?
  → OPERATOR_SECRET inline for mainnet:deploy / mainnet:settle
```

## Mainnet scripts

```bash
pnpm mainnet:verify              # read-only — no secrets
pnpm mainnet:micro               # dry-run checklist
MAINNET_CONFIRM=SUB_ROSA_MAINNET OPERATOR_SECRET=S… BIDDER_SECRET=S… \
  pnpm mainnet:micro -- --execute   # optional micro commit (≤1 XLM escrow)
```

## Security

- **Never** commit `.env` with secrets (already in `.gitignore`).
- **Never** put `S…` secret keys in `VITE_*` — they end up in public JS.
- Rotate any key that was pasted in chat or logs.
