# Veto

> A deterministic policy gate for AI agents that hold and move money on Sui.

**Built for:** Sui Overflow 2026 — Agentic Web track
**Network:** Sui Testnet
**Live demo:** _<your Vercel URL here>_

---

## The pitch in one paragraph

AI agents are starting to hold real wallets and move real money — and almost every agent framework today lets the model decide *and* execute in the same step. One bad instruction, one prompt injection, one hallucination, and funds move. **Veto sits between the agent's reasoning and its wallet:** every proposed action is checked against a deterministic, human-defined rule book — code, not another model's opinion — before it's allowed anywhere near a signature. If a rule fails, the transaction never reaches the chain. If it passes, it executes for real, on Sui testnet, with the result and the rule that approved it both fully visible.

## The single sentence that matters

**No LLM call happens inside the policy engine.** The LLM parses intent (upstream, untrusted, zod-validated). The policy engine decides (downstream, deterministic, auditable). The chain only ever sees actions that passed every enabled rule.

## How the demo works

1. **Type a plain-English instruction** ("send 100 sui to alice")
2. **LLM parses it** into a structured `{action, amountSui, recipient}` object (zod-validated)
3. **Aliases are resolved** ("alice" → real Sui address)
4. **Policy engine evaluates** the intent against every enabled rule (pure TS, no model)
5. **Decision is made:**
   - If any rule fails → status = `BLOCKED`, the specific failing rule + reason is shown, **no chain call is made**
   - If all rules pass → a real signed transaction is submitted to Sui testnet, and the tx digest is shown with a link to the explorer

Every attempt — passed or blocked — is logged in the activity feed with the full audit trail.

## The three demo scenarios

| Scenario | Input | Expected outcome |
|---|---|---|
| **Block by per-tx cap** | `send 100 sui to alice` | BLOCKED — "Per-transaction cap" rule fires (limit: 5 SUI). No chain call. |
| **Block by denylist** | `send 1 sui to 0x...0bad` | BLOCKED — "Known-bad address blocklist" rule fires. No chain call. |
| **Approve + execute** | `send 0.5 sui to self` | APPROVED by policy engine → real signed transaction on Sui testnet → tx digest + explorer link. (Requires the agent wallet to be funded — see "Funding the agent wallet" below.) |

## Architecture

```
┌──────────────┐   message    ┌──────────────────┐
│  Chat UI     │ ───────────▶ │ POST /api/agent  │
│  (Next.js)   │              │   /message       │
└──────────────┘              └─────────┬────────┘
                                        │
                             1. LLM intent parse
                                (z-ai-web-dev-sdk →
                                 strict JSON, zod-validated)
                                        │
                                        ▼
                             2. Policy Engine (pure TS,
                                zero model calls)
                                — loads enabled rules from DB
                                — evaluates intent against each
                                        │
                        ┌───────────────┴────────────────┐
                        ▼ fail                            ▼ pass
                status = BLOCKED                3. Sign & execute via
                (store reason,                     @mysten/sui
                 no chain call)                   SuiJsonRpcClient + app's
                                                  own Ed25519 testnet
                                                  keypair (server-side only)
                        │                                    │
                        └─────────────┬──────────────────────┘
                                      ▼
                          Persist AgentRequest row
                          (Prisma → SQLite)
                                      │
                                      ▼
                            UI polls → live feed
```

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| DB | Prisma + SQLite (swap to Neon Postgres for prod) |
| Chain SDK | `@mysten/sui` v2 (`SuiJsonRpcClient`, `Ed25519Keypair`, `Transaction`) |
| Wallet model | App-custodied single testnet keypair, server-side only, never sent to client |
| LLM | `z-ai-web-dev-sdk` (swappable — abstracted behind one function) |
| Validation | `zod` on every LLM output and every API input |
| Hosting | Vercel (Hobby/free) for the app |

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── agent/message/route.ts   ← the one route that ties it all together
│   │   ├── requests/route.ts        ← activity feed
│   │   ├── rules/route.ts           ← list + create rules
│   │   ├── rules/[id]/route.ts      ← toggle + delete rules
│   │   ├── wallet/route.ts          ← read-only wallet display
│   │   ├── aliases/route.ts         ← named address book
│   │   └── seed/route.ts            ← seed default rules
│   ├── layout.tsx
│   └── page.tsx                     ← single-page dashboard (3 tabs)
├── lib/
│   ├── policy-engine.ts             ← the core: pure TS, no LLM calls
│   ├── sui.ts                       ← testnet client + keypair + transfer
│   ├── llm.ts                       ← intent parser (z-ai-web-dev-sdk)
│   ├── aliases.ts                   ← named address book
│   ├── types.ts                     ← shared types
│   └── db.ts                        ← Prisma client
└── components/ui/                   ← shadcn/ui components
```

## Local development

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env  # then edit values

# Push DB schema
bun run db:push

# Run dev server
bun run dev
```

Open `http://localhost:3000` — the app auto-seeds three default rules on first load.

## Environment variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | SQLite or Postgres connection string | `file:./db/veto.db` |
| `SUI_AGENT_SECRET_KEY` | Ed25519 private key for the agent's testnet wallet (generated locally) | `suiprivkey1q...` |
| `SUI_NETWORK` | Sui network to use | `testnet` |

### Generating a fresh agent keypair

```ts
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
const kp = Ed25519Keypair.generate();
console.log("SECRET:", kp.getSecretKey());      // → SUI_AGENT_SECRET_KEY
console.log("ADDR:", kp.getPublicKey().toSuiAddress());  // fund this from faucet
```

## Funding the agent wallet

The agent's testnet wallet needs SUI for the EXECUTED flow to actually land on-chain.

1. Get the agent address from the dashboard (or from the `SUI_AGENT_ADDRESS` env var)
2. Visit https://faucet.testnet.sui.io and request testnet SUI to that address
3. Wait ~10 seconds, refresh the dashboard — the balance should update
4. The EXECUTED flow will now succeed for any transfer within the policy rules

If the wallet is unfunded, the EXECUTED flow still works through the policy engine and returns a meaningful "insufficient balance" error — proving the entire pipeline up to and including the Sui call works correctly. The BLOCKED flows are completely unaffected (they never touch the chain).

## API routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/agent/message` | **The core pipeline:** parse → policy → execute → persist |
| `GET` | `/api/requests?limit=20` | Activity feed (newest first) |
| `GET` | `/api/rules` | List all rules |
| `POST` | `/api/rules` | Create a rule |
| `PATCH` | `/api/rules/:id` | Toggle enabled / update config |
| `DELETE` | `/api/rules/:id` | Delete a rule |
| `GET` | `/api/wallet` | Read-only wallet info (address, balance, network) |
| `GET` | `/api/aliases` | Known recipient aliases |
| `POST` | `/api/seed` | Seed default rules (idempotent) |

All inputs validated with `zod` before touching Prisma or Sui.

## Why no wallet-connect in v1 (scope decision, not a shortcut)

A user-facing wallet-connect flow (Sui Wallet extension, `dapp-kit`) adds real integration risk — browser extension state, signing prompts, network mismatches — for a feature that doesn't change the core argument of the project. The product's actual claim is **"an autonomous agent's own wallet is gated by deterministic policy,"** not "a human's wallet is gated." An app-custodied agent keypair is *more* architecturally honest to that pitch, not a cheaper version of it.

The natural v1.1 is "let a human delegate a spending-limited sub-key to the agent via their own wallet" — it's a strong answer if a judge asks "what's next," and it's true.

## Roadmap

- **v1.1 — Delegated user wallets via `dapp-kit`**: let users connect their own Sui wallet and delegate a spending-limited sub-key to the agent
- **v1.2 — On-chain rule book**: store the rule book as a Move object so it's tamper-evident on-chain, unlocking a real Package ID and verifiable audit trail
- **v2.0 — Multi-action agent**: beyond transfers — Navi deposits, DeepBook trades, NFT mints — each with its own rule types
- **Long-term**: regulated entities (custodians, treasuries) that need *provable* guardrails before they'll let any AI agent near real funds

## Built for Sui Overflow 2026

Sui's own current ecosystem messaging explicitly frames agent guardrails, spending limits, and verifiable policy enforcement as the open, unsolved problem in agentic crypto. Veto is a focused, single-mechanism answer to exactly that problem — built on Sui testnet, using `@mysten/sui` v2, with every chain action real and verifiable on the explorer.
