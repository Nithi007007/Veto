#!/bin/bash
# Veto — DB schema switcher
#
# Usage:
#   ./scripts/switch-db.sh postgres   # use Postgres (production — required for Vercel)
#   ./scripts/switch-db.sh sqlite     # use SQLite (local dev only — DO NOT DEPLOY)
#
# Always commit the file you switched TO so the right schema is in the repo
# when you deploy.

set -e
cd "$(dirname "$0")/.."

TARGET="${1:-postgres}"

if [ "$TARGET" = "postgres" ]; then
  cp prisma/schema.postgres.prisma prisma/schema.prisma
  echo "✓ Active schema is now Postgres (production-safe for Vercel)."
  echo "  Make sure DATABASE_URL points at a real Postgres instance (Neon, Supabase, etc)."
  echo "  Run: bun run db:push"
elif [ "$TARGET" = "sqlite" ]; then
  cp prisma/schema.sqlite.prisma prisma/schema.prisma
  echo "⚠️  Active schema is now SQLite (LOCAL DEV ONLY)."
  echo "  DO NOT deploy with this — Vercel serverless filesystem is reset per request."
  echo "  Run: bun run db:push"
  echo "  When ready to deploy: ./scripts/switch-db.sh postgres"
else
  echo "Unknown target: $TARGET (use 'postgres' or 'sqlite')"
  exit 1
fi
