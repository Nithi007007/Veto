# Veto — Deployment Guide

This document covers every step from a fresh `git clone` to a production
deployment across **Vercel** (frontend), **Render** (backend), **Sui Testnet**
(smart contracts), **Neon** (Postgres), and **Upstash** (Redis). It is
organized as a strict runbook: do the sections in order. Each section is
self-contained so a teammate can pick up where you left off.

> **Restructuring note:** the repo is being split into `frontend/`,
> `backend/`, and `contracts/` folders (see Architecture.md §8). The commands
> below assume that structure. If you're working against the legacy monorepo,
> `cd frontend/` and `cd backend/` become `cd .` and the env vars are shared.

---

## Table of Contents

1. [Local Setup](#1-local-setup)
2. [Build Instructions](#2-build-instructions)
3. [Environment Variables](#3-environment-variables)
4. [Smart Contract Deployment](#4-smart-contract-deployment)
5. [Database Migration](#5-database-migration)
6. [Render Deployment (backend)](#6-render-deployment-backend)
7. [Vercel Deployment (frontend)](#7-vercel-deployment-frontend)
8. [Production Checklist](#8-production-checklist)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Local Setup

### 1.1 Prerequisites

| Tool      | Version    | Why                                                    | Verify                 |
|-----------|------------|--------------------------------------------------------|------------------------|
| Node.js   | ≥ 20.0.0   | Runtime for both frontend and backend                  | `node --version`       |
| Bun       | ≥ 1.3.0    | Faster dev iteration; also runs tests                  | `bun --version`        |
| Sui CLI   | ≥ 1.30.0   | Builds and publishes the Move module                   | `sui --version`        |
| Git       | ≥ 2.40     | Clone, branch, push                                    | `git --version`        |
| curl + jq | latest     | Run the smoke-test scripts in `tests/api-test.sh`      | `curl --version`       |
| A Sui Testnet wallet | n/a | You'll need ~5 SUI of testnet gas | See Sui docs for faucet |

You do **not** need Docker. All dependencies are managed services.

### 1.2 Clone

```bash
git clone https://github.com/<your-org>/veto.git
cd veto
```

After the restructuring lands you'll see three top-level folders:

```bash
ls -1
# backend/
# contracts/
# frontend/
```

### 1.3 Install dependencies

```bash
# Backend
cd backend
bun install
cd ..

# Frontend
cd frontend
bun install
cd ..
```

### 1.4 Generate a Sui keypair (for the agent wallet)

If you don't already have a testnet keypair:

```bash
sui client new-address ed25519
# Save the Secret Key from the output — it's the SUI_AGENT_SECRET_KEY env var.
# The address is what you'll fund from the faucet.
```

Fund it from <https://docs.sui.io/guides/developer/getting-started/get-coins>
(or run `sui client faucet`). Verify:

```bash
sui client gas
```

### 1.5 Create a Neon Postgres database

1. Sign in at <https://neon.tech>.
2. Create a new project named `veto`.
3. Copy the **pooled** connection string (it starts with
   `postgresql://` and includes `-pooler` in the hostname).
4. Save it — it's the `DATABASE_URL` env var.

### 1.6 Create an Upstash Redis database

1. Sign in at <https://upstash.com>.
2. Create a Redis database named `veto-ratelimit` in the same region as your
   Neon DB (lower latency for the rate-limit token bucket).
3. Copy the **REST URL** and **REST token** — these are `UPSTASH_REDIS_REST_URL`
   and `UPSTASH_REDIS_REST_TOKEN`.

### 1.7 Set up environment variables

Create `backend/.env` (never commit this):

```bash
# backend/.env
DATABASE_URL="postgresql://user:pass@host-pooler.region.aws.neon.tech/veto?sslmode=require"
SUI_NETWORK="testnet"
SUI_AGENT_SECRET_KEY="suiprivkey1q..."        # from step 1.4
OWNER_PASSWORD="change-me-to-a-long-random-string"
OWNER_TOKEN="change-me-too"                    # for curl/CI clients
OWNER_COOKIE_SECRET="another-long-random-string"
UPSTASH_REDIS_REST_URL="https://veto-ratelimit-xxxx.upstash.io"
UPSTASH_REDIS_REST_TOKEN="AX...long-token..."
PORT=3001
CORS_ORIGIN="http://localhost:3000"            # frontend dev origin
# Only needed after §4 (smart contract deploy):
# VAULT_PACKAGE_ID="0x..."
# VAULT_OBJECT_ID="0x..."
# OWNER_CAP_ID="0x..."
```

Create `frontend/.env.local`:

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

### 1.8 Push the database schema

```bash
cd backend
bun run db:push        # creates all tables on Neon
bun run db:generate    # regenerates the Prisma client
cd ..
```

### 1.9 Seed default rules

With the backend running (next step), or via a one-shot:

```bash
curl -X POST http://localhost:3001/api/seed
# → {"ok":true,"message":"Seeded 3 default rules + initial vault commit (v1)"}
```

This creates three rules (5 SUI per-tx cap, 20 SUI daily cap, denylist) and
the initial `RuleBookCommit` row.

### 1.10 Run

Two terminals:

```bash
# Terminal 1 — backend
cd backend
bun run dev
# → Hono server listening on http://localhost:3001

# Terminal 2 — frontend
cd frontend
bun run dev
# → Next.js listening on http://localhost:3000
```

Open <http://localhost:3000>. You should see the Veto dashboard with the
agent's wallet card, the (simulated) vault card, the chat input, and an empty
activity feed. Try "send 5 SUI to alice" — you should get a confirmation
dialog and then an EXECUTED row in the activity feed (assuming the agent
wallet has funds).

---

## 2. Build Instructions

### 2.1 Frontend build

```bash
cd frontend
bun run build
# Output: .next/standalone/ (self-contained server) + .next/static/
```

The `next.config.ts` enables `output: "standalone"` so the build produces a
self-contained Node server. Vercel runs this automatically; for self-hosting
you'd `bun .next/standalone/server.js`.

### 2.2 Backend build

```bash
cd backend
bun run build
# Output: dist/ (compiled JS) — entry: dist/index.js
```

Render runs `bun run build` then `bun run start` (which is `node dist/index.js`).

### 2.3 Smart contract build

```bash
cd contracts
sui move build --path .
# Output: build/ folder with the compiled bytecode
```

A successful build prints `Including dependency Sui` and `Building veto` with
no errors. If you see a `VMCompilerError` you have a Move syntax issue — start
by re-reading `move::veto::vault` source.

### 2.4 Verify everything builds cleanly

```bash
# From repo root
cd backend && bun run lint && cd ..
cd frontend && bun run lint && cd ..
cd contracts && sui move build --path . && cd ..
bun test --cwd backend         # 19 unit tests for policy engine
bash backend/tests/api-test.sh # 10 API smoke tests against localhost
```

All four must pass before you deploy anything.

---

## 3. Environment Variables

### 3.1 Backend (Render)

| Variable                  | Required | Example                                                        | Purpose |
|---------------------------|----------|----------------------------------------------------------------|---------|
| `DATABASE_URL`            | ✅       | `postgresql://user:pass@host-pooler.region.aws.neon.tech/veto?sslmode=require` | Neon pooled Postgres connection string |
| `SUI_NETWORK`             | ✅       | `testnet`                                                      | Which Sui network to target |
| `SUI_AGENT_SECRET_KEY`    | ✅       | `suiprivkey1q...`                                              | Agent's Ed25519 keypair — **server-side only, never sent to client** |
| `OWNER_PASSWORD`          | ✅       | `a-long-random-string-min-32-chars`                            | Owner login password (compared constant-time) |
| `OWNER_TOKEN`             | optional | `another-long-random-string`                                   | Alternative auth for curl/CI; accepted via `x-owner-token` header |
| `OWNER_COOKIE_SECRET`     | ✅       | `yet-another-long-random-string`                               | HMAC key for signing the owner-session cookie |
| `UPSTASH_REDIS_REST_URL`  | ✅       | `https://veto-ratelimit-xxxx.upstash.io`                       | Rate-limit token bucket |
| `UPSTASH_REDIS_REST_TOKEN`| ✅       | `AX...long-token...`                                           | Auth for Upstash REST API |
| `PORT`                    | ✅       | `3001`                                                         | Hono listen port (Render injects this automatically; set explicitly for local) |
| `CORS_ORIGIN`             | ✅       | `https://veto.vercel.app`                                       | Frontend origin — used by `cors()` middleware |
| `VAULT_PACKAGE_ID`        | after §4 | `0x...`                                                        | Published Move package ID |
| `VAULT_OBJECT_ID`         | after §4 | `0x...`                                                        | Shared `Vault` object ID |
| `OWNER_CAP_ID`            | after §4 | `0x...`                                                        | The `OwnerCap` object ID (held by agent's address) |
| `NODE_ENV`                | ✅       | `production`                                                   | Enables production optimizations |

### 3.2 Frontend (Vercel)

| Variable                | Required | Example                          | Purpose |
|-------------------------|----------|----------------------------------|---------|
| `NEXT_PUBLIC_API_URL`   | ✅       | `https://veto.onrender.com`      | Backend base URL; baked into client bundle at build time |
| `NEXT_PUBLIC_SUI_NETWORK` | optional | `testnet`                      | Used by Sui Explorer link builder in the UI |

That's it for the frontend — it holds no secrets. Everything auth-related
lives in the backend.

> **Important:** `NEXT_PUBLIC_*` vars are inlined into the static bundle at
> build time. If you change the backend URL, you must re-deploy the frontend
> for the change to take effect.

---

## 4. Smart Contract Deployment

### 4.1 Configure the Sui CLI for testnet

```bash
sui client active-env      # should print "testnet"
# If not:
sui client switch --env testnet
```

### 4.2 Fund the deployer address

```bash
sui client gas
# If empty:
sui client faucet
```

You need ~5 SUI to cover publish gas. The publish transaction typically costs
0.05–0.5 SUI depending on package size.

### 4.3 Build

```bash
cd contracts
sui move build --path .
```

A clean build prints:

```
INCLUDING DEPENDENCY Sui
INCLUDING DEPENDENCY MoveStdlib
BUILDING veto
```

### 4.4 Publish

```bash
sui client publish --gas-budget 100000000 .
```

The output includes a `Transaction Digest` and a JSON block listing the
created objects. Look for **three** created object IDs:

```
Created Objects:
  ID: 0x<package_id>                              ← this is VAULT_PACKAGE_ID
  ...
  ID: 0x<owner_cap_id>  OwnerCap                  ← this is OWNER_CAP_ID
  ID: 0x<vault_object_id>  Vault                  ← this is VAULT_OBJECT_ID
```

Save all three. The `OwnerCap` will have been transferred to your active
address — confirm with:

```bash
sui client objects --address <your-address>
```

### 4.5 Make the Vault a shared object

The `vault::create` function returns a `Vault` that the publish transaction
shared via `share_object` — so this step is already done. Verify by checking
the object's owner:

```bash
sui client object <vault_object_id> --show-content
# "owner": { "Shared": { ... } }
```

If it's not shared, run a follow-up transaction calling `vault::share_vault`.

### 4.6 Set the env vars on Render

In Render → your backend service → Environment → add:

```
VAULT_PACKAGE_ID   = 0x...
VAULT_OBJECT_ID    = 0x...
OWNER_CAP_ID       = 0x...
```

Then trigger a redeploy. The backend's `vault.ts` will now build real Move
PTBs (instead of the off-chain simulator) for `commit_rules` calls.

### 4.7 Verify on-chain

```bash
# The latest commit's hash should match what's on-chain
curl https://veto.onrender.com/api/rules | jq '.commit.commitHash'
# → "0xabcdef..."

# And on-chain:
sui client object <vault_object_id> --show-content | jq '.data.content.fields.rules_commit_hash'
# → "0xabcdef..."   ← should match
```

If they differ, the backend is in simulator mode — check that all three
`VAULT_*` env vars are set.

---

## 5. Database Migration

Veto uses Prisma's `db push` workflow (not `migrate dev`) for the hackathon
demo — the schema is small enough that push is faster and there are no
production data migrations to worry about.

### 5.1 First-time setup

```bash
cd backend
bun run db:push
```

This connects to Neon, creates the three tables (`Rule`, `AgentRequest`,
`RuleBookCommit`) with all indexes, and regenerates `node_modules/.prisma/client`.

### 5.2 After a schema change

Edit `prisma/schema.prisma`, then:

```bash
bun run db:push
```

`db push` will detect drift and prompt before dropping columns.

### 5.3 Switching between SQLite (local) and Postgres (deploy)

The repo ships with two schema templates:

```bash
# Production (Vercel-safe):
bash scripts/switch-db.sh postgres

# Local dev only (DO NOT DEPLOY — Vercel's filesystem is ephemeral):
bash scripts/switch-db.sh sqlite
```

Always run `bash scripts/pre-deploy-check.sh` before a deploy — it fails
loudly if the active schema is SQLite or if `DATABASE_URL` doesn't start with
`postgresql://`.

### 5.4 Resetting the database (WARNING — destroys all data)

```bash
cd backend
# Drop and recreate every table:
bun x prisma db push --force-reset
# Re-seed:
curl -X POST http://localhost:3001/api/seed
```

### 5.5 Inspecting the database

```bash
# Neon's web console: SQL editor with autocompletion
# Or via psql:
psql "<DATABASE_URL>" -c "SELECT version, commit_hash FROM \"RuleBookCommit\" ORDER BY version DESC LIMIT 5;"
```

---

## 6. Render Deployment (backend)

### 6.1 Create the web service

1. Sign in at <https://render.com>.
2. **New → Web Service** → connect your GitHub repo.
3. Settings:
   - **Name:** `veto-api`
   - **Region:** same as Neon + Upstash (lowest latency)
   - **Branch:** `main`
   - **Root Directory:** `backend/`
   - **Runtime:** Node
   - **Build Command:** `bun install && bun run build`
   - **Start Command:** `bun run start`
   - **Instance Type:** Free (sufficient for demo; upgrade to Starter for
     no-spin-down cold starts)

### 6.2 Set environment variables

Render → your service → Environment → add every variable from §3.1. The
critical ones:

```
DATABASE_URL              = postgresql://...neon.tech/veto?sslmode=require
SUI_NETWORK               = testnet
SUI_AGENT_SECRET_KEY      = suiprivkey1q...
OWNER_PASSWORD            = <long-random-string>
OWNER_COOKIE_SECRET       = <long-random-string>
UPSTASH_REDIS_REST_URL    = https://...
UPSTASH_REDIS_REST_TOKEN  = AX...
PORT                      = 3001              # Render injects $PORT but explicit is safer
CORS_ORIGIN               = https://veto.vercel.app
NODE_ENV                  = production
```

Save → Render auto-deploys on every push to `main`.

### 6.3 Health check

Render → your service → Settings → Health Check:

- **Health Check Path:** `/api/owner/status`
- **Health Check Grace Period:** 60s (the first deploy needs time to pull deps)

Render will hit this path every 30s. The endpoint returns `200 {"authenticated": false}`
on a fresh request, which is exactly what we want — it proves the process is
up, the DB connection works, and CORS is configured.

### 6.4 Verify the deploy

```bash
# Replace with your Render URL
export API="https://veto-api.onrender.com"

# Health:
curl -s "$API/api/owner/status" | jq
# → { "authenticated": false }

# Wallet (should return the agent's testnet address + balance):
curl -s "$API/api/wallet" | jq
# → { "address": "0x...", "balanceSui": 4.98, "network": "testnet" }

# Owner login:
curl -s -c /tmp/veto-cookie.txt -X POST "$API/api/owner/login" \
  -H "Content-Type: application/json" \
  -d '{"password":"<your OWNER_PASSWORD>"}'
# → { "ok": true, "message": "Owner session established" }
# The cookie jar now has veto_owner_session=...

# Authenticated route:
curl -s -b /tmp/veto-cookie.txt "$API/api/rules" | jq '.rules | length'
# → 3   (or whatever you seeded)
```

If all four pass, the backend is live. Move on to §7.

---

## 7. Vercel Deployment (frontend)

### 7.1 Import the repo

1. Sign in at <https://vercel.com>.
2. **Add New → Project** → import your GitHub repo.
3. Configure:
   - **Framework Preset:** Next.js
   - **Root Directory:** `frontend/`
   - **Build Command:** `next build` (auto-detected)
   - **Output Directory:** `.next` (auto-detected)
   - **Install Command:** `bun install` (or `npm install`)

### 7.2 Set environment variables

Vercel → your project → Settings → Environment Variables:

| Name                       | Value                                  | Environments |
|----------------------------|----------------------------------------|--------------|
| `NEXT_PUBLIC_API_URL`      | `https://veto-api.onrender.com`        | Production, Preview, Development |
| `NEXT_PUBLIC_SUI_NETWORK`  | `testnet`                              | Production, Preview |

> **Gotcha:** because `NEXT_PUBLIC_*` vars are baked at build time, you must
> redeploy for changes to take effect. Vercel does this automatically when you
> edit env vars via the dashboard.

### 7.3 Build settings

Vercel → Settings → Build & Development Settings:

- **Build Command:** leave default (`next build` or `bun run build`)
- **Output Directory:** leave default (`.next`)
- **Install Command:** `bun install` (Vercel auto-detects Bun from `bun.lock`)

### 7.4 Deploy

Click **Deploy**. The first build takes 1–2 minutes. Vercel assigns a URL
like `veto-<hash>-<org>.vercel.app` — this is your `CORS_ORIGIN` for §6.2.

### 7.5 Custom domain (optional)

Vercel → Settings → Domains → add `veto.yourdomain.com`. Follow the DNS
instructions (CNAME to `cname.vercel-dns.com`). Update `CORS_ORIGIN` on
Render to the new domain and redeploy the backend.

### 7.6 Verify

Open the Vercel URL in your browser:

- The dashboard loads without console errors (check DevTools → Network).
- The wallet card shows the same address as `curl $API/api/wallet` did.
- The activity feed polls `/api/requests` successfully (200 in Network tab).
- Submitting "send 0.5 SUI to alice" returns a confirmation dialog → confirm
  → EXECUTED row appears in the activity feed with a Suivision link.

If CORS fails, you'll see it in the browser console immediately. See §9.1.

---

## 8. Production Checklist

### 8.1 Pre-deploy checks (run before every production push)

```bash
cd backend && bash scripts/pre-deploy-check.sh
```

This script:

- ✅ Fails if `prisma/schema.prisma` is SQLite (`provider = "sqlite"`).
- ✅ Fails if `DATABASE_URL` doesn't start with `postgresql://`.
- ✅ Fails if any of `SUI_AGENT_SECRET_KEY`, `OWNER_PASSWORD`, `SUI_NETWORK`
  is unset.
- ✅ Pings the DB with `SELECT 1;` to confirm reachability.

Manual pre-deploy checks:

- [ ] All env vars from §3.1 are set on Render (no `dev-*` defaults).
- [ ] `OWNER_PASSWORD` and `OWNER_COOKIE_SECRET` are at least 32 random
      characters and **different** from each other.
- [ ] `CORS_ORIGIN` matches the Vercel URL exactly (including protocol).
- [ ] The agent wallet has ≥ 5 SUI of testnet gas (`sui client gas`).
- [ ] `bun run lint` passes in both `frontend/` and `backend/`.
- [ ] `bun test` passes in `backend/` (19 unit tests for the policy engine).
- [ ] `bash backend/tests/api-test.sh` passes 10/10 against a local backend.
- [ ] If you deployed the Move module: `VAULT_PACKAGE_ID`,
      `VAULT_OBJECT_ID`, `OWNER_CAP_ID` are set on Render and the on-chain
      `rules_commit_hash` matches `curl $API/api/rules | jq .commit.commitHash`.

### 8.2 Post-deploy verification

Run these against the live production URLs:

```bash
export API="https://veto-api.onrender.com"
export WEB="https://veto.vercel.app"

# 1. Health
curl -fsS "$API/api/owner/status" | jq

# 2. Wallet endpoint reachable + agent funded
curl -fsS "$API/api/wallet" | jq '.balanceSui' | awk '$1 < 1 { exit 1 }'

# 3. Owner login works + cookie is set
curl -fsS -c /tmp/c.txt -X POST "$API/api/owner/login" \
  -H "Content-Type: application/json" \
  -d '{"password":"'"$OWNER_PASSWORD"'"}'
grep -q veto_owner_session /tmp/c.txt

# 4. Authenticated route works with cookie
curl -fsS -b /tmp/c.txt "$API/api/rules" | jq '.rules | length' | awk '$1 < 1 { exit 1 }'

# 5. Frontend serves HTML
curl -fsS "$WEB" | grep -q '<title>Veto</title>'

# 6. CORS preflight succeeds
curl -fsS -X OPTIONS "$API/api/wallet" \
  -H "Origin: $WEB" \
  -H "Access-Control-Request-Method: GET" \
  -o /dev/null -w "%{http_code}\n"   # → 204

# 7. On-chain rule book hash matches DB (if Move deployed)
if [ -n "$VAULT_OBJECT_ID" ]; then
  DB_HASH=$(curl -fsS -b /tmp/c.txt "$API/api/rules" | jq -r .commit.commitHash)
  CHAIN_HASH=$(sui client object "$VAULT_OBJECT_ID" --show-content \
    | jq -r '.data.content.fields.rules_commit_hash')
  [ "$DB_HASH" = "$CHAIN_HASH" ] && echo "✓ on-chain hash matches" || { echo "✗ hash mismatch"; exit 1; }
fi
```

All seven checks must pass.

### 8.3 Smoke test (end-to-end demo flow)

From the deployed frontend UI, perform these in order — they exercise every
layer of defense:

1. **Per-tx cap block (Layer 3 — on-chain vault):** Type
   `send 100 SUI to alice`. Confirm. Expect `BLOCKED` with
   `failedRule: "on_chain_vault:EAmountExceedsPerTx"`. No tx digest.

2. **Denylist block (Layer 2 — off-chain policy engine):** Set the denylist
   rule to include `0x0000…0bad` (alice's address), then type
   `send 1 SUI to alice`. Confirm. Expect `BLOCKED` with
   `failedRule: "Known-bad address blocklist"`. No tx digest.

3. **Two-step confirmation (Layer 1):** Type `send 5 SUI to alice`. Click
   **REJECT** in the confirmation dialog. Expect `BLOCKED` with
   `failedRule: "user_rejected"`.

4. **Successful execution:** Type `send 0.5 SUI to self`. Confirm. Expect
   `EXECUTED` with a real `txDigest`. Click the digest → opens Suivision →
   shows the transfer.

5. **Idempotency check (T5):** Within 60 seconds of step 4, repeat step 4
   exactly. Expect `BLOCKED` with `failedRule: "idempotency_check"`.

6. **Fail-closed (T2):** Disable all three rules. Type `send 0.5 SUI to self`.
   Confirm. Expect `BLOCKED` with
   `failedRule: "fail_closed_no_rules"`.

7. **Tamper detection (T4):** Use `psql` to mutate a rule's `config`
   directly (bypassing the API). Wait ≤ 15s. The UI should display a red
   `RULE BOOK TAMPERING DETECTED` banner.

8. **Owner auth (T6):** `curl -X POST $API/api/rules -H "Content-Type: application/json" -d '{"name":"x","type":"MAX_AMOUNT_PER_TX","config":{"maxAmountSui":1}}'`
   without a cookie → expect `401 Unauthorized`.

If all 8 pass, the system is fully operational and every security claim is
demo-able.

---

## 9. Troubleshooting

### 9.1 CORS errors in the browser console

**Symptom:** `Access to fetch at 'https://veto-api.onrender.com/...' from
origin 'https://veto.vercel.app' has been blocked by CORS policy`.

**Cause:** `CORS_ORIGIN` on Render doesn't exactly match the browser origin
(including protocol and trailing slash).

**Fix:**

1. Copy the exact origin from the browser's address bar (e.g.
   `https://veto.vercel.app` — no trailing slash).
2. Render → Environment → update `CORS_ORIGIN`.
3. Trigger a redeploy (Render → Manual Deploy → Deploy Latest Commit).
4. Verify the preflight: `curl -X OPTIONS $API/api/wallet -H "Origin: $WEB" -H "Access-Control-Request-Method: GET" -v`
   should return `204 No Content` with `access-control-allow-origin: https://veto.vercel.app`.

If you're using `credentials: "include"` in fetch (we are — for the cookie),
the backend **must** echo the specific origin, not `*`. The Hono `cors()`
middleware handles this automatically when `origin: [CORS_ORIGIN]` and
`credentials: true` are set.

### 9.2 Cookies not being sent / "Unauthorized" on every authenticated request

**Symptom:** Login succeeds (200 OK with `Set-Cookie`), but subsequent
`/api/rules` calls return 401 even though the browser has the cookie.

**Cause 1 (most common in cross-origin):** Cookie is set with
`SameSite=Strict` or `SameSite=Lax`, which the browser refuses to send
cross-origin. We need `SameSite=None; Secure`.

**Fix:** Update `ownerCookieHeaders()` in `backend/src/lib/auth.ts`:

```ts
"Set-Cookie": `${OWNER_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${60 * 60 * 8}`,
```

`Secure` requires HTTPS — which Render provides automatically. Local dev
(http://localhost) needs `SameSite=Lax` instead — detect via `NODE_ENV`.

**Cause 2:** Browser is blocking third-party cookies (Safari ITP, Firefox
strict mode). For the demo, the simplest fix is to host frontend and backend
on the same eTLD+1 (e.g. `veto.yourdomain.com` + `api.yourdomain.com`), so
the cookie is first-party.

### 9.3 "SQLite on Vercel" — silent data loss in production

**Symptom:** Rules you create via the UI disappear after a few minutes. The
activity feed is empty every time you refresh. `prisma db push` "works
locally" but production data is gone.

**Cause:** Vercel serverless functions get a **fresh, empty filesystem on
every invocation**. A SQLite file written to `./dev.db` lives only for the
duration of one request — the next request starts from scratch. This is the
single most common "hosted demo broke overnight" bug.

**Diagnose:**

```bash
# From repo root:
grep -E '^\s*provider\s*=' backend/prisma/schema.prisma
# If this prints "sqlite", that's the bug.
```

**Fix:**

```bash
cd backend
bash scripts/switch-db.sh postgres    # copies schema.postgres.prisma over schema.prisma
bun run db:push                       # creates tables on Neon
```

Then commit `prisma/schema.prisma` (now the Postgres version) and redeploy.
Always run `bash scripts/pre-deploy-check.sh` before deploys — it catches
this exact bug.

### 9.4 Sui faucet rate limits

**Symptom:** `sui client faucet` returns
`Faucet service is busy, please try again later` or
`Rate limit exceeded`.

**Cause:** The Sui Testnet faucet limits per-IP requests. Sandboxed
environments (CI, dev containers, cloud IDEs) often share IPs and hit this
fast.

**Fixes (in order of preference):**

1. **Run faucet from a clean residential IP** (your laptop). Run
   `sui client faucet` once to fund the agent wallet, then export the
   keypair via `sui keytool export <address>` and use it as
   `SUI_AGENT_SECRET_KEY` everywhere.
2. **Use the Discord faucet**: join the Sui Discord, run
   `/faucet <address>` in the `#testnet-faucet` channel. Higher per-user
   limit.
3. **Buy mainnet SUI** and convert via the bridge if you're testing on
   mainnet (not relevant for hackathon testnet demo).

If you only have a small amount, set the per-tx cap to 0.1 SUI and the daily
cap to 0.5 SUI in the seed rules so the demo doesn't drain the wallet.

### 9.5 Redis (Upstash) connection issues

**Symptom:** `/api/agent/*` endpoints return `429 Too Many Requests` on the
first request, or all requests, or never (rate limit not enforced).

**Cause 1:** `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` is wrong
or missing.

**Diagnose:**

```bash
curl -s "$UPSTASH_REDIS_REST_URL/ping" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
# → {"result":"PONG"}
```

If you get `401 Unauthorized`, the token is wrong. If you get `404`, the URL
is wrong (should be `https://<db-name>-<id>.upstash.io`, no path).

**Cause 2:** The Upstash free tier has a 10,000-commands-per-day limit. If
your UI polls `/api/requests` aggressively, you can burn through this. Fix:
only rate-limit `/api/agent/*` (the expensive LLM route), not the cheap poll
routes.

**Cause 3 (Render cold starts):** On the free tier, Render spins down
services after 15 minutes of inactivity. The first request after spin-down
takes 30+ seconds; if the rate-limit middleware tries to hit Upstash during
this window, the request can time out. Fix: upgrade to Render Starter ($7/mo,
no spin-down) or add a 30s retry in the rate-limit middleware.

### 9.6 "LLM did not return valid JSON" errors

**Symptom:** Every `/api/agent/message` returns
`{"status":"FAILED","failReason":"LLM did not return valid JSON"}`.

**Cause:** The LLM SDK failed silently or returned a non-JSON response.

**Diagnose:** The `parseIntent` function in `backend/src/lib/llm.ts` already
strips markdown fences and extracts the first `{...}` block — if it still
fails, the LLM call itself errored. Check the backend logs for the actual
error message (look for `LLM call failed:` in the failReason).

**Fix:** If `ZAI_API_KEY` (or whatever the SDK requires in your env) is
missing, set it. If the SDK is rate-limited, switch to a different provider
or add a retry.

### 9.7 "Transaction executed but failed" with no helpful error

**Symptom:** `/api/agent/confirm` returns
`{"status":"FAILED","failReason":"Transaction executed but failed"}`.

**Cause:** The Sui transaction was submitted but rejected by the network.
Common reasons:

- Agent wallet has insufficient gas (check `curl $API/api/wallet`).
- Recipient is a malformed address (the LLM passed something the alias
  resolver accepted but the chain didn't).
- The Move module rejected the spend (e.g. `EAmountExceedsDailyCap` — the
  pre-flight check uses today's spent counter, but the on-chain counter
  might roll over differently if 24h have passed mid-request).

**Diagnose:** Look up the digest in Suivision
(`https://testnet.suivision.xyz/txblock/<digest>`) — the events tab will show
the exact Move abort code.

### 9.8 Tamper-detection banner keeps firing even though you didn't tamper

**Symptom:** The red `RULE BOOK TAMPERING DETECTED` banner appears
spontaneously.

**Cause:** The `computeRulesHash` function sorts rules by `createdAt`. If two
rules have the exact same `createdAt` (millisecond collision on a fast
insert), the sort order is non-deterministic between the commit-time
computation and the poll-time computation — producing a spurious mismatch.

**Fix:** Sort by a tiebreaker. In `backend/src/lib/vault.ts`, change:

```ts
const sorted = [...rules].sort(
  (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
);
```

to:

```ts
const sorted = [...rules].sort(
  (a, b) =>
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
);
```

Redeploy. The banner should clear on the next 15-second poll.
