#!/bin/bash
# Veto — API smoke test
# Run this yourself against your dev server or your deployed Vercel URL.
#
# Usage:
#   chmod +x api-test.sh
#   BASE_URL=http://localhost:3000 OWNER_PASSWORD=dev-owner-password ./api-test.sh
#   BASE_URL=https://your-app.vercel.app OWNER_PASSWORD=yourrealpassword ./api-test.sh
#
# Route names verified against the actual Veto codebase:
#   /api/owner/login, /api/owner/logout (NOT /api/auth/... — fix if you renamed)

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
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/owner/login" \
  -H "Content-Type: application/json" -d '{"password":"definitely-wrong"}')
check "POST /api/owner/login with bad password returns 401" "401" "$CODE"

echo "[5] T6 — login succeeds with the real owner password"
CODE=$(curl -s -c "$COOKIE_JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/owner/login" \
  -H "Content-Type: application/json" -d "{\"password\":\"$OWNER_PASSWORD\"}")
check "POST /api/owner/login with correct password returns 200" "200" "$CODE"

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

echo "[8] Over-limit transfer gets BLOCKED by the on-chain vault (T1 + vault cap)"
# Two-step flow: first POST /api/agent/message stages the request,
# then POST /api/agent/confirm executes (or blocks).
RESP=$(curl -s -X POST "$BASE_URL/api/agent/message" \
  -H "Content-Type: application/json" \
  -d '{"message":"send 99999 sui to alice"}')
echo "  message response: $(echo "$RESP" | head -c 200)"
REQ_ID=$(echo "$RESP" | grep -oE '"id":"[^"]+"' | head -1 | grep -oE '[^"]+' | tail -1)
if [ -n "$REQ_ID" ]; then
  CONFIRM_RESP=$(curl -s -X POST "$BASE_URL/api/agent/confirm" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$REQ_ID\",\"decision\":\"confirm\"}")
  echo "  confirm response: $(echo "$CONFIRM_RESP" | head -c 200)"
  if echo "$CONFIRM_RESP" | grep -q '"status":"BLOCKED"'; then
    check "over-limit transfer blocked" "BLOCKED" "BLOCKED"
  else
    check "over-limit transfer blocked" "BLOCKED" "NOT-BLOCKED-check-manually"
  fi
else
  echo "  -> no request id found in /api/agent/message response — check parsing"
  check "over-limit transfer blocked" "BLOCKED" "NO-REQUEST-ID"
fi

echo "[9] Idempotency (T5) — same instruction submitted twice quickly"
# NOTE: this only triggers against requests that reached EXECUTED. Two requests
# that both failed for an unrelated reason (e.g. an empty wallet) are NOT a
# valid test of idempotency. Re-run with a funded wallet to actually exercise it.
MSG='{"message":"send 0.001 sui to alice"}'
R1=$(curl -s -X POST "$BASE_URL/api/agent/message" -H "Content-Type: application/json" -d "$MSG")
R2=$(curl -s -X POST "$BASE_URL/api/agent/message" -H "Content-Type: application/json" -d "$MSG")
echo "  R1: $(echo "$R1" | head -c 150)"
echo "  R2: $(echo "$R2" | head -c 150)"
echo "  -> manually confirm these did NOT both result in an EXECUTED on-chain transfer"

echo "[10] T4 — tamper detection endpoint returns tampered=false with a clean DB"
RULES_RESP=$(curl -s "$BASE_URL/api/rules")
if echo "$RULES_RESP" | grep -q '"tampered":false'; then
  check "tamper detection reports clean" "false" "false"
elif echo "$RULES_RESP" | grep -q '"tampered":true'; then
  check "tamper detection reports clean" "false" "true (DB was tampered with — see GET /api/rules)"
else
  check "tamper detection reports clean" "false" "no-tamper-field"
fi

echo "[11] Cleanup — log out + delete the smoke-test rule"
CODE=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/owner/logout")
check "POST /api/owner/logout returns 200" "200" "$CODE"

# Find and delete the smoke-test rule (requires re-login because we just logged out)
curl -s -c "$COOKIE_JAR" -o /dev/null -X POST "$BASE_URL/api/owner/login" \
  -H "Content-Type: application/json" -d "{\"password\":\"$OWNER_PASSWORD\"}"
SMOKE_RULE_ID=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/rules" | \
  python3 -c "import sys,json;d=json.load(sys.stdin);print(next((r['id'] for r in d['rules'] if r['name']=='smoke-test-rule'),''))" 2>/dev/null)
if [ -n "$SMOKE_RULE_ID" ]; then
  curl -s -b "$COOKIE_JAR" -o /dev/null -X DELETE "$BASE_URL/api/rules/$SMOKE_RULE_ID"
  echo "  cleanup: deleted smoke-test-rule ($SMOKE_RULE_ID)"
fi

rm -f "$COOKIE_JAR"
echo ""
echo "== Result: $PASS passed, $FAIL failed =="
echo "(steps 8 and 9 need a manual glance at the printed response — http status alone doesn't prove the policy decision was correct)"
