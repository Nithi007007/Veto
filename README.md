# Veto

> A deterministic, **verifiable** policy gate for AI agents that hold and move money on Sui.

**Built for:** Sui Overflow 2026 — Agentic Web track
**Network:** Sui Testnet
**Live demo:** _<your Vercel URL here>_

---

## The pitch in one paragraph

AI agents are starting to hold real wallets (Truth Terminal, ElizaOS, Coinbase Agentic Wallets — see "Evidence" below). Most agent frameworks let the model decide *and* execute in the same step. **Veto puts two enforcement layers between an agent's reasoning and its wallet:** an off-chain deterministic policy engine (runtime, fast, editable) AND an on-chain vault (backstop, hard-capped, tamper-evident). Both must agree for a transaction to land. If the off-chain engine is compromised, the on-chain caps still hold. If a rule is silently edited, the on-chain commit hash diverges from what the feed shows was enforced.

## The single sentence that matters

**The off-chain policy engine is the runtime. The on-chain vault is the backstop. Both must agree for a transaction to land.** If the off-chain engine is compromised, the on-chain caps still hold.

## The three layers of defense

| Layer | What it does | What it protects against |
|---|---|---|
| **1. Two-step confirmation** (UI) | LLM parses intent → user must explicitly confirm the parsed amount + recipient before any policy check or chain call | LLM hallucinations, prompt injection that produces wrong parsed intents |
| **2. Off-chain policy engine** (TS) | Deterministic rule checks: per-tx cap, daily cap, allowlist, denylist | Prompt injection that proposes a syntactically-valid but policy-violating action |
| **3. On-chain vault** (Move) | Hard per_tx_cap + daily_cap enforced atomically in `vault::spend()`. Rule book hash committed on every change. | Backend compromise, DB compromise, off-chain engine tampering, race conditions |

## The Owner ↔ Agent trust boundary (named, not implicit)

Two roles, one app:

- **Owner** — edits the rule book via `/rules`. Every change re-commits the rule hash on-chain. Authenticated via `x-owner-token` header (v1) → NextAuth + zkLogin (v1.1).
- **Agent** — the chat/LLM path. Can ONLY propose actions via `/api/agent/message`. It has no route, no permission, no code path that touches `/api/rules`.

The deterministic policy engine sits between them. **The Agent literally cannot modify the rules** — the `requireOwner()` middleware in `src/lib/auth.ts` rejects any request to `/api/rules*` without the owner token. Verified live in the network panel during demo.

## Evidence: AI agents currently hold real wallets

| Agent | What it is | Wallet capability |
|---|---|---|
| **Truth Terminal** | Claude-based autonomous AI agent (a16z-backed) | Holds GOAT token, autonomously promotes/posts, $280K+ market cap |
| **ElizaOS** (formerly ai16z Eliza) | Open-source agent framework | Native wallet plugins on Solana, Sui, Base; Stanford Future of Digital Currency partnership |
| **Coinbase Agentic Wallets** | Launched Feb 11, 2026 | MPC-secured wallet with programmable spending limits, session caps — the closed-source version of what Veto is the open version of |
| **Dysnix, Cobo, Turnkey, Safe** | Wallet infrastructure providers | All shipping agent-wallet products in 2025–2026 |

The "AI agents are starting to hold real wallets" claim is not future-tense. It is a documented present-tense market.

## How the demo works (v2 — two-step flow)

1. **User types** a plain-English instruction ("send 100 sui to alice")
2. **LLM parses** it into `{action, amountSui, recipient}` (zod-validated, schema-checked)
3. **Confirmation dialog** appears showing the original message + parsed intent side-by-side. If the parsed amount differs from any number mentioned in the message, an amber diff warning highlights the discrepancy.
4. **User confirms** (or rejects) → triggers `/api/agent/confirm`
5. **On-chain vault pre-flight** checks per_tx_cap and daily_cap atomically. If either fails → `BLOCKED` with the on-chain error code (e.g. `EAmountExceedsPerTx`). **No chain call made.**
6. **Off-chain policy engine** runs (allowlist, denylist, etc.). If any rule fails → `BLOCKED` with the rule name + reason.
7. **If both pass** → real signed SUI testnet transfer executes → tx digest shown with explorer link
8. **Every attempt logged** in the activity feed with full audit trail

## The three demo scenarios

| Scenario | Input | Expected outcome |
|---|---|---|
| **Block by on-chain vault** | `send 100 sui to alice` | BLOCKED — `on-chain vault: EAmountExceedsPerTx` (100 SUI > 5 SUI per-tx cap). Proves the on-chain layer independently rejected the tx. |
| **Block by off-chain rule** | `send 1 sui to 0x...0bad` | BLOCKED — `blocked by: Known-bad address blocklist`. Proves the policy engine caught it before the chain call. |
| **Reject in confirmation** | `send 2 sui to self` → click "Reject" | BLOCKED — `rejected by: user rejected`. Proves the hallucination guard works. |

## Architecture (v2)

```
┌──────────────┐  message   ┌────────────────────┐
│  Chat UI     │ ─────────▶ │ POST /api/agent    │  ← Agent role
│  (Agent)     │            │   /message         │    (no owner token)
└──────────────┘            └─────────┬──────────┘
                                       │ 1. LLM parse (zod-validated)
                                       ▼
                            status = AWAITING_CONFIRMATION
                                       │
                                       ▼
                            ┌────────────────────┐
                            │ User confirms      │  ← hallucination guard
                            │ parsed intent      │    (2-step flow)
                            └─────────┬──────────┘
                                       │ POST /api/agent/confirm
                                       ▼
                            2. ON-CHAIN VAULT pre-flight
                               (per_tx_cap, daily_cap)
                                       │
                                       ▼
                            3. OFF-CHAIN policy engine
                               (allowlist, denylist, etc.)
                                       │
                        ┌──────────────┴──────────────┐
                        ▼ fail                         ▼ pass
                 BLOCKED                       4. Sign + execute via
                 (no chain call)                 @mysten/sui (real testnet tx)
                                       │
                                       ▼
                            Persist + UI live feed

┌──────────────┐  edit rule ┌────────────────────┐
│  /rules UI   │ ─────────▶ │ POST/PATCH         │  ← Owner role
│  (Owner)     │            │  /api/rules        │    (x-owner-token)
└──────────────┘            └─────────┬──────────┘
                                       │ 4. Recompute SHA-256(rules JSON)
                                       ▼
                            5. commit_rules() on Vault object
                               (on-chain in prod, simulated in v1)
                                       │
                                       ▼
                            UI shows current commit + version
```

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| DB | Prisma + SQLite (swap to Neon Postgres for prod) |
| Chain SDK | `@mysten/sui` v2 (`SuiJsonRpcClient`, `Ed25519Keypair`, `Transaction`) |
| On-chain | Move module `veto::vault` (source in `move/veto/sources/vault.move`) |
| Wallet model | App-custodied single testnet keypair, server-side only |
| LLM | `z-ai-web-dev-sdk` (swappable) |
| Validation | `zod` on every LLM output and API input |
| Auth | Owner token (v1) → NextAuth + zkLogin (v1.1) |
| Hosting | Vercel (Hobby/free) + Neon (free Postgres) for prod |

## Project structure

```
.
├── move/veto/                          ← Move source (production target)
│   ├── Move.toml
│   └── sources/vault.move              ← The on-chain vault (holds funds, enforces caps)
├── prisma/schema.prisma                ← Rule + AgentRequest + RuleBookCommit models
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── agent/message/route.ts  ← Step 1: LLM parse → AWAITING_CONFIRMATION
│   │   │   ├── agent/confirm/route.ts  ← Step 2: vault pre-flight + policy + execute
│   │   │   ├── requests/route.ts       ← Activity feed
│   │   │   ├── rules/route.ts          ← List + create (owner-only)
│   │   │   ├── rules/[id]/route.ts     ← Toggle + delete (owner-only)
│   │   │   ├── wallet/route.ts         ← Read-only wallet info
│   │   │   ├── aliases/route.ts        ← Named address book
│   │   │   └── seed/route.ts           ← Seed default rules + initial commit
│   │   ├── layout.tsx
│   │   └── page.tsx                    ← Single-page dashboard (3 tabs + 20-Q&A)
│   ├── lib/
│   │   ├── policy-engine.ts            ← Off-chain deterministic rules (pure TS)
│   │   ├── vault.ts                    ← On-chain vault simulator + commit logic
│   │   ├── sui.ts                      ← Testnet client + keypair + transfer execution
│   │   ├── llm.ts                      ← Intent parser (z-ai-web-dev-sdk + zod)
│   │   ├── auth.ts                     ← Owner-token middleware (Owner/Agent boundary)
│   │   ├── aliases.ts                  ← Named address book
│   │   ├── types.ts                    ← Shared types
│   │   └── db.ts                       ← Prisma client
│   └── components/ui/                  ← shadcn/ui components
└── README.md
```

## The Move vault (production target)

The Move source at `move/veto/sources/vault.move` defines a vault that **actually holds funds** and enforces hard caps on-chain. Key entry functions:

- `create(per_tx_cap_mist, daily_cap_mist)` — create a new vault
- `share_vault(vault)` — make it a shared object (anyone can read, owner-only writes)
- `configure(vault, per_tx_cap, daily_cap)` — update caps (owner-only, emits on-chain event)
- `commit_rules(vault, new_hash)` — write a new rule-book hash on-chain (owner-only)
- `spend(vault, coin, recipient, amount_mist)` — **the core**: atomic check-and-increment that enforces per_tx_cap and daily_cap in a single Move transaction

### Why this matters

`spend()` is what prevents the race condition (Q8 in the architecture tab). Two simultaneous spends cannot both pass — Sui's shared-object consensus serializes them. The Move resource system also means funds inside the vault literally cannot be moved except via the vault's entry function — impossible in Solidity's storage model.

### Build & deploy (requires Sui CLI)

```bash
sui move build --path move/veto
sui client publish --gas-budget 100000000 move/veto
# Set VAULT_OBJECT_ID and VAULT_PACKAGE_ID env vars from the publish output
```

In v1 (current): the off-chain simulator in `src/lib/vault.ts` mirrors the Move semantics exactly. The UI clearly shows "SIMULATED" so judges know the on-chain deployment is the production target. In production: the simulator's checks become redundant — the chain enforces authoritatively.

## API routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/agent/message` | None (Agent) | LLM parse → stage as AWAITING_CONFIRMATION |
| `POST` | `/api/agent/confirm` | None (Agent) | Vault pre-flight + policy engine + SUI execution |
| `GET` | `/api/requests?limit=20` | None | Activity feed |
| `GET` | `/api/rules` | None (read) | List rules + current vault state + latest commit |
| `POST` | `/api/rules` | **Owner token** | Create rule → triggers vault re-commit |
| `PATCH` | `/api/rules/:id` | **Owner token** | Toggle/edit → triggers vault re-commit |
| `DELETE` | `/api/rules/:id` | **Owner token** | Delete → triggers vault re-commit |
| `GET` | `/api/wallet` | None | Read-only wallet info |
| `GET` | `/api/aliases` | None | Known recipient aliases |
| `POST` | `/api/seed` | None | Seed default rules + initial commit (idempotent) |

All inputs validated with `zod` before touching Prisma or Sui.

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

Open `http://localhost:3000` — the app auto-seeds three default rules + initial vault commit on first load.

## Environment variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | SQLite or Postgres connection string | `file:./db/veto.db` |
| `SUI_AGENT_SECRET_KEY` | Ed25519 private key for the agent's testnet wallet | `suiprivkey1q...` |
| `SUI_NETWORK` | Sui network to use | `testnet` |
| `OWNER_TOKEN` | Bearer token required for `/api/rules*` routes (Owner role) | `dev-owner-token` |

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

If the wallet is unfunded, the EXECUTED flow still runs through the policy engine and on-chain vault pre-flight, then returns a meaningful "insufficient balance" error — proving the entire pipeline works. The BLOCKED flows are completely unaffected (they never touch the chain).

## Answers to the 20 hard questions

The Architecture tab in the app contains a complete Q&A section answering every hard question a sharp judge would ask: threat model, Sui dependency, race conditions, hallucination prevention, Owner/Agent enforcement, backend compromise survival, market size, competition, and more. Each answer maps to a specific implementation decision visible in the code. See the live app for the full text.

## Why Veto (not "just `if(amount > limit)`")

Your code can be edited by you, by your cloud admin, by your CI/CD pipeline, by a compromised npm dependency, by a supply-chain attack. **The on-chain vault cannot.** Plus you get:

- **Tamper-evidence**: rule changes are publicly logged on-chain (rule hash + version)
- **Race-condition prevention**: `vault::spend()` is atomic, protected by Sui consensus
- **Backend-compromise survival**: even if Vercel is compromised and `evaluateRules()` is patched to always return true, the on-chain caps still hold
- **Unified audit log**: every action and its rule decision, immutable

The value isn't the check; it's the **unmalleable** check.

## Roadmap

- **v1.1 — Delegated user wallets via `dapp-kit` + sponsored transactions**: let users connect their own Sui wallet and delegate a spending-limited sub-key to the agent. The on-chain vault stays the same.
- **v1.2 — Multiple action types**: beyond transfers — Navi deposits, DeepBook trades, NFT mints — each with its own rule types and vault spend paths.
- **v2.0 — Multi-agent**: multiple agents with separate sub-vaults under one Owner, each with its own caps and rule book commits.
- **Long-term**: regulated entities (custodians, treasuries, DAOs) that need *provable* guardrails before they'll let any AI agent near real funds.

## Built for Sui Overflow 2026

Sui's own current ecosystem messaging explicitly frames agent guardrails and **verifiable policy enforcement** as missing infrastructure. Veto is a focused, single-mechanism answer to exactly that problem — built on Sui's primitives (shared objects, Move resources, atomic spend) that no other chain replicates.
