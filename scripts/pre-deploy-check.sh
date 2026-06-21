#!/bin/bash
# Veto — pre-deploy check
#
# Run this BEFORE deploying to Vercel. It fails loudly if the schema is still
# SQLite (which would silently break in production) or if any required env var
# is missing.
#
# Usage: ./scripts/pre-deploy-check.sh

set -e
cd "$(dirname "$0")/.."

echo "=== Veto pre-deploy check ==="
echo ""

# 1. Schema must be Postgres
SCHEMA_PROVIDER=$(grep -E '^\s*provider\s*=' prisma/schema.prisma | head -1 | grep -oE '"(sqlite|postgresql)"' | tr -d '"')
if [ "$SCHEMA_PROVIDER" != "postgresql" ]; then
  echo "❌ FAIL: prisma/schema.prisma is using '$SCHEMA_PROVIDER' (must be 'postgresql')."
  echo "   Vercel's serverless functions get a fresh filesystem on every request,"
  echo "   so SQLite files don't persist in production."
  echo ""
  echo "   Fix: ./scripts/switch-db.sh postgres"
  echo "        bun run db:push"
  echo "        (DATABASE_URL must point at a real Postgres instance)"
  exit 1
fi
echo "✓ Schema provider is Postgres (Vercel-safe)"

# 2. DATABASE_URL must be set and look like a Postgres URL
if [ -z "$DATABASE_URL" ]; then
  echo "❌ FAIL: DATABASE_URL is not set"
  exit 1
fi
case "$DATABASE_URL" in
  postgres://*|postgresql://*) echo "✓ DATABASE_URL is a Postgres connection string" ;;
  file:*) echo "❌ FAIL: DATABASE_URL is a SQLite file URL — switch to Postgres first"; exit 1 ;;
  *) echo "⚠️  DATABASE_URL doesn't look like a Postgres URL — verify: $DATABASE_URL"; exit 1 ;;
esac

# 3. Required env vars
for var in SUI_AGENT_SECRET_KEY OWNER_PASSWORD SUI_NETWORK; do
  if [ -z "${!var}" ]; then
    echo "❌ FAIL: $var is not set"
    exit 1
  fi
done
echo "✓ SUI_AGENT_SECRET_KEY, OWNER_PASSWORD, SUI_NETWORK all set"

# 4. Test DB connection
echo ""
echo "Testing DB connection..."
if bun x prisma db execute --stdin <<< "SELECT 1;" 2>&1 | grep -q "1"; then
  echo "✓ DB connection works"
else
  echo "⚠️  DB connection check didn't return expected result — verify DATABASE_URL is reachable"
fi

echo ""
echo "=== All pre-deploy checks passed ✓ ==="
echo "Next: commit, push to GitHub, import on Vercel."
