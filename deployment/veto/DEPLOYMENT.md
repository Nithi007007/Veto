# Veto — Deployment Guide

> **Single source of truth for deploying Veto to production.**
>
> This document supersedes any scattered deployment notes. Follow it top to bottom.

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Environment Variables Reference](#3-environment-variables-reference)
4. [Step 1: Database — Neon PostgreSQL](#step-1-database--neon-postgresql)
5. [Step 2: Redis — Upstash](#step-2-redis--upstash)
6. [Step 3: Smart Contracts — Sui Testnet](#step-3-smart-contracts--sui-testnet)
7. [Step 4: Backend — Render](#step-4-backend--render)
8. [Step 5: Frontend — Vercel](#step-5-frontend--vercel)
9. [Step 6: GitHub Secrets (CI/CD)](#step-6-github-secrets-cicd)
10. [Post-Deployment Verification](#post-deployment-verification)
11. [Troubleshooting](#troubleshooting)

---

## 1. Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │     │    Backend      │     │   Database      │
│   (Vercel)      │────▶│    (Render)     │────▶│   (Neon)        │
│   Next.js 16    │     │   Hono + Node   │     │   PostgreSQL    │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                          ┌──────┴──────┐
                          │             │
                   ┌──────▼─────┐ ┌─────▼──────┐ ┌──────────────┐
                   │  Sui RPC   │ │   Redis    │ │  Anthropic   │
                   │  (Testnet) │ │ (Upstash)  │ │  Claude API  │
                   └────────────┘ └────────────┘ └──────────────┘
```

| Component | Service | Free tier | Purpose |
|-----------|---------|-----------|---------|
| Frontend | Vercel | ✅ Hobby | Next.js dashboard |
| Backend | Render | ✅ Free | Hono API server |
| Database | Neon | ✅ Free | PostgreSQL (rules, requests, commits) |
| Redis | Upstash | ✅ Free | Rate limiting |
| Contracts | Sui Testnet | ✅ Free | Move vault module |
| LLM | Anthropic | ⚠️ Paid | Claude for intent parsing |
| Repo | GitHub | ✅ Free | Source control + CI/CD |

---

## 2. Prerequisites

| Tool | Version | Verify | Why |
|------|---------|--------|-----|
| Node.js | ≥ 20 | `node --version` | Backend + frontend runtime |
| npm | ≥ 10 | `npm --version` | Package manager |
| Git | ≥ 2.40 | `git --version` | Clone + push |
| Sui CLI | ≥ 1.30 | `sui --version` | Deploy Move contracts |
| curl | latest | `curl --version` | Smoke tests |

### Accounts needed (all free)

- [GitHub](https://github.com) — repo + CI/CD
- [Vercel](https://vercel.com) — frontend hosting
- [Render](https://render.com) — backend hosting
- [Neon](https://neon.tech) — PostgreSQL database
- [Upstash](https://upstash.com) — Redis for rate limiting
- [Anthropic](https://anthropic.com) — Claude API (paid, ~$5 credit enough for hackathon)

---

## 3. Environment Variables Reference

### Backend (`backend/.env`)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | **Yes** | Neon Postgres connection string | `postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require` |
| `UPSTASH_REDIS_REST_URL` | **Yes** | Upstash Redis REST URL | `https://xxx-xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | **Yes** | Upstash REST token | `AXXX...` |
| `RPC_URL` | No | Sui RPC endpoint (default: testnet) | `https://fullnode.testnet.sui.io` |
| `PRIVATE_KEY` | **Yes** | Agent's Ed25519 Sui private key | `suiprivkey1q...` |
| `PACKAGE_ID` | No* | Move package ID (after contract deploy) | `0x...` |
| `VAULT_OBJECT_ID` | No* | Shared Vault object ID | `0x...` |
| `OWNER_CAP_ID` | No* | OwnerCap object ID | `0x...` |
| `NETWORK` | No | Sui network | `testnet` |
| `PORT` | No | Server port (Render sets this) | `10000` |
| `OWNER_PASSWORD` | **Yes** | Password for owner login | `a-strong-password` |
| `OWNER_TOKEN` | No | Bearer token for API clients | `another-token` |
| `OWNER_COOKIE_SECRET` | No | HMAC secret for cookies (defaults to OWNER_PASSWORD) | `random-hex` |
| `ANTHROPIC_API_KEY` | **Yes** | Claude API key | `sk-ant-xxx...` |
| `CORS_ORIGINS` | **Yes** | Comma-separated allowed origins | `https://your-app.vercel.app` |
| `NODE_ENV` | No | Environment | `production` |

\* Required only if you deploy the Move contracts to Sui (Step 3). The app runs in "simulated" mode without them.

### Frontend (`frontend/.env.local`)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | **Yes** | Backend API URL (Render URL in prod) | `https://veto-backend.onrender.com` |
| `NEXT_PUBLIC_SUI_NETWORK` | No | Sui network for display | `testnet` |
| `NEXT_PUBLIC_PACKAGE_ID` | No | Move package ID | `0x...` |

> ⚠️ **Never use `localhost` in production `NEXT_PUBLIC_API_URL`.** It must point to your Render URL.

---

## Step 1: Database — Neon PostgreSQL

1. Go to [neon.tech](https://neon.tech) → Sign up (free)
2. Create a new project → name it `veto`
3. Copy the **pooled connection string** (ends with `?sslmode=require`)
4. Save it — you'll need it for `DATABASE_URL` in Render

```bash
# Example format:
postgresql://veto_owner:AbCdEfGh@ep-cool-name-123456.us-east-2.aws.neon.tech/veto?sslmode=require
```

### Push the schema

Once your backend is set up (Step 4), run:

```bash
cd backend
npx prisma db push
npx prisma generate
```

This creates the `Rule`, `AgentRequest`, and `RuleBookCommit` tables.

---

## Step 2: Redis — Upstash

1. Go to [upstash.com](https://upstash.com) → Sign up (free)
2. Create a new Redis database → name it `veto`
3. Copy the **REST URL** and **REST token**
4. Save them — you'll need them for `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Render

> **Why Redis?** Rate limiting on `/api/agent/*` endpoints (10 req/min per IP). Without Redis, the backend still runs but rate limiting is disabled.

---

## Step 3: Smart Contracts — Sui Testnet

> **Optional for v1.** The app runs in "simulated" mode without on-chain contracts. Deploy them if you want the full on-chain vault enforcement.

### Install Sui CLI

```bash
# macOS
brew install sui

# Linux
curl -L https://github.com/MystenLabs/sui/releases/latest/download/sui-mainnet-v1.0.0-ubuntu-x86_64.tgz -o sui.tgz
tar -xzf sui.tgz && sudo mv sui /usr/local/bin/
```

### Deploy

```bash
cd contracts

# 1. Set up Sui client (if not done)
sui client

# 2. Switch to testnet
sui client switch --env testnet

# 3. Get testnet SUI from faucet
sui client faucet  # or visit https://faucet.testnet.sui.io

# 4. Build + publish
./scripts/deploy.sh
```

The deploy script outputs three IDs:
- `PACKAGE_ID` — the Move package
- `VAULT_OBJECT_ID` — the shared Vault object
- `OWNER_CAP_ID` — the OwnerCap object

Save these — you'll set them as env vars in Render.

---

## Step 4: Backend — Render

### 4.1 Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: Veto deployment-ready"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/veto.git
git push -u origin main
```

### 4.2 Create Render service

1. Go to [render.com](https://render.com) → Sign up
2. **New** → **Blueprint**
3. Select your GitHub repo
4. Render reads `backend/render.yaml` automatically
5. Set all environment variables (the ones marked `sync: false`):

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your Neon connection string |
| `UPSTASH_REDIS_REST_URL` | Your Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Your Upstash token |
| `PRIVATE_KEY` | Your Sui agent private key |
| `PACKAGE_ID` | From Step 3 (or leave empty) |
| `VAULT_OBJECT_ID` | From Step 3 (or leave empty) |
| `OWNER_CAP_ID` | From Step 3 (or leave empty) |
| `OWNER_PASSWORD` | A strong password |
| `OWNER_TOKEN` | A bearer token |
| `ANTHROPIC_API_KEY` | `sk-ant-xxx...` |
| `CORS_ORIGINS` | Your Vercel URL (set after Step 5) |

6. Click **Apply** → Render builds the Docker image and starts the service

### 4.3 Verify backend is running

```bash
# Replace with your Render URL
curl https://veto-backend.onrender.com/health

# Expected response:
# {"status":"ok","timestamp":"...","network":"testnet","uptime":...}
```

### 4.4 Seed the database

```bash
curl -X POST https://veto-backend.onrender.com/api/seed
# {"ok":true,"message":"Seeded 3 default rules + initial vault commit (v1)"}
```

---

## Step 5: Frontend — Vercel

### 5.1 Create Vercel project

1. Go to [vercel.com](https://vercel.com) → Sign up with GitHub
2. **Add New** → **Project**
3. Import your GitHub repo
4. **Set Root Directory** to `frontend/`
5. Framework preset: **Next.js** (auto-detected)
6. Set environment variables:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://veto-backend.onrender.com` (your Render URL) |
| `NEXT_PUBLIC_SUI_NETWORK` | `testnet` |
| `NEXT_PUBLIC_PACKAGE_ID` | From Step 3 (or leave empty) |

7. Click **Deploy**

### 5.2 Update CORS on Render

Once Vercel gives you a URL (e.g. `https://veto-xxx.vercel.app`):

1. Go back to Render → your backend service → Environment
2. Update `CORS_ORIGINS` to: `https://veto-xxx.vercel.app`
3. Save → Render auto-redeploys

### 5.3 Verify frontend

Open your Vercel URL. You should see:
- Dashboard with wallet card + on-chain vault card
- "Owner login" button in the header
- Activity feed showing "No activity yet"

---

## Step 6: GitHub Secrets (CI/CD)

The `.github/workflows/deploy.yml` file triggers Render + Vercel deploy hooks on every push to `main`. Set these secrets in your GitHub repo:

**GitHub → Settings → Secrets and Variables → Actions → New repository secret**

| Secret Name | Value | Where to get it |
|-------------|-------|-----------------|
| `RENDER_DEPLOY_HOOK_URL` | Render deploy hook URL | Render → your service → Settings → Deploy Hook |
| `VERCEL_DEPLOY_HOOK_URL` | Vercel deploy hook URL | Vercel → your project → Settings → Git → Deploy Hooks |

> **Without these secrets, CI/CD won't trigger automatic deploys** — you'll need to deploy manually from the Render/Vercel dashboards.

---

## Post-Deployment Verification

Run this checklist after everything is deployed:

```bash
# 1. Backend health check
curl https://veto-backend.onrender.com/health
# Expected: {"status":"ok",...}

# 2. Backend seeded
curl -X POST https://veto-backend.onrender.com/api/seed
# Expected: {"ok":true,"message":"Seeded 3 default rules..."}

# 3. Rules endpoint
curl https://veto-backend.onrender.com/api/rules | jq .
# Expected: 3 rules + vault state + commit

# 4. Wallet endpoint
curl https://veto-backend.onrender.com/api/wallet | jq .
# Expected: agent wallet address + balance

# 5. Owner login (use your OWNER_PASSWORD)
curl -c cookies.txt -X POST https://veto-backend.onrender.com/api/owner/login \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_PASSWORD"}'
# Expected: {"ok":true,"message":"Owner session established"}

# 6. Auth required for rule creation
curl -b cookies.txt -X POST https://veto-backend.onrender.com/api/rules \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","type":"MAX_AMOUNT_PER_TX","config":{"maxAmountSui":1}}'
# Expected: 201 Created + new commit version

# 7. Frontend loads
# Open your Vercel URL in a browser — dashboard should render

# 8. Two-step flow works
# In the frontend: type "send 100 sui to alice" → confirm → should see BLOCKED
```

---

## Troubleshooting

### "CORS error" in browser console

**Cause:** `CORS_ORIGINS` on Render doesn't include your Vercel URL.

**Fix:** Go to Render → Environment → `CORS_ORIGINS` → add `https://your-app.vercel.app` → Save.

### "Cookie not being sent" cross-origin

**Cause:** Cookies require `SameSite=None` + `Secure` (set in `backend/src/lib/auth.ts`). This only works over HTTPS.

**Fix:** Make sure both frontend (Vercel) and backend (Render) are on HTTPS. Local dev uses `http://localhost` which works because same-origin.

### Render service keeps restarting

**Cause:** Health check failing — `/health` endpoint not returning 200.

**Fix:**
1. Check Render logs (Logs tab)
2. Common causes:
   - `DATABASE_URL` not set or wrong → Prisma can't connect
   - `PRIVATE_KEY` invalid → Sui keypair fails to load
   - Port mismatch → Render expects `PORT` env var, Dockerfile exposes 10000

### "prisma migrate deploy" fails on Render

**Cause:** No migrations exist yet (we use `db push` for initial schema).

**Fix:** The start command runs `prisma migrate deploy` which is a no-op if no migrations exist. If it fails, run `npx prisma db push` once locally (with the same `DATABASE_URL`) to create tables, then Redeploy on Render.

### Faucet rate-limited (Sui testnet)

**Cause:** Testnet SUI faucet limits per-IP.

**Fix:**
1. Wait 24h and try again, OR
2. Use a different IP (VPN), OR
3. Skip Step 3 (contract deployment) — the app runs in "simulated" mode without on-chain contracts

### Anthropic API key not working

**Cause:** Invalid key or no credits.

**Fix:**
1. Check key at [console.anthropic.com](https://console.anthropic.com)
2. Add billing (minimum $5)
3. Verify with: `curl https://api.anthropic.com/v1/messages -H "x-api-key: YOUR_KEY" ...`

### Frontend shows "Loading wallet…" forever

**Cause:** `NEXT_PUBLIC_API_URL` not set or pointing to wrong backend.

**Fix:**
1. Check Vercel environment variables
2. Verify the URL with: `curl https://your-backend.onrender.com/api/wallet`
3. Redeploy frontend after setting env vars

---

## Quick Reference: Deployment Order

```
1. GitHub repo     → git push
2. Neon (database) → copy connection string
3. Upstash (Redis) → copy REST URL + token
4. Sui (contracts) → optional, run deploy.sh
5. Render (backend)→ import repo, set env vars, deploy
6. Vercel (frontend) → import repo, set NEXT_PUBLIC_API_URL, deploy
7. Update CORS_ORIGINS on Render with Vercel URL
8. Set GitHub secrets for CI/CD
9. Run post-deployment verification
```

---

For the full architecture, API reference, and security model, see:
- [docs/Architecture.md](docs/Architecture.md)
- [docs/API.md](docs/API.md)
- [docs/Security.md](docs/Security.md)
