#!/bin/bash
# Veto — Local development setup
# Run this once to get the full project running locally.

set -e

cd "$(dirname "$0")/.."

echo "╔══════════════════════════════════════════╗"
echo "║  Veto — Local Setup                      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check prerequisites
echo "── Prerequisites ──"
command -v node >/dev/null 2>&1 && echo "✓ Node.js: $(node --version)" || { echo "❌ Node.js not found"; exit 1; }
command -v npm >/dev/null 2>&1 && echo "✓ npm: $(npm --version)" || { echo "❌ npm not found"; exit 1; }
echo ""

# ─── Backend setup ───
echo "── Backend setup ──"
cd backend

if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ Created backend/.env from template"
  echo "⚠️  Edit backend/.env with your actual values:"
  echo "   - DATABASE_URL (Neon Postgres)"
  echo "   - PRIVATE_KEY (Sui keypair)"
  echo "   - ANTHROPIC_API_KEY"
  echo "   - OWNER_PASSWORD"
else
  echo "✓ backend/.env already exists"
fi

npm install
echo "✓ Backend dependencies installed"

npx prisma generate
echo "✓ Prisma client generated"

if [ -n "$DATABASE_URL" ]; then
  npx prisma db push
  echo "✓ Database schema pushed"
else
  echo "⚠️  DATABASE_URL not set — skipping db push."
  echo "   Set it in backend/.env and run: cd backend && npx prisma db push"
fi

cd ..
echo ""

# ─── Frontend setup ───
echo "── Frontend setup ──"
cd frontend

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "✓ Created frontend/.env.local from template"
  echo "⚠️  Edit frontend/.env.local:"
  echo "   - NEXT_PUBLIC_API_URL (backend URL, default: http://localhost:10000)"
else
  echo "✓ frontend/.env.local already exists"
fi

npm install
echo "✓ Frontend dependencies installed"

cd ..
echo ""

# ─── Done ───
echo "╔══════════════════════════════════════════╗"
echo "║  Setup complete!                         ║"
echo "║                                          ║"
echo "║  Start backend:  cd backend && npm run dev"
echo "║  Start frontend: cd frontend && npm run dev"
echo "║                                          ║"
echo "║  Backend:  http://localhost:10000        ║"
echo "║  Frontend: http://localhost:3000         ║"
echo "╚══════════════════════════════════════════╝"
