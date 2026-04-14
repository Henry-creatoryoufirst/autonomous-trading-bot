#!/bin/bash
# ============================================================================
# NVR Capital — Signal Service Railway Setup
#
# Run ONCE after the Signal Service has been created in Railway.
# Prerequisites:
#   1. railway login  (authenticate first)
#   2. Signal Service already exists as a Railway service in this project
#
# What this does:
#   1. Sets the start command to: npx tsx signal-service.ts
#   2. Sets required env vars on the Signal Service
#   3. Prints the Signal Service URL so you can set SIGNAL_SERVICE_URL on bots
#
# Usage:
#   railway login                     # authenticate once
#   ./scripts/setup-signal-service.sh
# ============================================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}══════════════════════════════════════════════${NC}"
echo -e "${CYAN}  NVR Signal Service — Railway Setup          ${NC}"
echo -e "${CYAN}══════════════════════════════════════════════${NC}"
echo ""

# ── Verify railway auth ────────────────────────────────────────────────────
if ! railway whoami &>/dev/null; then
  echo -e "${RED}ERROR: Not logged in. Run: railway login${NC}"
  exit 1
fi

echo -e "  ${GREEN}✅ Railway authenticated${NC}"
echo ""

# ── Prompt for project + service ──────────────────────────────────────────
echo -e "${YELLOW}Enter the Railway Project ID (from CLAUDE.md or Railway dashboard):${NC}"
read -p "  Project ID: " PROJECT_ID

echo ""
echo -e "${YELLOW}Enter the Signal Service ID (from Railway dashboard → Signal Service → Settings):${NC}"
read -p "  Service ID: " SERVICE_ID

echo ""
echo -e "${YELLOW}Enter your Telegram Bot Token (same as in your other bots):${NC}"
read -p "  TELEGRAM_BOT_TOKEN: " TELEGRAM_TOKEN

echo ""
echo -e "${YELLOW}CMC API Key (same as in other bots, or leave blank):${NC}"
read -p "  CMC_API_KEY: " CMC_KEY

echo ""

# ── Set variables on Signal Service ───────────────────────────────────────
echo -e "${CYAN}Setting env vars on Signal Service...${NC}"

railway variables set \
  --project-id "$PROJECT_ID" \
  --service-id "$SERVICE_ID" \
  TELEGRAM_BOT_TOKEN="$TELEGRAM_TOKEN" \
  TELEGRAM_CHAT_ID="7267993651" \
  CMC_API_KEY="$CMC_KEY" \
  BOT_INSTANCE_NAME="signal-service" \
  NODE_ENV="production"

echo -e "  ${GREEN}✅ Env vars set${NC}"
echo ""

# ── Print next steps ───────────────────────────────────────────────────────
echo -e "${CYAN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${CYAN}══════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Remaining manual steps in Railway dashboard:${NC}"
echo ""
echo -e "  1. ${CYAN}Signal Service → Settings → Start Command:${NC}"
echo -e "     ${GREEN}npx tsx signal-service.ts${NC}"
echo ""
echo -e "  2. ${CYAN}After it deploys, copy the service URL, then:${NC}"
echo -e "     Run: ${GREEN}./scripts/set-signal-url.sh <URL>${NC}"
echo ""
echo -e "  Or manually add to each bot service:"
echo -e "     ${GREEN}SIGNAL_SERVICE_URL=https://your-signal-service.up.railway.app${NC}"
echo ""
