# Veto Backend

> Hono API server for the Veto policy gate. Deploys to Render (free tier).

## Quick start

```bash
# 1. Install dependencies
bun install

# 2. Copy env template
cp .env.example .env
# Edit .env: set DATABASE_URL (Neon), PRIVATE_KEY, ANTHROPIC_API_KEY, OWNER_PASSWORD

# 3. Push database schema
bun run db:push

# 4. Start dev server
bun run dev
```

Server runs on `http://localhost:10000`.

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/agent/message` | None | LLM parse → AWAITING_CONFIRMATION |
| `POST` | `/api/agent/confirm` | None | Idempotency + vault + policy + SUI execution |
| `GET` | `/api/requests?limit=20` | None | Activity feed |
| `GET` | `/api/rules` | None | List rules + vault state + tamper flag |
| `POST` | `/api/rules` | Owner | Create rule → vault re-commit |
| `PATCH` | `/api/rules/:id` | Owner | Toggle/edit → vault re-commit |
| `DELETE` | `/api/rules/:id` | Owner | Delete → vault re-commit |
| `POST` | `/api/owner/login` | None | Password → session cookie |
| `POST` | `/api/owner/logout` | None | Clear cookie |
| `GET` | `/api/owner/status` | None | `{ authenticated: boolean }` |
| `GET` | `/api/wallet` | None | Agent wallet address + balance |
| `GET` | `/api/aliases` | None | Named address book |
| `POST` | `/api/seed` | None | Seed default rules (idempotent) |
| `GET` | `/health` | None | Health check (used by Render) |

## Environment variables

See `.env.example` for the full list. Critical ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `PRIVATE_KEY` | Yes | Agent's Ed25519 Sui private key |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for intent parsing |
| `OWNER_PASSWORD` | Yes | Password for owner login |
| `PORT` | No | Server port (default: 10000) |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins (your Vercel URL) |

## Architecture

```
src/
├── index.ts              ← Hono server entry
├── routes/
│   ├── agent.ts          ← /api/agent/message + /api/agent/confirm
│   ├── rules.ts          ← /api/rules CRUD (owner-auth on writes)
│   ├── owner.ts          ← /api/owner/login + logout + status
│   └── misc.ts           ← /api/requests, /api/wallet, /api/aliases, /api/seed
├── lib/
│   ├── policy-engine.ts  ← THE CORE: pure TS, zero LLM calls, fail-closed
│   ├── vault.ts          ← On-chain vault simulator + commit + tamper detection
│   ├── sui.ts            ← Sui testnet client + keypair + transfer
│   ├── llm.ts            ← Anthropic Claude intent parser (zod-validated)
│   ├── auth.ts           ← Owner cookie + token auth
│   ├── aliases.ts        ← Named address book
│   ├── redis.ts          ← Upstash Redis client (rate limiting)
│   ├── types.ts          ← Shared types
│   └── db.ts             ← Prisma client singleton
└── middleware/
    └── rate-limit.ts     ← 10 req/min per IP on /api/agent/*
```

## Deployment to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Select the `backend/` directory as the root
5. Render will auto-detect the `render.yaml` or `Dockerfile`
6. Set all environment variables (see `.env.example`)
7. Deploy

Health check: `GET /health` returns `{ status: "ok" }`.

## Testing locally

```bash
# Start the server
bun run dev

# Run the API smoke test (from project root)
BASE_URL=http://localhost:10000 OWNER_PASSWORD=your-password bash ../tests/api-test.sh
```
