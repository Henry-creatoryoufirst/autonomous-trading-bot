#!/bin/bash
# ============================================================================
# NVR Capital — Promote Staging to Production
#
# Usage: ./scripts/deploy/promote.sh
#
# What it does:
#   1. Verifies staging is currently healthy
#   2. Verifies production is currently healthy (so we have a known-good state)
#   3. Merges staging → main
#   4. Pushes main → Railway production auto-deploys
#   5. Monitors production healthcheck
#   6. If production fails, provides rollback command
# ============================================================================

set -e

STAGING_URL="${STAGING_BOT_URL:-https://autonomous-trading-bot-staging.up.railway.app}"
PRODUCTION_URL="https://autonomous-trading-bot-production.up.railway.app"
HEALTHCHECK_TIMEOUT=360
HEALTHCHECK_INTERVAL=15

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  NVR Capital — Promote Staging → Production${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""

# Step 1: Verify staging is healthy
echo -e "${CYAN}Step 1: Verifying staging health...${NC}"
STAGING_HEALTH=$(curl -s --max-time 10 "${STAGING_URL}/health" 2>/dev/null || echo "")
if ! echo "$STAGING_HEALTH" | grep -q '"status":"ok"'; then
  echo -e "${RED}ERROR: Staging is NOT healthy. Cannot promote.${NC}"
  echo "  Fix staging first, then try again."
  exit 1
fi
echo -e "  ${GREEN}✅ Staging healthy${NC}"

# Step 2: Verify production is healthy (know our rollback target)
echo -e "${CYAN}Step 2: Verifying current production health...${NC}"
PROD_HEALTH=$(curl -s --max-time 10 "${PRODUCTION_URL}/health" 2>/dev/null || echo "")
PROD_VERSION=""
if echo "$PROD_HEALTH" | grep -q '"status":"ok"'; then
  PROD_VERSION=$(echo "$PROD_HEALTH" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
  echo -e "  ${GREEN}✅ Production healthy (v${PROD_VERSION})${NC}"
else
  echo -e "  ${YELLOW}⚠️ Production is not responding — promoting anyway${NC}"
fi

# Step 3: Record rollback point
ROLLBACK_SHA=$(git rev-parse main)
echo ""
echo -e "${YELLOW}Rollback SHA (if needed): ${ROLLBACK_SHA}${NC}"
echo -e "${YELLOW}Rollback command: git checkout main && git reset --hard ${ROLLBACK_SHA} && git push --force-with-lease${NC}"
echo ""

# Step 4: Confirm
read -p "Promote staging → production? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# Step 5: Merge staging → main
echo ""
echo -e "${CYAN}Step 3: Merging staging → main...${NC}"
CURRENT_BRANCH=$(git branch --show-current)
git checkout main
git pull origin main
git merge staging --no-edit -m "Promote staging to production (verified healthy)"
git push origin main

echo ""
echo -e "${YELLOW}Railway production is deploying. Monitoring healthcheck...${NC}"
echo ""

# Step 6: Monitor production healthcheck
ELAPSED=0
while [ $ELAPSED -lt $HEALTHCHECK_TIMEOUT ]; do
  RESPONSE=$(curl -s --max-time 10 "${PRODUCTION_URL}/health" 2>/dev/null || echo "")

  if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    NEW_VERSION=$(echo "$RESPONSE" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
    UPTIME=$(echo "$RESPONSE" | grep -o '"uptimeSec":[0-9]*' | cut -d: -f2)

    # Check if it's the new deploy (uptime < 120s means it just restarted)
    if [ -n "$UPTIME" ] && [ "$UPTIME" -lt 120 ]; then
      echo ""
      echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
      echo -e "${GREEN}  ✅ PRODUCTION DEPLOYED SUCCESSFULLY${NC}"
      echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
      echo -e "  Version:  ${NEW_VERSION}"
      echo -e "  Uptime:   ${UPTIME}s (fresh deploy)"
      echo -e "  URL:      ${PRODUCTION_URL}"
      echo ""

      if [ "$CURRENT_BRANCH" != "main" ]; then
        git checkout "$CURRENT_BRANCH"
      fi
      exit 0
    fi
  fi

  printf "\r  Waiting... %ds / %ds" $ELAPSED $HEALTHCHECK_TIMEOUT
  sleep $HEALTHCHECK_INTERVAL
  ELAPSED=$((ELAPSED + HEALTHCHECK_INTERVAL))
done

echo ""
echo -e "${RED}═══════════════════════════════════════════════════${NC}"
echo -e "${RED}  ❌ PRODUCTION DEPLOY FAILED${NC}"
echo -e "${RED}═══════════════════════════════════════════════════${NC}"
echo -e ""
echo -e "  ${RED}ROLLBACK IMMEDIATELY:${NC}"
echo -e "  git checkout main"
echo -e "  git reset --hard ${ROLLBACK_SHA}"
echo -e "  git push --force-with-lease"
echo ""

if [ "$CURRENT_BRANCH" != "main" ]; then
  git checkout "$CURRENT_BRANCH"
fi
exit 1
