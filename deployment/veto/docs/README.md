# Veto

> A deterministic, verifiable policy gate for AI agents on Sui.

Veto sits between an autonomous AI agent and its Sui wallet. Every proposed
action passes through three independent checks before it touches the chain:
(1) a two-step confirmation flow that surfaces LLM hallucinations to the
owner, (2) an off-chain policy engine enforcing per-transaction caps, daily
spend caps, allowlists, and denylists, and (3) an on-chain Sui Move vault
with hard caps enforced by Sui consensus and an `OwnerCap` capability pattern
that makes "only the owner can change the caps" a protocol-level guarantee
rather than an app-level convention. The agent can spend within the owner's
last-committed limits; it can never raise those limits.

---

## Documentation Index

| Document | What it covers |
|----------|----------------|
| **[Architecture.md](./Architecture.md)** | System diagram, three layers of defense, Owner/Agent trust boundary, OwnerCap pattern, request flow, data model, technology stack |
| **[Deployment.md](./Deployment.md)** | Local setup, build, env vars, smart contract deploy, Neon migration, Render, Vercel, production checklist, troubleshooting |
| **[API.md](./API.md)** | All 13 HTTP endpoints with schemas, curl examples, error responses, two-step confirmation flow, rate limiting |
| **[Security.md](./Security.md)** | Threat model (T1–T6), three layers, cookie security, CORS, idempotency, tamper detection, fail-closed, production hardening checklist |
| **[README.md](./README.md)** | ← you are here. Overview, doc index, quick start, structure, deployment targets, external links |

Read them in order: **Architecture** (what), **Security** (why), **API**
(how the frontend talks to the backend), **Deployment** (how to run it),
**README** (this file — where to go next).

---

## Quick Start (3 commands)

```bash
git clone https://github.com/<your-org>/veto.git && cd veto
./scripts/setup.sh        # installs deps, switches to Postgres schema, pushes DB
./scripts/dev.sh          # starts backend (3001) + frontend (3000) in parallel
```

Then open <http://localhost:3000>, click **LOGIN** in the top right, enter
the `OWNER_PASSWORD` from your `backend/.env`, and try:

```
send 5 SUI to alice
```

You'll get a confirmation dialog showing the parsed intent (with the alias
resolved to a real address). Click **CONFIRM**. The activity feed will
update within 4 seconds with the final status (`EXECUTED` with a Suivision
link, or `BLOCKED` with the rule that fired).

> If `scripts/setup.sh` doesn't exist yet (pre-restructuring), the manual
> version is in [Deployment.md §1](./Deployment.md#1-local-setup) — about
> 10 commands total.

---

## Project Structure

```
veto/
├── frontend/                          # Next.js 16 + React 19 + Tailwind + shadcn/ui
│   ├── src/app/                       # App-router pages
│   │   ├── page.tsx                   # Single-page dashboard (3 tabs)
│   │   ├── layout.tsx                 # Root layout with toaster
│   │   └── globals.css                # Tailwind + theme tokens
│   ├── src/components/ui/             # shadcn/ui primitives (button, card, dialog, …)
│   ├── src/lib/api-client.ts          # Typed fetch wrappers for the backend
│   ├── package.json
│   ├── next.config.ts
│   └── tsconfig.json
│
├── backend/                           # Hono API server on Node.js
│   ├── src/routes/                    # 13 API endpoints
│   │   ├── agent/message.ts           # POST /api/agent/message  (step 1 of 2)
│   │   ├── agent/confirm.ts           # POST /api/agent/confirm  (step 2 of 2)
│   │   ├── requests.ts                # GET  /api/requests
│   │   ├── rules/index.ts             # GET, POST /api/rules
│   │   ├── rules/[id].ts              # PATCH, DELETE /api/rules/:id
│   │   ├── wallet.ts                  # GET  /api/wallet
│   │   ├── aliases.ts                 # GET  /api/aliases
│   │   ├── seed.ts                    # POST /api/seed
│   │   └── owner/{login,logout,status}.ts
│   ├── src/lib/                       # Business logic (no I/O in policy-engine)
│   │   ├── policy-engine.ts           # Pure TS rule evaluator (FAIL-CLOSED)
│   │   ├── vault.ts                   # Off-chain simulator + Move PTB builder
│   │   ├── auth.ts                    # Owner cookie + token + requireOwner()
│   │   ├── sui.ts                     # Sui client + keypair + executeTransfer()
│   │   ├── llm.ts                     # z-ai SDK + zod-validated intent parser
│   │   ├── aliases.ts                 # Named-address book (self, alice, treasury)
│   │   ├── db.ts                      # Prisma client singleton
│   │   └── types.ts                   # Shared TS types
│   ├── src/middleware/
│   │   ├── rate-limit.ts              # Upstash Redis sliding-window (10/min)
│   │   └── cors.ts                    # Hono cors() with credentials
│   ├── prisma/
│   │   ├── schema.prisma              # Active schema (Postgres in production)
│   │   ├── schema.postgres.prisma     # Production template
│   │   └── schema.sqlite.prisma       # Local-dev-only template
│   ├── tests/
│   │   ├── policy-engine.test.ts      # 19 unit tests for the rule evaluator
│   │   ├── api-test.sh                # 10 end-to-end smoke tests
│   │   └── manual-test-checklist.md   # Human-driven test plan
│   ├── scripts/
│   │   ├── switch-db.sh               # Swap between Postgres/SQLite schemas
│   │   └── pre-deploy-check.sh        # Fails if SQLite or missing env vars
│   ├── package.json
│   └── tsconfig.json
│
├── contracts/                         # Sui Move smart contracts
│   ├── sources/vault.move             # veto::vault module (OwnerCap + Vault)
│   ├── Move.toml                      # Package manifest (depends on Sui framework)
│   └── README.md
│
└── deployment/                        # This documentation
    └── veto/docs/
        ├── Architecture.md
        ├── Deployment.md
        ├── API.md
        ├── Security.md
        └── README.md                  # ← you are here
```

**Three folders, three deployment targets, three independent lifecycles.**
The frontend can be redeployed without touching the backend. The backend can
be redeployed without touching the chain. The Move module, once published, is
immutable — upgrades require publishing a new package and migrating the
OwnerCap.

---

## Deployment Targets

| Component        | Host       | Free tier? | URL pattern                       | Notes |
|------------------|------------|------------|-----------------------------------|-------|
| **Frontend**     | Vercel     | ✅ Hobby   | `https://veto.vercel.app`         | Auto-deploy on push to `main`. `NEXT_PUBLIC_API_URL` is baked at build time. |
| **Backend**      | Render     | ✅ Free    | `https://veto-api.onrender.com`   | Spins down after 15 min idle on free tier; upgrade to Starter for $7/mo to avoid. |
| **Database**     | Neon       | ✅ Free    | `*.neon.tech`                     | Serverless Postgres with autoscaling. Use the pooled connection string. |
| **Rate-limit**   | Upstash    | ✅ Free    | `*.upstash.io`                    | 10,000 commands/day on free tier. REST API works from serverless. |
| **Smart contract**| Sui Testnet | n/a       | `0x…` (object IDs)               | Deployed via `sui client publish`. Testnet SUI is free from the faucet. |

**Total monthly cost for the hackathon demo:** $0 (all free tiers).
**Total monthly cost for a low-traffic production deployment:** ~$10–20
(upgrade Render to Starter to avoid cold starts; everything else stays free).

---

## External Resources

### Sui

- **Sui documentation** — <https://docs.sui.io>
- **Sui Move book** — <https://move-language.github.io/move/>
- **Sui SDK (TypeScript)** — <https://sdk.mystenlabs.com/typescript>
- **Sui Testnet explorer (Suivision)** — <https://testnet.suivision.xyz>
- **Sui Testnet faucet** — <https://docs.sui.io/guides/developer/getting-started/get-coins>
- **Sui Discord (testnet-faucet channel)** — <https://discord.gg/sui>
- **Sui CLI install** — <https://docs.sui.io/guides/developer/getting-started/sui-install>
- **OwnerCap pattern docs** — <https://docs.sui.io/concepts/object-ownership>
- **Sui Overflow 2026 hackathon** — <https://overflow.sui.io>

### Neon (Postgres)

- **Homepage** — <https://neon.tech>
- **Docs** — <https://neon.tech/docs>
- **Pooled vs direct connection strings** — <https://neon.tech/docs/connect/connection-pooling>
- **Free tier limits** — 0.5 GB storage, 100 compute hours/month (sufficient for the demo)

### Render

- **Homepage** — <https://render.com>
- **Docs** — <https://render.com/docs>
- **Web Service deploy guide** — <https://render.com/docs/web-services>
- **Environment variables** — <https://render.com/docs/environment-variables>
- **Health checks** — <https://render.com/docs/zero-downtime-deploys#health-check-protocol>

### Vercel

- **Homepage** — <https://vercel.com>
- **Next.js deploy guide** — <https://vercel.com/docs/frameworks/nextjs>
- **Environment variables** — <https://vercel.com/docs/projects/environment-variables>
- **`NEXT_PUBLIC_*` caveat** — vars are inlined at build time; redeploy after edits

### Upstash (Redis)

- **Homepage** — <https://upstash.com>
- **Docs** — <https://docs.upstash.com/redis>
- **REST API (for serverless)** — <https://docs.upstash.com/redis/features/restapi>
- **Free tier limits** — 10,000 commands/day, 256 MB max storage

### Prisma

- **Homepage** — <https://www.prisma.io>
- **Docs** — <https://www.prisma.io/docs>
- **`db push` vs `migrate dev`** — <https://www.prisma.io/docs/concepts/components/prisma-migrate/db-push>
- **Postgres JSON columns** — <https://www.prisma.io/docs/concepts/components/prisma-schema/data-model#json>

### Hono

- **Homepage** — <https://hono.dev>
- **Docs** — <https://hono.dev/docs>
- **Deploy to Render** — <https://hono.dev/docs/getting-started/nodejs>

### z-ai-web-dev-sdk (LLM)

- **NPM** — <https://www.npmjs.com/package/z-ai-web-dev-sdk>
- Used inside `backend/src/lib/llm.ts` for the intent parser. Returns
  structured JSON validated by zod before any downstream use.

---

## License & Contributing

Veto is open-source under the MIT license. See `LICENSE` in the repo root.

Contributing: fork, branch, open a PR. All PRs must pass `bun run lint`,
`bun test`, and `bash backend/tests/api-test.sh` before merge. The
`scripts/pre-deploy-check.sh` script is the canonical "is this deployable?"
gate — run it locally before pushing.

---

## One-paragraph pitch

Veto is the policy layer AI agents need before they're allowed to touch
real money. Today, every agent framework either (a) lets the agent sign
freely and hopes for the best, or (b) requires a human to approve every
single transaction, which defeats the point of autonomy. Veto is the
middle path: the agent acts autonomously *within* hard limits the owner
defined, those limits are enforced on-chain by a Sui Move vault so a server
compromise can't bypass them, and every action is logged with a tamper-evident
rule-book hash that the owner can verify anytime. The OwnerCap pattern is
the Sui-specific clincher — "only the owner can change the caps" is a
protocol-level guarantee, not a `require` statement that can be patched.
