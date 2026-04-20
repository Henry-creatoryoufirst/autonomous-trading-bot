#!/bin/bash
# ============================================================================
# NVR Capital — Stage Changes for Railway Testing
#
# Usage: ./scripts/deploy/stage.sh [commit message]
#
# What it does:
#   1. Ensures you're on a feature branch (not main)
#   2. Merges your changes into the staging branch
#   3. Pushes staging → Railway staging service auto-deploys
#   4. Waits for healthcheck to pass
#   5. Reports status
#
# After staging is healthy, run: ./scripts/deploy/promote.sh
# ============================================================================

set -e

STAGING_URL="${STAGING_BOT_URL:-https://autonomous-trading-bot-staging.up.railway.app}"
PRODUCTION_URL="https://autonomous-trading-bot-production.up.railway.app"
HEALTHCHECK_TIMEOUT=360  # 6 minutes max
HEALTHCHECK_INTERVAL=15  # Check every 15 seconds

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  NVR Capital — Stage to Railway${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)

if [ "$CURRENT_BRANCH" = "main" ]; then
  echo -e "${RED}ERROR: You're on main. Create a feature branch first:${NC}"
  echo "  git checkout -b feature/my-change"
  exit 1
fi

if [ "$CURRENT_BRANCH" = "staging" ]; then
  echo -e "${YELLOW}Already on staging. Pushing directly...${NC}"
else
  echo -e "Current branch: ${GREEN}${CURRENT_BRANCH}${NC}"
  echo ""

  # Check for uncommitted changes
  if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}Uncommitted changes detected. Committing...${NC}"
    MSG="${1:-WIP: staging changes from $CURRENT_BRANCH}"
    git add -A
    git commit -m "$MSG"
  fi

  # Merge into staging
  echo -e "${CYAN}Merging ${CURRENT_BRANCH} → staging...${NC}"
  git checkout staging
  git merge "$CURRENT_BRANCH" --no-edit
fi

# Push staging
echo -e "${CYAN}Pushing staging to Railway...${NC}"
git push origin staging

echo ""
echo -e "${YELLOW}Railway staging is deploying. Waiting for healthcheck...${NC}"
echo -e "${YELLOW}(Timeout: ${HEALTHCHECK_TIMEOUT}s)${NC}"
echo ""

# Wait for healthcheck
ELAPSED=0
while [ $ELAPSED -lt $HEALTHCHECK_TIMEOUT ]; do
  RESPONSE=$(curl -s --max-time 10 "${STAGING_URL}/health" 2>/dev/null || echo "")

  if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    VERSION=$(echo "$RESPONSE" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
    UPTIME=$(echo "$RESPONSE" | grep -o '"uptimeSec":[0-9]*' | cut -d: -f2)
    TRADES=$(echo "$RESPONSE" | grep -o '"totalTradesExecuted":[0-9]*' | cut -d: -f2)

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ STAGING HEALTHY${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "  Version:  ${VERSION}"
    echo -e "  Uptime:   ${UPTIME}s"
    echo -e "  Trades:   ${TRADES}"
    echo -e "  URL:      ${STAGING_URL}"
    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo -e "  1. Watch staging logs for 5-10 minutes"
    echo -e "  2. Verify trading cycles complete without errors"
    echo -e "  3. Run: ${GREEN}./scripts/deploy/promote.sh${NC} to push to production"
    echo ""

    # Switch back to feature branch
    if [ "$CURRENT_BRANCH" != "staging" ]; then
      git checkout "$CURRENT_BRANCH"
    fi
    exit 0
  fi

  # Show progress
  printf "\r  Waiting... %ds / %ds" $ELAPSED $HEALTHCHECK_TIMEOUT
  sleep $HEALTHCHECK_INTERVAL
  ELAPSED=$((ELAPSED + HEALTHCHECK_INTERVAL))
done

echo ""
echo -e "${RED}═══════════════════════════════════════════════════${NC}"
echo -e "${RED}  ❌ STAGING HEALTHCHECK FAILED${NC}"
echo -e "${RED}═══════════════════════════════════════════════════${NC}"
echo -e "  Bot did not respond within ${HEALTHCHECK_TIMEOUT}s"
echo -e "  Check Railway staging logs for errors"
echo -e "  ${RED}DO NOT promote to production${NC}"
echo ""

# Switch back
if [ "$CURRENT_BRANCH" != "staging" ]; then
  git checkout "$CURRENT_BRANCH"
fi
exit 1
