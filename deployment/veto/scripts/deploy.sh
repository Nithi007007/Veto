#!/bin/bash
# Veto — Full deployment script
# Orchestrates: contracts → database → backend → frontend
#
# Usage:
#   chmod +x scripts/deploy.sh
#   ./scripts/deploy.sh [contracts|database|backend|frontend|all]
#
# Default: all

set -e

cd "$(dirname "$0")/.."
TARGET="${1:-all}"

echo "╔══════════════════════════════════════════╗"
echo "║  Veto — Full Deployment                  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── Contracts ───
if [ "$TARGET" = "contracts" ] || [ "$TARGET" = "all" ]; then
  echo "── Smart Contracts ──"
  if command -v sui &> /dev/null; then
    cd contracts
    ./scripts/deploy.sh
    cd ..
  else
    echo "⚠️  Sui CLI not found — skipping contract deployment."
    echo "   Install: https://docs.sui.io/guides/developer/getting-started/sui-install"
  fi
  echo ""
fi

# ─── Database ───
if [ "$TARGET" = "database" ] || [ "$TARGET" = "all" ]; then
  echo "── Database Migration ──"
  cd backend
  if [ -z "$DATABASE_URL" ]; then
    echo "⚠️  DATABASE_URL not set — skipping."
    echo "   Set it in backend/.env (Neon Postgres connection string)"
  else
    npx prisma db push
    npx prisma generate
    echo "✓ Database schema pushed"
  fi
  cd ..
  echo ""
fi

# ─── Backend ───
if [ "$TARGET" = "backend" ] || [ "$TARGET" = "all" ]; then
  echo "── Backend ──"
  echo "Backend deploys to Render via Docker."
  echo "1. Push to GitHub"
  echo "2. Go to render.com → New → Web Service"
  echo "3. Connect repo, select backend/ as root"
  echo "4. Set env vars (see backend/.env.example)"
  echo "5. Deploy"
  echo ""
  echo "Or build locally with Docker:"
  echo "  cd backend && docker build -t veto-backend . && docker run -p 10000:10000 veto-backend"
  echo ""
fi

# ─── Frontend ───
if [ "$TARGET" = "frontend" ] || [ "$TARGET" = "all" ]; then
  echo "── Frontend ──"
  echo "Frontend deploys to Vercel."
  echo "1. Push to GitHub"
  echo "2. Go to vercel.com → New Project"
  echo "3. Import repo, set root directory to frontend/"
  echo "4. Set env vars:"
  echo "   NEXT_PUBLIC_API_URL=https://your-backend.onrender.com"
  echo "5. Deploy"
  echo ""
fi

echo "╔══════════════════════════════════════════╗"
echo "║  Deployment guide complete.              ║"
echo "║  See docs/Deployment.md for details.     ║"
echo "╚══════════════════════════════════════════╝"
