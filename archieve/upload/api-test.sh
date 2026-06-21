#!/bin/bash
# Veto — API smoke test
# I don't have access to your running app, so this can't be executed from my side —
# run this yourself against your dev server or your deployed Vercel URL.
#
# Usage:
#   chmod +x api-test.sh
#   BASE_URL=http://localhost:3000 OWNER_PASSWORD=dev-owner-password ./api-test.sh
#   BASE_URL=https://your-app.vercel.app OWNER_PASSWORD=yourrealpassword ./api-test.sh
#
# Route names below (/api/auth/login etc.) are best guesses based on your dev log —
# adjust any path that doesn't match your actual routes.

BASE_URL="${BASE_URL:-http://localhost:3000}"
OWNER_PASSWORD="${OWNER_PASSWORD:-dev-owner-password}"
PASS=0
FAIL=0
COOKIE_JAR=$(mktemp)

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc (got $actual)"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc (expected $expected, got $actual)"
    FAIL=$((FAIL+1))
  fi
}

echo "== Veto API smoke test against $BASE_URL =="
echo ""

echo "[1] Wallet endpoint reachable"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/wallet")
check "GET /api/wallet returns 200" "200" "$CODE"

echo "[2] Rules endpoint reachable, read does not require auth"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/rules")
check "GET /api/rules returns 200" "200" "$CODE"

echo "[3] T6 — rule write blocked without an owner session"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/rules" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke-test-rule","type":"MAX_AMOUNT_PER_TX","config":{"maxAmountSui":1}}')
check "POST /api/rules without cookie returns 401" "401" "$CODE"

echo "[4] T6 — login rejects a wrong password"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" -d '{"password":"definitely-wrong"}')
check "POST /api/auth/login with bad password returns 401" "401" "$CODE"

echo "[5] T6 — login succeeds with the real owner password"
CODE=$(curl -s -c "$COOKIE_JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" -d "{\"password\":\"$OWNER_PASSWORD\"}")
check "POST /api/auth/login with correct password returns 200" "200" "$CODE"

echo "[6] T6 — rule write succeeds once authenticated"
CODE=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/rules" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke-test-rule","type":"MAX_AMOUNT_PER_TX","config":{"maxAmountSui":1}}')
check "POST /api/rules with cookie returns 201" "201" "$CODE"

echo "[7] New rule actually shows up in the rule book"
RULES=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/rules")
if echo "$RULES" | grep -q "smoke-test-rule"; then
  check "new rule appears in GET /api/rules" "found" "found"
else
  check "new rule appears in GET /api/rules" "found" "missing"
fi

echo "[8] Over-limit transfer gets BLOCKED, not executed"
RESP=$(curl -s -X POST "$BASE_URL/api/agent/message" \
  -H "Content-Type: application/json" \
  -d '{"message":"send 99999 sui to alice"}')
if echo "$RESP" | grep -q '"status":"BLOCKED"' || echo "$RESP" | grep -q '"BLOCKED"'; then
  check "over-limit transfer blocked" "BLOCKED" "BLOCKED"
else
  echo "  -> response was: $(echo "$RESP" | head -c 150)"
  check "over-limit transfer blocked" "BLOCKED" "NOT-BLOCKED-check-manually"
fi

echo "[9] Idempotency (T5) — same instruction submitted twice quickly"
MSG='{"message":"send 0.001 sui to alice"}'
R1=$(curl -s -X POST "$BASE_URL/api/agent/message" -H "Content-Type: application/json" -d "$MSG")
R2=$(curl -s -X POST "$BASE_URL/api/agent/message" -H "Content-Type: application/json" -d "$MSG")
echo "  R1: $(echo "$R1" | head -c 150)"
echo "  R2: $(echo "$R2" | head -c 150)"
echo "  -> manually confirm these did NOT both result in an EXECUTED on-chain transfer with a fresh tx digest"

echo "[10] Cleanup — log out"
CODE=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/logout")
check "POST /api/auth/logout returns 200" "200" "$CODE"

rm -f "$COOKIE_JAR"
echo ""
echo "== Result: $PASS passed, $FAIL failed =="
echo "(steps 8 and 9 need a manual glance at the printed response either way — http status alone doesn't prove the policy decision was correct)"
