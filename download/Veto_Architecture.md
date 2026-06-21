# Veto — Architecture

> Veto is a deterministic, verifiable policy gate for AI agents operating on the
> Sui network. This document describes the production target architecture: a
> Next.js frontend on Vercel, a Hono API server on Render, a Sui Move vault on
> Sui Testnet, a Neon Postgres database for state, and an Upstash Redis instance
> for rate-limiting.

The single design principle: **no agent action touches the chain unless it
passes a deterministic, replay-checkable policy gate that the owner signed off
on**. Every other choice in this document follows from that.

---

## 1. System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
                         │                  USER / OWNER                │
                         │   (browser, owns OWNER_PASSWORD + OwnerCap)  │
                         └───────────────┬─────────────────────────────┘
                                         │ HTTPS (cookies, SameSite=None)
                                         ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  FRONTEND  (Next.js 16 + React 19 + Tailwind + shadcn/ui)           │
   │  hosted on Vercel — static export + server components               │
   │                                                                     │
   │   ┌──────────────┐  ┌─────────────┐  ┌─────────────────────────┐    │
   │   │ Dashboard    │  │ Rule Book   │  │ Architecture / Audit    │    │
   │   │ (chat + WAL) │  │ (CRUD)      │  │ (vault commits, hashes) │    │
   │   └──────┬───────┘  └──────┬──────┘  └───────────┬─────────────┘    │
   └──────────┼─────────────────┼─────────────────────┼──────────────────┘
              │                 │                     │
              │ fetch() with    │ owner-session       │ poll every 15s
              │ credentials     │ cookie              │ for tamper check
              ▼                 ▼                     ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  BACKEND  (Hono on Node.js runtime — deployed to Render)            │
   │                                                                     │
   │   ┌─────────────────────────────────────────────────────────────┐   │
   │   │  API layer  (13 routes — see API.md)                        │   │
   │   │  • requireOwner() middleware on /api/rules*                  │   │
   │   │  • rate-limit middleware on /api/agent/* (10 req/min)        │   │
   │   └────────┬───────────────────────┬──────────────────────────┬──┘   │
   │            │                       │                          │      │
   │   ┌────────▼────────┐   ┌──────────▼─────────┐    ┌───────────▼───┐  │
   │   │ LLM parser      │   │ Policy engine      │    │ Vault helper  │  │
   │   │ (z-ai SDK +     │   │ (pure TS, no I/O)  │    │ (simulator +  │  │
   │   │  zod schema)    │   │ 4 rule types       │    │  Move PTB     │  │
   │   │                 │   │ FAIL-CLOSED        │    │  builder)     │  │
   │   └────────┬────────┘   └─────────┬──────────┘    └────────┬──────┘  │
   │            │                      │                        │         │
   │   ┌────────▼──────────────────────▼────────────────────────▼──────┐  │
   │   │  Idempotency check (T5)  →  vault pre-flight  →  policy check  │  │
   │   │  → SUI transfer (only path that signs, server-side only)       │  │
   │   └────────┬────────────────────────────────────────────────┬─────┘  │
   └────────────┼────────────────────────────────────────────────┼────────┘
                │                                              │
       ┌────────▼─────────┐                          ┌──────────▼─────────┐
       │  Neon Postgres   │                          │  Sui Testnet       │
       │  ──────────────  │                          │  ────────────────  │
       │  • Rule          │                          │  • veto::vault     │
       │  • AgentRequest  │  ← audit trail           │    Move module     │
       │  • RuleBookCommit│  ← tamper detection      │  • Vault (shared)  │
       │                  │                          │  • OwnerCap (owned)│
       └──────────────────┘                          │  • SUI coin        │
                                                     └────────────────────┘
                ▲
                │ rate-limit token bucket
       ┌────────┴─────────┐
       │  Upstash Redis   │
       │  ──────────────  │
       │  • IP → count    │
       │  • 60s sliding   │
       │    window        │
       └──────────────────┘
```

The three external dependencies on the right (Neon, Sui, Upstash) are managed
services — Veto owns no infrastructure beyond its own application code.

---

## 2. The Three Layers of Defense

Veto enforces agent actions through three independent, layered checks. Each
layer is sufficient on its own to stop a specific class of attack, but together
they form defense-in-depth.

| # | Layer | What it stops | Where it runs | Demo-able |
|---|------|----------------|---------------|-----------|
| 1 | **Two-step confirmation** | LLM hallucinations, prompt-injected instructions, mis-parsed amounts | Backend + UI | "send ten SUI to alice" returns a confirmation dialog with the parsed intent before any chain call |
| 2 | **Off-chain policy engine** | Unauthorized recipients, per-transaction cap violations, daily-spend-cap violations, known-bad addresses | Backend (`runPolicyEngine`) | Sending 100 SUI > 5 SUI cap → BLOCKED with `failedRule: "Per-transaction cap"`, no chain call |
| 3 | **On-chain vault (Sui Move)** | Server compromise, off-chain bypass, cap tampering, race conditions, replay attacks | Sui Testnet (`veto::vault`) | The agent can call `spend()` but can never call `configure()` or `commit_rules()` — those require `OwnerCap` |

**Key property:** If the off-chain engine is fully compromised (server
breach, key theft, DB tampering), the on-chain vault still enforces the
hard caps the owner set last. The agent can spend *within* the caps but
cannot change the caps. This is the Sui-specific clincher — see §4.

---

## 3. The Owner / Agent Trust Boundary

Veto separates two roles with different privileges:

- **Owner** — the human or DAO that defines and updates the rule book. Has the
  password (server-side env var `OWNER_PASSWORD`) and ultimately holds the
  `OwnerCap` object on Sui.
- **Agent** — the autonomous process that proposes actions ("send 5 SUI to
  alice"). Can only call `vault::spend()` and only within the caps the owner
  set. Cannot change the caps, cannot edit rules, cannot commit a new rule
  hash.

The boundary is enforced at **two layers**:

```
        Owner privileges (configure, commit_rules)         Agent privileges (spend)
        ────────────────────────────────────────           ──────────────────────────
APP     /api/rules (POST/PATCH/DELETE)                     /api/agent/message, /api/agent/confirm
LAYER   requires: signed owner-session cookie              open (rate-limited)
        (or x-owner-token header for API clients)

CHAIN   vault::configure(_cap: &OwnerCap, ...)             vault::spend(vault: &mut Vault, ...)
LAYER   vault::commit_rules(_cap: &OwnerCap, ...)          (no OwnerCap arg)
        ↑ rejected at protocol level if you                ↑ anyone with a coin can call,
          don't own the OwnerCap object                     bounded by per_tx_cap + daily_cap
```

If an attacker steals the agent's server-side keypair, they can call `spend()`
within the caps but cannot raise the caps. If an attacker steals the owner
password, they can edit the off-chain rule book, but every edit triggers a new
`RuleBookCommit` row visible in the audit log and — in production — emits an
on-chain `RulesCommitted` event visible to the whole network.

---

## 4. The OwnerCap Capability Pattern — Why Sui

On account-based chains (Ethereum, Solana, EVM L2s), "only the owner can call
this function" lives entirely inside mutable application code — typically a
`require(msg.sender == owner)` or `if (msg.sender != owner) revert` check.
That check can be patched, bypassed by a re-entrancy bug, or subtly broken by
a storage collision. **It is a convention, not a guarantee.**

On Sui, possessing the right **capability object** IS the authorization. The
Sui runtime checks object ownership **before** the Move function body runs.
A transaction that doesn't include the `OwnerCap` object literally cannot call
`vault::commit_rules` or `vault::configure` — the rejection happens at the
protocol level, not the app level.

```move
// move/veto/sources/vault.move
public fun commit_rules(
    _cap: &OwnerCap,        // ← runtime checks you OWN this object
    vault: &mut Vault,
    new_hash: vector<u8>,
) {
    vault.rules_commit_hash = new_hash;
    vault.rules_version = vault.rules_version + 1;
    // ...
}
```

The `_cap` argument is unused inside the function body (note the leading
underscore) — its presence in the signature is what matters. Sui's object
model enforces it at the VM level. This is what we mean by "protocol-level
authorization."

**Why this matters for the Veto pitch:** competitors on EVM/Solana can only
*claim* their admin gate is enforced — Veto can *prove* it by submitting a
transaction without the OwnerCap and showing the Sui runtime reject it before
the function runs. There is no `require` to bypass because there is no
`require` at all — the type system is the access control.

---

## 5. Request Flow — end-to-end

A single user message ("send 5 SUI to alice") travels through eight stages
before anything lands on-chain. Each stage either short-circuits with a clean
error or passes control to the next.

```
USER TYPED: "send 5 SUI to alice"
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. POST /api/agent/message    (rate-limited: 10 req/min per IP)     │
│    • zod-validate body { message: string }                          │
│    • create AgentRequest row with status=PENDING                    │
└─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. LLM parse (z-ai-web-dev-sdk, strict zod schema)                  │
│    • System prompt: "Output ONLY valid JSON matching one of…"       │
│    • Strip markdown fences, extract {…}, JSON.parse                 │
│    • Validate against IntentSchema (zod) — reject on any drift      │
│    • Result: { action: "transfer", amountSui: 5, recipient: "alice" } │
└─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Alias resolution  (src/lib/aliases.ts)                           │
│    "alice" → 0x0000…0000bad (named-address book)                    │
│    If unresolvable → FAILED with reason                              │
└─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Stage as AWAITING_CONFIRMATION  → return parsed intent to UI     │
│    UI shows a confirmation dialog with diff:                        │
│       "you said: alice → 0x0000…0bad (alias)"                       │
│       "you said: 5 SUI → 5 SUI ✓"                                   │
└─────────────────────────────────────────────────────────────────────┘
                  │  ← user clicks CONFIRM
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. POST /api/agent/confirm { id, decision: "confirm" }              │
│    • Load staged request (must be AWAITING_CONFIRMATION)            │
└─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. T5 IDEMPOTENCY CHECK                                             │
│    SHA-256(rawMessage + amountSui + recipient)                      │
│    Query DB: any EXECUTED row with same hash in last 60s?           │
│    If yes → BLOCKED with failedRule="idempotency_check"             │
└─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. VAULT PRE-FLIGHT  (mirrors vault::spend() exactly)               │
│    • amount > 0?                                                     │
│    • amount ≤ per_tx_cap (5 SUI default)?                           │
│    • spent_today + amount ≤ daily_cap (20 SUI default)?             │
│    Fail → BLOCKED with failedRule="on_chain_vault:EAmountExceeds…"  │
└─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 8. POLICY ENGINE  (pure TS, runPolicyEngine)                        │
│    Load all enabled rules from DB, sorted by createdAt              │
│    Evaluate each in order:                                           │
│      MAX_AMOUNT_PER_TX  → 5 ≤ 5 ✓                                   │
│      DAILY_SPEND_CAP    → (spentToday + 5) ≤ 20 ✓                   │
│      DENYLIST_ADDRESS   → recipient not in blocklist ✓              │
│      ALLOWED_RECIPIENT  → (if active) recipient in allowlist ✓      │
│    If ANY rule fails → BLOCKED                                      │
│    If ZERO enabled rules → BLOCKED (fail-closed)                    │
│    Else → APPROVED                                                   │
└─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 9. SUI EXECUTION  (src/lib/sui.ts — the only function that signs)   │
│    Build PTB: splitCoins(gas, [5 SUI]) → transferObjects(recipient) │
│    Sign with agent keypair (server-side only, never sent to client) │
│    Submit to Sui Testnet RPC                                        │
│    On success → status=EXECUTED, store txDigest                     │
│    On failure → status=FAILED, store errorMessage                   │
└─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
            Activity feed polls /api/requests every 4s
            and shows the final state with a Sui Explorer link.
```

**Important invariants:**

- The SUI keypair is loaded server-side from `SUI_AGENT_SECRET_KEY` and **never
  leaves the backend process**. The browser never sees it.
- The policy engine is a **pure, synchronous, side-effect-free function**. It
  makes no LLM call, no DB call, no network call. That is what makes the audit
  trail reproducible.
- Every state transition is persisted to Postgres before the response is sent,
  so a crash mid-request leaves a recoverable audit trail.

---

## 6. Data Model Overview

Three tables in Neon Postgres. Schema lives at `prisma/schema.postgres.prisma`.

### `Rule` — the off-chain rule book

| Column     | Type      | Notes                                                            |
|------------|-----------|------------------------------------------------------------------|
| `id`       | `String`  | cuid, primary key                                                |
| `name`     | `String`  | Human label, shown in UI + audit log                            |
| `type`     | `String`  | One of `MAX_AMOUNT_PER_TX`, `DAILY_SPEND_CAP`, `ALLOWED_RECIPIENT`, `DENYLIST_ADDRESS` |
| `config`   | `Json`    | Rule-type-specific config (see below)                            |
| `enabled`  | `Boolean` | Soft toggle. Disabled rules are skipped by the policy engine.    |
| `createdAt`| `DateTime`| Insertion time — used for deterministic evaluation order         |
| `updatedAt`| `DateTime`| Auto-updated on PATCH                                            |

**Config shapes:**

```jsonc
// MAX_AMOUNT_PER_TX
{ "maxAmountSui": 5 }

// DAILY_SPEND_CAP
{ "capSui": 20 }

// ALLOWED_RECIPIENT
{ "addresses": ["0x…", "0x…"] }

// DENYLIST_ADDRESS
{ "addresses": ["0x0000…0bad"] }
```

Indexed on `[enabled]` for fast policy loads.

### `AgentRequest` — the audit trail

Every attempt — successful, blocked, failed, or pending — gets a row. The
table is append-only (PATCH is only used to advance `status`).

| Column         | Type       | Notes                                                              |
|----------------|------------|--------------------------------------------------------------------|
| `id`           | `String`   | cuid, primary key                                                  |
| `rawMessage`   | `String`   | Exactly what the user typed                                        |
| `parsedIntent` | `Json?`    | LLM-extracted intent (null if unparseable)                         |
| `amountSui`    | `Float?`   | Parsed amount, denormalized for idempotency queries                |
| `recipient`    | `String?`  | Resolved 0x address, denormalized for idempotency queries          |
| `status`       | `String`   | `PENDING` → `AWAITING_CONFIRMATION` → (`EXECUTED` \| `BLOCKED` \| `FAILED`) |
| `failedRule`   | `String?`  | Which rule (or `on_chain_vault:…`, `idempotency_check`, `fail_closed_no_rules`, `user_rejected`) blocked it |
| `failReason`   | `String?`  | Human-readable explanation                                          |
| `txDigest`     | `String?`  | Sui transaction digest (only set on EXECUTED or chain-attempted FAILED) |
| `confirmedAt`  | `DateTime?`| Set when the user confirmed/rejected (used by T5 idempotency window)|
| `createdAt`    | `DateTime` | Insertion time                                                     |

**Indexes:** `[status]`, `[createdAt]`, `[recipient]`, and a composite
`[status, amountSui, recipient, rawMessage, confirmedAt]` for the T5 idempotency
lookup (the most performance-critical query in the system).

### `RuleBookCommit` — tamper-evidence for the rule book

Every successful edit to the `Rule` table (POST/PATCH/DELETE on `/api/rules`)
writes a new row here. The latest row's `commitHash` is what the UI polls every
15s and compares against a recomputed hash of the current `Rule` table — any
mismatch fires the red "RULE BOOK TAMPERING DETECTED" banner.

| Column       | Type       | Notes                                                              |
|--------------|------------|--------------------------------------------------------------------|
| `id`         | `String`   | cuid, primary key                                                  |
| `commitHash` | `String`   | `0x`-prefixed hex SHA-256 of the canonical JSON of all enabled rules |
| `version`    | `Int`      | Monotonically increasing — bumps on every commit                   |
| `txDigest`   | `String?`  | `null` in simulator mode; real Sui tx digest once Move is deployed |
| `createdAt`  | `DateTime` | Insertion time                                                     |

**Canonical hash recipe** (`computeRulesHash` in `src/lib/vault.ts`):

1. Load all rules, sort by `createdAt` ascending.
2. Filter to enabled rules only.
3. Map each to `{ name, type, config }` — drop `id`, `enabled`, timestamps.
4. `JSON.stringify` the resulting array.
5. Return `"0x" + sha256(json).toString("hex")`.

The same recipe runs on-chain (inside `vault::commit_rules`) so the off-chain
hash and the on-chain hash are byte-identical.

---

## 7. Technology Stack

| Concern              | Technology                          | Version    | Why this choice                                                       |
|----------------------|-------------------------------------|------------|-----------------------------------------------------------------------|
| **Frontend**         | Next.js                             | 16.x       | Server components + static export; one-click Vercel deploy            |
| **UI library**       | React + Tailwind + shadcn/ui        | 19 / 4 / latest | Fast, consistent, accessible; matches judge expectations           |
| **Backend framework**| Hono                                | 4.x        | Edge-compatible, lightweight, fast middleware composition            |
| **Runtime**          | Node.js (via Bun for dev)           | 20.x / 1.3.x | LTS runtime; Bun for fast local iteration                            |
| **Language**         | TypeScript                          | 5.x        | End-to-end type safety, zod validation shared between layers         |
| **Database**         | Postgres on Neon                    | n/a        | Serverless, autoscaling, branchable; free tier covers demo load       |
| **ORM**              | Prisma                              | 6.x        | Type-safe schema, migrations, JSON columns for rule configs          |
| **Cache / rate-limit**| Upstash Redis                     | n/a        | Serverless Redis with REST API — works from serverless without TCP   |
| **Smart contracts**  | Sui Move                            | framework/testnet | Object-centric model required for OwnerCap pattern               |
| **Sui SDK**          | `@mysten/sui`                       | 2.19+      | Official TypeScript SDK; PTB builder, JSON-RPC client                |
| **LLM provider**     | `z-ai-web-dev-sdk`                  | 0.0.18+    | In-environment LLM with structured-output prompts                    |
| **Input validation** | Zod                                 | 4.x        | Schemas shared between LLM parse, API body, and rule config          |
| **Testing**          | Vitest                              | 4.x        | Native TS, fast, integrates with Bun                                  |
| **Hosting — FE**     | Vercel                              | n/a        | Zero-config Next.js deploys, global edge CDN                          |
| **Hosting — BE**     | Render                              | n/a        | Persistent web service with health checks; free tier available        |
| **Hosting — DB**     | Neon                                | n/a        | Serverless Postgres with autoscaling                                  |
| **Hosting — Redis**  | Upstash                             | n/a        | Per-request billing, REST + native Redis                              |

---

## 8. Folder Structure (target)

The repository is being restructured into three top-level folders. Each maps
to one deployment target.

```
veto/
├── frontend/                  # Next.js — deploys to Vercel
│   ├── src/app/               # App-router pages (Dashboard, RuleBook, Architecture)
│   ├── src/components/        # shadcn/ui + Veto-specific components
│   ├── src/lib/api-client.ts  # Typed fetch wrappers for backend
│   ├── package.json
│   └── next.config.ts
│
├── backend/                   # Hono API server — deploys to Render
│   ├── src/routes/            # 13 API endpoints (mirrors current /api/* paths)
│   ├── src/lib/               # policy-engine, vault, auth, sui, llm, aliases, db
│   ├── src/middleware/        # requireOwner, rate-limit
│   ├── prisma/                # schema.prisma + migrations
│   ├── package.json
│   └── tsconfig.json
│
├── contracts/                 # Sui Move — deploys to Sui Testnet
│   ├── sources/vault.move     # veto::vault module with OwnerCap
│   ├── Move.toml
│   └── README.md
│
└── deployment/                # This documentation
    └── veto/docs/
        ├── Architecture.md    # ← you are here
        ├── Deployment.md
        ├── API.md
        ├── Security.md
        └── README.md
```

The current monorepo (Next.js API routes in the same package as the frontend)
is being split along the natural `/api/*` boundary: each route handler becomes
a Hono route, the `src/lib/*` modules move unchanged into `backend/src/lib/`,
and the `move/` folder is renamed to `contracts/`.

---

## 9. Why this architecture, in one paragraph

The frontend is dumb on purpose — it only renders state and forwards typed
fetches. The backend owns all authorization (cookie + token check), all
parsing (LLM + zod), all policy (pure engine), all signing (server-side
keypair only), and all DB writes (audit trail + tamper-evidence hashes). The
chain owns the hard caps, the rule-book hash, and the spend counter — things
that **must** survive a backend compromise. The database owns the audit
trail, the rule book, and the request log — things that must survive a chain
reorg. Redis owns only the rate-limit token bucket — ephemeral state that
must survive a process restart. Each piece is replaceable without touching
the others, and each piece's failure mode is bounded.
