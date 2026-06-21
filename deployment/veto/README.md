# Veto

> A deterministic, verifiable policy gate for AI agents that hold and move money on Sui.

Built for **Sui Overflow 2026 — Agentic Web track**.

## What is Veto?

AI agents are starting to hold real wallets. Most agent frameworks let the model decide *and* execute in the same step. One bad instruction, one prompt injection, one hallucination, and funds move. **Veto puts two enforcement layers between an agent's reasoning and its wallet:** an off-chain deterministic policy engine (runtime, fast, editable) AND an on-chain vault (backstop, hard-capped, tamper-evident). Both must agree for a transaction to land.

## Quick start

```bash
# 1. Clone this repo
git clone https://github.com/yourname/veto.git
cd veto

# 2. Run setup (installs deps, creates .env files, pushes DB schema)
bash scripts/setup.sh

# 3. Edit backend/.env with your actual values (DATABASE_URL, PRIVATE_KEY, etc.)

# 4. Start backend + frontend
cd backend && npm run dev   # http://localhost:10000
cd frontend && npm run dev  # http://localhost:3000
```

Or run everything with Docker:
```bash
docker-compose up -d
```

## Project structure

```
veto/
├── frontend/              # Next.js dashboard → Vercel
│   ├── src/app/           # Page + layout
│   ├── src/lib/           # API client + types
│   └── src/components/    # shadcn/ui components
│
├── backend/               # Hono API server → Render
│   ├── src/routes/        # API route handlers
│   ├── src/lib/           # Business logic (policy engine, vault, Sui, LLM, auth)
│   ├── src/middleware/    # Rate limiting
│   ├── prisma/            # Database schema
│   ├── Dockerfile         # Container build
│   └── render.yaml        # Render deployment config
│
├── contracts/             # Sui Move smart contracts → Sui Testnet
│   ├── sources/vault.move # On-chain vault (OwnerCap + atomic spend)
│   └── scripts/deploy.sh  # Deployment script
│
├── docs/                  # Full documentation
│   ├── Architecture.md    # System design + threat model
│   ├── Deployment.md      # Step-by-step deploy guide
│   ├── API.md             # All 13 endpoints
│   ├── Security.md        # T1-T6 threat model + mitigations
│   └── README.md          # Doc index
│
├── scripts/               # Operational scripts
│   ├── deploy.sh          # Full deployment orchestrator
│   ├── setup.sh           # Local development setup
│   └── seed.ts            # Database seeding
│
├── .github/workflows/     # CI/CD
│   └── deploy.yml         # GitHub Actions deploy pipeline
│
├── docker-compose.yml     # Local dev with all services
├── LICENSE                # MIT
└── README.md              # This file
```

## Deployment targets

| Component | Service | Free tier | URL |
|-----------|---------|-----------|-----|
| Frontend | Vercel | ✅ Hobby | https://vercel.com |
| Backend | Render | ✅ Free | https://render.com |
| Database | Neon | ✅ Free | https://neon.tech |
| Redis | Upstash | ✅ Free | https://upstash.com |
| Contracts | Sui Testnet | ✅ Free | https://sui.io |
| Repository | GitHub | ✅ Free | https://github.com |

## Documentation

- **[docs/Architecture.md](docs/Architecture.md)** — System design, threat model, data flow
- **[docs/Deployment.md](docs/Deployment.md)** — Step-by-step deployment for all 5 services
- **[docs/API.md](docs/API.md)** — All 13 API endpoints with examples
- **[docs/Security.md](docs/Security.md)** — T1-T6 threat model + mitigations
- **[docs/README.md](docs/README.md)** — Documentation index

## Key features

- **Deterministic policy engine** — pure TypeScript, zero LLM calls, fail-closed
- **On-chain vault** — Move module with OwnerCap pattern, atomic spend, hard caps
- **Two-step confirmation** — hallucination guard (LLM parses → user confirms → execute)
- **Tamper detection** — red banner fires when DB rules don't match committed hash
- **Idempotency** — 60s window prevents replay/double-submit
- **Owner/Agent boundary** — cookie + token auth, OwnerCap on-chain in production
- **Rate limiting** — Redis-based, 10 req/min on agent endpoints

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 + TypeScript + Tailwind + shadcn/ui |
| Backend | Hono + TypeScript on Node.js |
| Database | PostgreSQL (Neon) via Prisma |
| Redis | Upstash (rate limiting) |
| Chain | Sui Testnet via @mysten/sui v2 |
| Smart contracts | Sui Move |
| LLM | Anthropic Claude (swappable) |
| Hosting | Vercel (frontend) + Render (backend) |

## License

MIT — see [LICENSE](LICENSE).
