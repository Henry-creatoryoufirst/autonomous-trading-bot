#!/bin/bash
# ============================================================================
# NVR Capital — Emergency Rollback
#
# Usage: ./scripts/deploy/rollback.sh [commit_sha]
#
# If no SHA provided, rolls back to the previous commit on main.
# ============================================================================

set -e

PRODUCTION_URL="https://autonomous-trading-bot-production.up.railway.app"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${RED}═══════════════════════════════════════════════════${NC}"
echo -e "${RED}  NVR Capital — EMERGENCY ROLLBACK${NC}"
echo -e "${RED}═══════════════════════════════════════════════════${NC}"
echo ""

TARGET_SHA="${1:-}"
CURRENT_BRANCH=$(git branch --show-current)

if [ "$CURRENT_BRANCH" != "main" ]; then
  echo -e "${CYAN}Switching to main...${NC}"
  git checkout main
  git pull origin main
fi

if [ -z "$TARGET_SHA" ]; then
  # Roll back one commit
  TARGET_SHA=$(git rev-parse HEAD~1)
  echo -e "Rolling back to previous commit: ${YELLOW}${TARGET_SHA}${NC}"
else
  echo -e "Rolling back to specified commit: ${YELLOW}${TARGET_SHA}${NC}"
fi

# Show what we're rolling back FROM and TO
echo ""
echo -e "${RED}FROM:${NC} $(git log --oneline -1 HEAD)"
echo -e "${GREEN}TO:${NC}   $(git log --oneline -1 $TARGET_SHA)"
echo ""

read -p "Proceed with rollback? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

git reset --hard "$TARGET_SHA"
git push --force-with-lease

echo ""
echo -e "${YELLOW}Railway is redeploying. Monitoring...${NC}"

# Wait for healthy
ELAPSED=0
while [ $ELAPSED -lt 360 ]; do
  RESPONSE=$(curl -s --max-time 10 "${PRODUCTION_URL}/health" 2>/dev/null || echo "")
  if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    UPTIME=$(echo "$RESPONSE" | grep -o '"uptimeSec":[0-9]*' | cut -d: -f2)
    if [ -n "$UPTIME" ] && [ "$UPTIME" -lt 120 ]; then
      echo ""
      echo -e "${GREEN}✅ ROLLBACK SUCCESSFUL — Production is healthy${NC}"
      exit 0
    fi
  fi
  printf "\r  Waiting... %ds" $ELAPSED
  sleep 15
  ELAPSED=$((ELAPSED + 15))
done

echo ""
echo -e "${RED}❌ Rollback deploy also failed. Manual intervention needed.${NC}"
echo -e "Check Railway dashboard: https://railway.app"
exit 1
