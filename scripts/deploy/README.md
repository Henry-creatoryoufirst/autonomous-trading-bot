# NVR Capital — Deploy Workflow

## The Rule

**NEVER push code changes directly to `main`.** Always test on staging first.

Production manages real money. One bad deploy = lost trades + downtime.

## Workflow

```
1. Create feature branch
   git checkout -b feature/my-change

2. Make changes, commit

3. Stage for Railway testing
   ./scripts/deploy/stage.sh "description of changes"
   → Merges to staging branch
   → Railway staging service auto-deploys
   → Waits for healthcheck to pass

4. Watch staging logs in Railway dashboard
   → Verify 2-3 trading cycles complete
   → Confirm no errors in deploy logs

5. Promote to production
   ./scripts/deploy/promote.sh
   → Verifies staging is healthy
   → Merges staging → main
   → Railway production auto-deploys
   → Monitors production healthcheck
   → Provides rollback SHA if it fails

6. Emergency rollback (if needed)
   ./scripts/deploy/rollback.sh
   → Reverts main to previous commit
   → Auto-deploys the rollback
```

## Railway Setup

Two services in the same project:
- **autonomous-trading-bot** (production) → deploys from `main`
- **staging-bot** → deploys from `staging` branch

Staging should have `PAPER_TRADE_MODE=true` to avoid real money trades.

## Environment Variables

Copy all env vars from production to staging, then change:
- `BOT_NAME=staging-bot`
- `PAPER_TRADE_MODE=true`

## What Can Skip Staging

- Documentation changes (README, comments)
- Simulation-only code (`src/simulation/`, `scripts/run-simulation.ts`)
- Website changes (stc-website deploys to Vercel, not Railway)

## What MUST Go Through Staging

- Any change to `agent-v3.2.ts`
- Any change to `src/core/` modules imported by the agent
- Any change to `src/algorithm/` (confluence, indicators, sizing)
- Dockerfile changes
- Package.json dependency changes
