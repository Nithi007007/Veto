#!/bin/bash
# Veto — Move contract deployment script
# Requires Sui CLI: https://docs.sui.io/guides/developer/getting-started/sui-install
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# After deployment, copy the output values to backend/.env:
#   PACKAGE_ID, VAULT_OBJECT_ID, OWNER_CAP_ID

set -e

echo "=== Veto Move Contract Deployment ==="
echo ""

# Check sui CLI is installed
if ! command -v sui &> /dev/null; then
  echo "❌ Sui CLI not found. Install it first:"
  echo "   https://docs.sui.io/guides/developer/getting-started/sui-install"
  exit 1
fi

# Check active address
ACTIVE_ADDR=$(sui client active-address 2>/dev/null || echo "")
if [ -z "$ACTIVE_ADDR" ]; then
  echo "❌ No active Sui client address. Run 'sui client' to set up."
  exit 1
fi
echo "✓ Active address: $ACTIVE_ADDR"

# Check network
NETWORK=$(sui client active-env 2>/dev/null || echo "testnet")
echo "✓ Network: $NETWORK"
echo ""

# Fund check
BALANCE=$(sui client gas 2>/dev/null | head -5 || echo "")
if echo "$BALANCE" | grep -q "No gas"; then
  echo "⚠️  No gas found. Request testnet SUI from faucet:"
  echo "   curl -X POST https://faucet.testnet.sui.io/gas -H 'Content-Type: application/json' -d '{\"recipient\":\"$ACTIVE_ADDR\"}'"
  echo ""
  echo "   Or visit: https://faucet.testnet.sui.io"
  exit 1
fi
echo "✓ Gas available"

# Build
echo ""
echo "Building Move module..."
sui move build --path .

# Publish
echo ""
echo "Publishing to $NETWORK..."
PUBLISH_OUTPUT=$(sui client publish --gas-budget 100000000 . 2>&1)

echo "$PUBLISH_OUTPUT"

# Extract IDs from output
PACKAGE_ID=$(echo "$PUBLISH_OUTPUT" | grep "PackageID" | head -1 | grep -oE '0x[a-f0-9]+' | head -1 || echo "")
VAULT_ID=$(echo "$PUBLISH_OUTPUT" | grep -A1 "Vault" | grep -oE '0x[a-f0-9]+' | head -1 || echo "")
OWNER_CAP_ID=$(echo "$PUBLISH_OUTPUT" | grep -A1 "OwnerCap" | grep -oE '0x[a-f0-9]+' | head -1 || echo "")

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Add these to your backend/.env:"
echo "  PACKAGE_ID=$PACKAGE_ID"
echo "  VAULT_OBJECT_ID=$VAULT_ID"
echo "  OWNER_CAP_ID=$OWNER_CAP_ID"
echo ""
echo "And to frontend/.env.local:"
echo "  NEXT_PUBLIC_PACKAGE_ID=$PACKAGE_ID"
