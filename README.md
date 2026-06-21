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

## The three layers of defense (with explicit threat model)

| Layer | What it does | Threat mitigated |
|---|---|---|
| **1. Two-step confirmation** (UI) | LLM parses intent → user must explicitly confirm the parsed amount + recipient before any policy check or chain call | **T2 — LLM hallucination** (model fabricates amount/recipient), **T3 — compromised LLM response** (MITM injects fake completion) |
| **2. Off-chain policy engine** (TS) | Deterministic rule checks: per-tx cap, daily cap, allowlist, denylist. **Zero API calls inside the policy function.** | **T1 — prompt injection** (injected instruction still has to clear amount caps and address lists regardless of how it was produced) |
| **3. On-chain vault** (Move) | Hard per_tx_cap + daily_cap enforced atomically in `vault::spend()`. Rule book hash committed on every change. **OwnerCap pattern: protocol-level authorization, not app-level.** | **T4 — rule book tampering** (DB edits bypassing /api/rules show up as hash mismatch), **T6 — Owner/Agent boundary** (OwnerCap object required to call configure/commit_rules; rejected at protocol level if absent) |
| **4. Idempotency key** (T5) | Hash of (message + amount + recipient) checked against recent EXECUTED requests. 60-second window. | **T5 — replay / double-submit** (network retry executes same transfer twice) |

### Threat model — explicit, named

| Threat | Scenario | Mitigation | Demo-able? |
|---|---|---|---|
| **T1** Prompt injection | Agent reads untrusted external content (a webpage, a message) containing a hidden instruction | Policy engine evaluates the final structured intent regardless of *how* it was produced — injected instruction still has to clear caps and lists | Yes — type an injected-looking instruction, show it blocked |
| **T2** LLM hallucination | Model fabricates an amount/recipient that wasn't actually intended | `zod` validation + hard caps apply regardless of intent source + two-step confirmation | Yes — type "ten SUI to alice", see the parsed 10 SUI, reject if wrong |
| **T3** Compromised LLM response | Bad API response or MITM injects a fake completion | Policy engine doesn't trust the upstream source — it's the last line of defense by design | Architecturally shown — policy-engine.ts has zero LLM imports |
| **T4** Rule book tampering | Someone edits rules directly in the DB, bypassing /api/rules | On-chain commit hash; UI recomputes local hash on every load and shows red "RULES DON'T MATCH" banner on mismatch | **Yes — live demo: edit DB directly, see red banner fire** |
| **T5** Replay / double-submit | Network retry executes the same transfer twice | Idempotency key (hash of message + amount + recipient), 60-second window | Yes — submit same intent twice rapidly, second one blocked |
| **T6** Owner/Agent boundary | "Two route names" isn't real access control — anyone hitting the API could call /api/rules | OWNER_PASSWORD env var + signed session cookie (v1) + OwnerCap object on Sui (production). The Sui runtime checks object ownership BEFORE your Move code runs | **Yes — curl /api/rules without cookie → 401; in production, show rejected no-cap tx on-chain** |

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
| `POST` | `/api/agent/confirm` | None (Agent) | Idempotency check (T5) → vault pre-flight → policy engine → SUI execution |
| `GET` | `/api/requests?limit=20` | None | Activity feed |
| `GET` | `/api/rules` | None (read) | List rules + current vault state + latest commit + **tamper detection flag** |
| `POST` | `/api/rules` | **Owner cookie/token** | Create rule → triggers vault re-commit (returns `commitDurationMs`) |
| `PATCH` | `/api/rules/:id` | **Owner cookie/token** | Toggle/edit → triggers vault re-commit |
| `DELETE` | `/api/rules/:id` | **Owner cookie/token** | Delete → triggers vault re-commit |
| `POST` | `/api/owner/login` | None | Verify password → set signed session cookie |
| `POST` | `/api/owner/logout` | None | Clear session cookie |
| `GET` | `/api/owner/status` | None | Returns `{ authenticated: boolean }` |
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

# (Local dev only) Switch to SQLite schema for offline dev
./scripts/switch-db.sh sqlite
bun run db:push

# Run dev server
bun run dev
```

Open `http://localhost:3000` — the app auto-seeds three default rules + initial vault commit on first load.

### 🚨 Before deploying to Vercel: switch to Postgres

**SQLite does NOT work on Vercel.** Serverless functions get a fresh filesystem on
every request — a SQLite file written to disk doesn't persist. Your rule book and
history will silently reset in production even though everything works on localhost.

```bash
# 1. Create a free Postgres instance at https://neon.tech
# 2. Set DATABASE_URL in .env to the pooled Neon connection string
# 3. Switch the active schema to Postgres + push
./scripts/switch-db.sh postgres
bun run db:push

# 4. Run the pre-deploy check (catches SQLite + missing env vars)
./scripts/pre-deploy-check.sh
```

Then commit the Postgres `prisma/schema.prisma` to your repo before pushing to GitHub
for Vercel import.

## Tests

```bash
# Unit tests for the policy engine (pure functions, no DB or network)
bun run test

# API smoke test (requires dev server running on localhost:3000)
bun run test:api

# Watch mode
bun run test:watch
```

The policy-engine test suite (`tests/policy-engine.test.ts`) imports the REAL
`evaluateRule` and `runPolicyEngine` from `src/lib/policy-engine.ts` — if the tests
pass, the engine is correct against the spec. 19 tests, all passing.

The API smoke test (`tests/api-test.sh`) verifies all 6 threat mitigations end-to-end:
T6 (auth), T4 (tamper detection), T5 (idempotency), the on-chain vault block path,
and the two-step confirmation flow. 10/10 passing against localhost.

The manual test checklist (`tests/manual-test-checklist.md`) covers everything that
needs a browser or real chain state, with the SQLite-on-Vercel warning placed at the
top so it gets caught first.

## Environment variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | SQLite (`file:`) for local dev OR Postgres (`postgresql://`) for production | `postgresql://user:pass@host/db?sslmode=require` |
| `SUI_AGENT_SECRET_KEY` | Ed25519 private key for the agent's testnet wallet | `suiprivkey1q...` |
| `SUI_NETWORK` | Sui network to use | `testnet` |
| `OWNER_PASSWORD` | Password for `POST /api/owner/login` (sets session cookie) | `dev-owner-password` |
| `OWNER_TOKEN` | (optional) Bearer token for API clients — alternative to cookie | `dev-owner-token` |
| `OWNER_COOKIE_SECRET` | (optional) HMAC secret for signing session cookies. Defaults to `OWNER_PASSWORD` if not set | `random-32-byte-hex` |
| `VAULT_OBJECT_ID` | (production) Shared `Vault` object ID, returned by `sui client publish` | `0x...` |
| `VAULT_PACKAGE_ID` | (production) Package ID, returned by publish | `0x...` |
| `OWNER_CAP_ID` | (production) `OwnerCap` object ID — kept server-side only | `0x...` |

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

## Why Sui specifically (the OwnerCap argument)

The honest version of "why Sui": nothing in the basic pitch couldn't run on any chain with a `require(msg.sender == owner)` check. The Sui-specific version is the **OwnerCap capability pattern**.

The Move module is designed so updating the rule registry requires *possessing a capability object*, not just passing a permission check in code:

```move
public struct OwnerCap has key, store {}

public fun commit_rules(
    _cap: &OwnerCap,
    registry: &mut Vault,
    new_hash: vector<u8>,
) {
    registry.rules_commit_hash = new_hash;
    registry.rules_version = registry.rules_version + 1;
}
```

On an account-based chain (Ethereum, Solana, etc.), "only the owner can do this" lives entirely inside mutable application code. On Sui, possessing the right object *is* the authorization — the runtime checks object ownership before your Move code even runs. A transaction that doesn't include the `OwnerCap` literally cannot call `commit_rules` or `configure`, full stop, at the protocol level.

**This is demo-able as fact, not asserted as a slide:** try the call without the cap in a Sui CLI terminal, show it get rejected on-chain, clip it or do it live. The app-level password (`OWNER_PASSWORD` env var + cookie) is for convenience — the actual authority boundary is enforced by the chain itself.

This is also the same fix as T6, just enforced one layer deeper — at the chain level instead of (or in addition to) the app level.

## Who buys this — three concrete buyers, not "everyone"

1. **DAOs and treasury teams** delegating limited authority to an agent for routine ops (recurring payments, rebalancing, yield farming). They need enforceable, provable limits *before* a governance vote will approve delegating anything real. The on-chain vault + tamper-evident rule commit is exactly the audit trail their governance committee asks for.

2. **Agent framework providers** (ElizaOS, ai16z, LangChain, CrewAI). Distribution path: bundle Veto's policy layer as a default safety module inside an agent SDK, the way payment processors bundle fraud checks rather than making every merchant build their own. Coinbase already shipped this internally as part of AgentKit — Veto is the open, framework-agnostic version.

3. **Custodians and regulated entities** piloting agentic execution. Compliance teams need an auditable control layer, and "capability-enforced, on-chain-verifiable policy" is language they can actually evaluate — unlike "we trust the model." The enterprise wedge: regulated capital can't move via an AI agent without a provable policy layer between the agent and the wallet.

**Monetization, stated plainly and not oversold:** open-source the policy engine for adoption and trust. Charge for a hosted multi-agent dashboard and compliance export (CSV/PDF audit reports tied to on-chain commit hashes). Standard open-core, easy for a judge to believe.

## Evidence — turn every claim into something shown, not said

| Claim | Live proof |
|---|---|
| "Deterministic, not another model" | Show `src/lib/policy-engine.ts`, 5 seconds, point out zero API imports |
| "Tamper-evident" | Edit a rule via UI → on-chain hash changes → click Explorer. Then edit the DB directly via `sqlite3`/Prisma Studio → red "RULE BOOK TAMPERING DETECTED" banner fires within 15 seconds |
| "Real transaction" | Click the Explorer link live in the activity feed — not a screenshot |
| "Owner-only, enforced by Sui" | In production: show the rejected no-cap transaction attempt on Sui Explorer. In v1: show `curl /api/rules` returning 401 without the session cookie |
| "Fast enough for real iteration" | UI shows actual measured commit time ("committed in 0.002s" simulated, ~1.8s on Sui testnet in production) — not "fast" |
| "Idempotent" | Submit same intent twice within 60s → second one blocked with `idempotency_check` |

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
