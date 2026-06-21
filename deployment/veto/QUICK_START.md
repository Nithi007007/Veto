# Veto — Quick Start

> **From zero to running in 5 minutes.**

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 20
- [Git](https://git-scm.com)
- A [GitHub](https://github.com) account

## 1. Clone

```bash
git clone https://github.com/YOUR_USERNAME/veto.git
cd veto
```

## 2. Backend setup

```bash
cd backend

# Install dependencies
npm install

# Copy env template
cp .env.example .env

# Edit .env — at minimum, set these:
#   DATABASE_URL   (Neon Postgres — see below)
#   PRIVATE_KEY    (Sui keypair — see below)
#   ANTHROPIC_API_KEY
#   OWNER_PASSWORD
```

### Get a DATABASE_URL (Neon, free)

1. Go to [neon.tech](https://neon.tech) → Sign up → Create project
2. Copy the connection string
3. Paste into `backend/.env` as `DATABASE_URL`

### Generate a Sui PRIVATE_KEY

```bash
node -e "
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const kp = Ed25519Keypair.generate();
console.log('PRIVATE_KEY=' + kp.getSecretKey());
console.log('ADDRESS=' + kp.getPublicKey().toSuiAddress());
"
```

Copy the `PRIVATE_KEY=suiprivkey1q...` line into `backend/.env`.

### Push database schema + seed

```bash
npx prisma db push
npx prisma generate
npm run seed
```

### Start the backend

```bash
npm run dev
# Backend running on http://localhost:10000
```

## 3. Frontend setup

```bash
cd ../frontend

# Install dependencies
npm install

# Copy env template
cp .env.example .env.local

# Edit .env.local — set NEXT_PUBLIC_API_URL if not using default
# (default is http://localhost:10000 which is correct for local dev)

# Start the frontend
npm run dev
# Frontend running on http://localhost:3000
```

## 4. Open the app

Go to **http://localhost:3000**

You should see:
- **Dashboard** with wallet card (0.00 SUI), on-chain vault card, chat input, activity feed
- **Rule book** tab with 3 seeded rules (per-tx cap 5 SUI, daily cap 20 SUI, denylist)
- **Architecture** tab with system diagram

## 5. Test it

Type in the chat input:
```
send 100 sui to alice
```

You should see:
1. Confirmation dialog showing "transfer 100 SUI → alice"
2. Click "Confirm & execute"
3. Activity feed shows: **BLOCKED** — `on-chain vault: EAmountExceedsPerTx`

## 6. Owner login

Click **LOGIN** in the top-right corner. Enter the `OWNER_PASSWORD` you set in `backend/.env`.

Now you can:
- Toggle rules on/off
- Add new rules
- Delete rules
- Every change re-commits the rule hash to the vault

## 7. Fund the wallet (optional, for EXECUTED flow)

Get your agent address from the dashboard, then visit [faucet.testnet.sui.io](https://faucet.testnet.sui.io) to request testnet SUI.

After funding, `send 0.5 sui to self` → confirm → should show **EXECUTED** with a real tx digest.

---

## What's next?

- **Deploy to production**: Follow [DEPLOYMENT.md](DEPLOYMENT.md)
- **Understand the architecture**: Read [docs/Architecture.md](docs/Architecture.md)
- **API reference**: See [docs/API.md](docs/API.md)
- **Security model**: Read [docs/Security.md](docs/Security.md)
- **Deployment checklist**: Use [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm install` fails | Make sure Node.js ≥ 20: `node --version` |
| Backend won't start | Check `backend/.env` — `DATABASE_URL`, `PRIVATE_KEY`, `ANTHROPIC_API_KEY` all set |
| Frontend can't reach backend | Check `frontend/.env.local` — `NEXT_PUBLIC_API_URL` should be `http://localhost:10000` |
| CORS errors | Make sure you're accessing frontend at `http://localhost:3000`, not `127.0.0.1` |
| Wallet shows 0 SUI | Fund from [faucet.testnet.sui.io](https://faucet.testnet.sui.io) |
| "BLOCKED: fail_closed_no_rules" | Run `npm run seed` in the backend folder |
