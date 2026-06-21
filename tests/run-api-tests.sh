#!/bin/bash
# Comprehensive API Test Script for Veto — Policy Gate for AI Agents on Sui
# Run all feature tests to verify deployment readiness

BASE_URL="http://localhost:3000/api"
PASS_COUNT=0
FAIL_COUNT=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}VETO — Comprehensive API Test Suite${NC}"
echo -e "${CYAN}Deploy Verification — $(date)${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Helper function for test assertions
test_endpoint() {
  local name=$1
  local method=$2
  local endpoint=$3
  local body=$4
  local expected_status=$5
  local auth_token=$6
  
  echo -e "${YELLOW}Testing: ${name}${NC}"
  
  if [ -z "$body" ]; then
    if [ -z "$auth_token" ]; then
      response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
        -H "Content-Type: application/json")
    else
      response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $auth_token")
    fi
  else
    if [ -z "$auth_token" ]; then
      response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
        -H "Content-Type: application/json" \
        -d "$body")
    else
      response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $auth_token" \
        -d "$body")
    fi
  fi
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" -eq "$expected_status" ]; then
    echo -e "${GREEN}✓ PASS${NC} — Status $http_code"
    ((PASS_COUNT++))
  else
    echo -e "${RED}✗ FAIL${NC} — Expected $expected_status, got $http_code"
    echo "  Response: $body"
    ((FAIL_COUNT++))
  fi
  echo ""
}

# ─────────────────────────────────────────────────────────
# TEST SUITE 1: Core Features
# ─────────────────────────────────────────────────────────
echo -e "${CYAN}═══ TEST SUITE 1: CORE FEATURES ═══${NC}"
echo ""

# 1.1 Seed Endpoint
test_endpoint "Seed Default Rules" "POST" "/seed" "" 200

# 1.2 Get Rules
test_endpoint "Get All Rules" "GET" "/rules" "" 200

# 1.3 Get Wallet
test_endpoint "Get Agent Wallet" "GET" "/wallet" "" 200

# 1.4 Get Requests
test_endpoint "Get Request History" "GET" "/requests?limit=50" "" 200

# 1.5 Get Aliases
test_endpoint "Get Address Aliases" "GET" "/aliases" "" 200

echo -e "${CYAN}═══ TEST SUITE 2: AUTHENTICATION ═══${NC}"
echo ""

# 2.1 Invalid Login
test_endpoint "Reject Invalid Password" "POST" "/owner/login" \
  '{"password":"wrong"}' 401

# 2.2 Valid Login
OWNER_RESPONSE=$(curl -s -X POST "$BASE_URL/owner/login" \
  -H "Content-Type: application/json" \
  -d '{"password":"dev-owner-password"}')
AUTH_TOKEN=$(echo "$OWNER_RESPONSE" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)

echo -e "${YELLOW}Testing: Valid Owner Login${NC}"
if [ -n "$AUTH_TOKEN" ] || [ "$AUTH_TOKEN" != "" ]; then
  echo -e "${GREEN}✓ PASS${NC} — Authentication token obtained"
  ((PASS_COUNT++))
else
  echo -e "${RED}✗ FAIL${NC} — No authentication token received"
  ((FAIL_COUNT++))
fi
echo ""

# 2.3 Owner Status (without auth should fail)
test_endpoint "Reject Request Without Auth" "GET" "/owner/status" "" 401

echo -e "${CYAN}═══ TEST SUITE 3: AGENT MESSAGE PROCESSING ═══${NC}"
echo ""

# 3.1 Parse Valid Message
MSG_RESPONSE=$(curl -s -X POST "$BASE_URL/agent/message" \
  -H "Content-Type: application/json" \
  -d '{"message":"send 1 sui to alice"}')
REQUEST_ID=$(echo "$MSG_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
MSG_STATUS=$(echo "$MSG_RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)

echo -e "${YELLOW}Testing: Parse Natural Language Message${NC}"
if [ "$MSG_STATUS" = "AWAITING_CONFIRMATION" ]; then
  echo -e "${GREEN}✓ PASS${NC} — Message parsed to AWAITING_CONFIRMATION"
  echo "  Request ID: $REQUEST_ID"
  ((PASS_COUNT++))
else
  echo -e "${RED}✗ FAIL${NC} — Expected AWAITING_CONFIRMATION, got $MSG_STATUS"
  ((FAIL_COUNT++))
fi
echo ""

# 3.2 Reject Invalid Message
test_endpoint "Reject Empty Message" "POST" "/agent/message" \
  '{"message":""}' 400

# 3.3 Reject Invalid JSON
test_endpoint "Reject Invalid JSON" "POST" "/agent/message" \
  'invalid json' 400

echo -e "${CYAN}═══ TEST SUITE 4: RULE MANAGEMENT ═══${NC}"
echo ""

# 4.1 Create Rule (requires auth)
CREATE_RULE='{"name":"Integration Test Rule","type":"MAX_AMOUNT_PER_TX","config":{"maxAmountSui":5},"enabled":true}'
test_endpoint "Create Rule (No Auth)" "POST" "/rules" "$CREATE_RULE" 401

# 4.2 Without showing the auth token, we test with curl
test_endpoint "Get Specific Rule" "GET" "/rules/test-id" "" 404

echo -e "${CYAN}═══ TEST SUITE 5: ERROR HANDLING ═══${NC}"
echo ""

# 5.1 Non-existent endpoints
test_endpoint "404 on Invalid Route" "GET" "/invalid-route" "" 404

# 5.2 Invalid HTTP method on seed
test_endpoint "Invalid Method Handling" "GET" "/seed" "" 405

# 5.3 Malformed JSON
test_endpoint "Malformed JSON Rejection" "POST" "/agent/message" \
  '{invalid json}' 400

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}TEST SUMMARY${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
PASS_RATE=$(echo "scale=1; ($PASS_COUNT / $TOTAL) * 100" | bc)

echo -e "Total Tests:    $TOTAL"
echo -e "${GREEN}Passed:         $PASS_COUNT${NC}"
echo -e "${RED}Failed:         $FAIL_COUNT${NC}"
echo -e "Pass Rate:      ${PASS_RATE}%"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "${GREEN}✓ ALL TESTS PASSED — System is ready for deployment${NC}"
  exit 0
else
  echo -e "${RED}✗ SOME TESTS FAILED — Fix issues before deployment${NC}"
  exit 1
fi
