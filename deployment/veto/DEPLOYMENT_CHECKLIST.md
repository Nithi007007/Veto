# Veto — Deployment Checklist

> **Print this. Check every box before recording your demo video.**

## Pre-Deployment (Local)

- [ ] Node.js ≥ 20 installed (`node --version`)
- [ ] Git installed (`git --version`)
- [ ] Project cloned from GitHub
- [ ] `backend/.env` created from `.env.example` with real values:
  - [ ] `DATABASE_URL` set (Neon Postgres)
  - [ ] `PRIVATE_KEY` set (Sui Ed25519 keypair)
  - [ ] `ANTHROPIC_API_KEY` set
  - [ ] `OWNER_PASSWORD` set (strong password)
  - [ ] `CORS_ORIGINS` set (will update after Vercel deploy)
- [ ] `frontend/.env.local` created from `.env.example`:
  - [ ] `NEXT_PUBLIC_API_URL` set to backend URL
- [ ] `cd backend && npm install` succeeded
- [ ] `cd backend && npx prisma db push` succeeded
- [ ] `cd backend && npx prisma generate` succeeded
- [ ] `cd backend && npm run seed` succeeded
- [ ] `cd backend && npm run dev` — backend starts on port 10000
- [ ] `curl http://localhost:10000/health` returns `{"status":"ok",...}`
- [ ] `cd frontend && npm install` succeeded
- [ ] `cd frontend && npm run dev` — frontend starts on port 3000
- [ ] Frontend loads at http://localhost:3000
- [ ] Dashboard shows wallet card + vault card + chat input
- [ ] Rule book tab shows 3 seeded rules
- [ ] Owner login works (click LOGIN, enter password, header shows OWNER)
- [ ] `send 100 sui to alice` → confirm → BLOCKED by on-chain vault
- [ ] `send 1 sui to 0x0000...0bad` → confirm → BLOCKED by denylist
- [ ] Reject in confirmation dialog → BLOCKED by user_rejected

## Accounts Created (all free tiers)

- [ ] [GitHub](https://github.com) account
- [ ] [Vercel](https://vercel.com) account
- [ ] [Render](https://render.com) account
- [ ] [Neon](https://neon.tech) account + Postgres project created
- [ ] [Upstash](https://upstash.com) account + Redis database created
- [ ] [Anthropic](https://anthropic.com) account + API key obtained + billing added

## Database — Neon PostgreSQL

- [ ] Neon project created
- [ ] Pooled connection string copied
- [ ] Connection string contains `?sslmode=require`
- [ ] Schema pushed: `npx prisma db push` against Neon
- [ ] Tables created (Rule, AgentRequest, RuleBookCommit)
- [ ] Seed data inserted: `npm run seed`

## Redis — Upstash

- [ ] Upstash Redis database created
- [ ] REST URL copied
- [ ] REST token copied
- [ ] Both saved for Render env vars

## Smart Contracts — Sui Testnet (Optional)

- [ ] Sui CLI installed (`sui --version`)
- [ ] `sui client` configured (active address on testnet)
- [ ] Testnet SUI requested from faucet
- [ ] `cd contracts && ./scripts/deploy.sh` succeeded
- [ ] `PACKAGE_ID` copied from deploy output
- [ ] `VAULT_OBJECT_ID` copied from deploy output
- [ ] `OWNER_CAP_ID` copied from deploy output
- [ ] All three saved for Render env vars

## GitHub Repository

- [ ] Repo created on GitHub
- [ ] Code pushed to `main` branch
- [ ] `.env` files are NOT committed (check: `git status` should show no .env)
- [ ] `.gitignore` includes `.env`, `node_modules/`, `.next/`, `*.db`

## Backend — Render

- [ ] Render account created
- [ ] New Web Service created from GitHub repo
- [ ] Root Directory set to `backend/`
- [ ] All environment variables set in Render dashboard:
  - [ ] `DATABASE_URL` (Neon connection string)
  - [ ] `UPSTASH_REDIS_REST_URL`
  - [ ] `UPSTASH_REDIS_REST_TOKEN`
  - [ ] `PRIVATE_KEY` (Sui keypair)
  - [ ] `PACKAGE_ID` (from contract deploy, or empty)
  - [ ] `VAULT_OBJECT_ID` (from contract deploy, or empty)
  - [ ] `OWNER_CAP_ID` (from contract deploy, or empty)
  - [ ] `NETWORK` = `testnet`
  - [ ] `OWNER_PASSWORD` (strong password)
  - [ ] `OWNER_TOKEN` (bearer token)
  - [ ] `ANTHROPIC_API_KEY`
  - [ ] `CORS_ORIGINS` (will update with Vercel URL — see below)
  - [ ] `NODE_ENV` = `production`
- [ ] Build succeeded (check Render logs)
- [ ] Service is live (Render dashboard shows "Live")
- [ ] `curl https://YOUR-BACKEND.onrender.com/health` returns 200
- [ ] `curl -X POST https://YOUR-BACKEND.onrender.com/api/seed` returns `{"ok":true}`
- [ ] `curl https://YOUR-BACKEND.onrender.com/api/rules` returns 3 rules + vault state

## Frontend — Vercel

- [ ] Vercel account created
- [ ] New Project created from GitHub repo
- [ ] Root Directory set to `frontend/`
- [ ] Framework preset: Next.js (auto-detected)
- [ ] Environment variables set:
  - [ ] `NEXT_PUBLIC_API_URL` = `https://YOUR-BACKEND.onrender.com`
  - [ ] `NEXT_PUBLIC_SUI_NETWORK` = `testnet`
  - [ ] `NEXT_PUBLIC_PACKAGE_ID` (from contract deploy, or empty)
- [ ] Build succeeded
- [ ] Vercel URL obtained (e.g. `https://veto-xxx.vercel.app`)

## Post-Deployment: CORS Update

- [ ] Vercel URL obtained
- [ ] Render → Environment → `CORS_ORIGINS` updated to Vercel URL
- [ ] Render auto-redeployed after env var change
- [ ] Frontend loads without CORS errors in browser console

## GitHub Secrets (CI/CD)

- [ ] `RENDER_DEPLOY_HOOK_URL` set in GitHub Secrets
- [ ] `VERCEL_DEPLOY_HOOK_URL` set in GitHub Secrets
- [ ] Test: push to `main` → both services auto-redeploy

## Wallet Funding

- [ ] Agent address obtained from dashboard or `curl /api/wallet`
- [ ] Testnet SUI requested from [faucet.testnet.sui.io](https://faucet.testnet.sui.io)
- [ ] Wallet balance shows > 0 SUI on dashboard
- [ ] `send 0.5 sui to self` → confirm → EXECUTED with real tx digest
- [ ] Tx digest resolves on [Suivision](https://testnet.suivision.xyz)

## Smoke Test (Against Production URLs)

```bash
# Set these for the smoke test
export BACKEND_URL=https://YOUR-BACKEND.onrender.com
export OWNER_PASSWORD=your-password

# 1. Health check
curl $BACKEND_URL/health

# 2. Rules (read-only, no auth)
curl $BACKEND_URL/api/rules | jq .

# 3. Wallet
curl $BACKEND_URL/api/wallet | jq .

# 4. Owner login (save cookie)
curl -c cookies.txt -X POST $BACKEND_URL/api/owner/login \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$OWNER_PASSWORD\"}"

# 5. Auth required for rule creation
curl -b cookies.txt -X POST $BACKEND_URL/api/rules \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke test","type":"MAX_AMOUNT_PER_TX","config":{"maxAmountSui":1}}'

# 6. Cleanup — delete the test rule
RULE_ID=$(curl -b cookies.txt $BACKEND_URL/api/rules | jq -r '.rules[-1].id')
curl -b cookies.txt -X DELETE $BACKEND_URL/api/rules/$RULE_ID

# 7. Logout
curl -b cookies.txt -X POST $BACKEND_URL/api/owner/logout
```

- [ ] All 7 smoke tests pass
- [ ] No errors in Render logs during smoke test
- [ ] No errors in Vercel logs when loading the frontend

## Tamper Detection Demo (T4)

- [ ] Note the current commit hash on the Rule book tab
- [ ] Connect to your Neon Postgres directly:
  ```bash
  psql "YOUR_DATABASE_URL" -c "UPDATE \"Rule\" SET config='{\"maxAmountSui\":99999}' WHERE name='Per-transaction cap';"
  ```
- [ ] Within 15 seconds, the red "RULE BOOK TAMPERING DETECTED" banner appears
- [ ] Banner shows both the committed hash and the current mismatching hash
- [ ] Revert the DB change:
  ```bash
  psql "YOUR_DATABASE_URL" -c "UPDATE \"Rule\" SET config='{\"maxAmountSui\":5}' WHERE name='Per-transaction cap';"
  ```
- [ ] Banner clears within 15 seconds

## Final Pre-Submission

- [ ] Live frontend URL works (https://your-app.vercel.app)
- [ ] Live backend URL works (https://your-backend.onrender.com/health)
- [ ] GitHub repo is public
- [ ] README.md is up to date with real URLs
- [ ] No secrets committed to git (`git log --all --full-history -- .env` returns nothing)
- [ ] Demo video recorded (≤ 5 minutes)
- [ ] Submission form filled out on DeepSurge

## Submission Form Fields

| Field | Value |
|-------|-------|
| Project Name | Veto |
| Description | "A deterministic, verifiable policy gate for AI agents that hold and move money on Sui" |
| Project Logo | 1:1 PNG/JPG |
| Public GitHub Repo | https://github.com/YOUR_USERNAME/veto |
| Demo Video | YouTube URL (≤5 min) |
| Website | https://your-app.vercel.app |
| Deployment | Testnet |
| Package ID | From contract deploy (or leave blank if simulated) |

---

✅ **When every box is checked, you're ready to submit.**
