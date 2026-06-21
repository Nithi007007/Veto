# Veto Frontend

> Next.js dashboard for the Veto policy gate. Deploys to Vercel (free tier).

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .env.example .env.local
# Edit .env.local: set NEXT_PUBLIC_API_URL to your backend URL

# 3. Start dev server
npm run dev
```

App runs on `http://localhost:3000`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | Backend API URL (e.g. `http://localhost:10000` for dev, `https://veto-backend.onrender.com` for prod) |
| `NEXT_PUBLIC_SUI_NETWORK` | No | Sui network for display (default: `testnet`) |
| `NEXT_PUBLIC_PACKAGE_ID` | No | Move package ID (for future on-chain integration) |

## Vercel deployment

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project
3. Import your GitHub repo
4. Set the root directory to `frontend/`
5. Set environment variables:
   - `NEXT_PUBLIC_API_URL` = `https://your-backend.onrender.com`
   - `NEXT_PUBLIC_SUI_NETWORK` = `testnet`
6. Deploy

## Architecture

```
src/
├── app/
│   ├── layout.tsx        ← Root layout (fonts, Toaster)
│   ├── page.tsx          ← Single-page dashboard (3 tabs + dialogs)
│   └── globals.css       ← Tailwind + custom styles
├── lib/
│   ├── api.ts            ← API client (prepends NEXT_PUBLIC_API_URL, credentials: include)
│   ├── types.ts          ← Shared TypeScript types
│   └── utils.ts          ← cn() helper for Tailwind
└── components/ui/         ← shadcn/ui components (Card, Button, Dialog, etc.)
```

## Features

- **Dashboard tab**: wallet card, on-chain vault card, chat input, live activity feed
- **Rule book tab**: tamper detection banner, owner auth banner, vault commit card, rule CRUD
- **Architecture tab**: system diagram + stack list
- **Two-step confirmation**: LLM parses → user confirms → policy + vault check → SUI execution
- **Owner login dialog**: password → signed session cookie (cross-origin)
- **Tamper detection**: red banner fires when DB rules don't match committed hash
