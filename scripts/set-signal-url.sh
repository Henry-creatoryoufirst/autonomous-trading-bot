#!/bin/bash
# ============================================================================
# NVR Capital — Set SIGNAL_SERVICE_URL on all bot services
#
# Run after the Signal Service is deployed and you have its URL.
#
# Usage:
#   ./scripts/set-signal-url.sh https://nvr-signal.up.railway.app
# ============================================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SIGNAL_URL="${1:-}"

if [ -z "$SIGNAL_URL" ]; then
  echo -e "${RED}Usage: ./scripts/set-signal-url.sh <signal-service-url>${NC}"
  echo "  Example: ./scripts/set-signal-url.sh https://nvr-signal.up.railway.app"
  exit 1
fi

if ! railway whoami &>/dev/null; then
  echo -e "${RED}ERROR: Not logged in. Run: railway login${NC}"
  exit 1
fi

echo -e "${CYAN}══════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Setting SIGNAL_SERVICE_URL on all bots      ${NC}"
echo -e "${CYAN}══════════════════════════════════════════════${NC}"
echo -e "  URL: ${GREEN}${SIGNAL_URL}${NC}"
echo ""

echo -e "${YELLOW}Enter the Railway Project ID:${NC}"
read -p "  Project ID: " PROJECT_ID

echo ""
echo -e "${YELLOW}Paste your bot Service IDs (one per line, empty line to finish):${NC}"
echo -e "  ${CYAN}(Find them: Railway dashboard → each service → Settings → Service ID)${NC}"
echo ""

BOT_SERVICES=()
while true; do
  read -p "  Service ID: " SVC_ID
  [ -z "$SVC_ID" ] && break
  BOT_SERVICES+=("$SVC_ID")
done

echo ""
echo -e "${CYAN}Setting SIGNAL_SERVICE_URL on ${#BOT_SERVICES[@]} bot service(s)...${NC}"

for SVC_ID in "${BOT_SERVICES[@]}"; do
  echo -n "  Service $SVC_ID ... "
  railway variables set \
    --project-id "$PROJECT_ID" \
    --service-id "$SVC_ID" \
    SIGNAL_SERVICE_URL="$SIGNAL_URL"
  echo -e "${GREEN}✅${NC}"
done

echo ""
echo -e "${GREEN}Done. Bots will pick up SIGNAL_SERVICE_URL on next redeploy.${NC}"
echo ""
echo -e "  Verify fleet is online:"
echo -e "  ${CYAN}curl ${SIGNAL_URL}/fleet${NC}"
echo ""
