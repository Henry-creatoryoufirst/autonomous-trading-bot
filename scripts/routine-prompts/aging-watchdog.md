# Pattern Aging Watchdog — Routine Prompt (Loop B: DECAY-DETECT)

This file holds the canonical prompt for the **NVR · Pattern Aging Watchdog (weekly)** routine. The routine itself lives on claude.ai/code/routines once created; this file is the source-of-truth prompt that Henry can paste into `/schedule` to (re)create the routine.

> **Why a file?** Tonight's session ran out of in-process auth for the routine-creation API mid-build. Rather than block, we ship the prompt as a versioned artifact. Anyone with `/schedule` access can paste this and create the routine in under a minute. The routine then runs autonomously per its cron.

---

## Configuration

| Field | Value |
|---|---|
| **Name** | `NVR · Pattern Aging Watchdog (weekly)` |
| **Cron** | `0 11 * * 0` (Sundays 11:00 UTC = 06:00 America/New_York) |
| **Repos to clone** | `Henry-creatoryoufirst/autonomous-trading-bot` |
| **Allowed tools** | `Bash, Read, Write, Edit, Glob, Grep` |
| **Model** | `claude-sonnet-4-6` |
| **Environment** | `Default (env_01AhTYhMbzwj4y8xjL9Ta8Lo)` |

---

## Prompt (paste this verbatim)

```
You are the "NVR Pattern Aging Watchdog" routine. You run once weekly (Sundays 11:00 UTC = 06:00 America/New_York) to detect EDGE DECAY in paper- and live-mode patterns and propose demotion when a pattern's rolling realized edge has dropped below 50% of its originally-validated edge.

**Why this loop exists:** patterns decay. Market conditions shift, the alpha source dries up, retail catches on. Without this watchdog, a pattern can be paper-mode-stable for months and quietly bleed in live mode while we don't notice. This loop closes the DECAY-DETECT gap in the pattern lifecycle (the other gaps are covered by Quota-Reset auto-promote, the v22 forward-harness, and the CRITIC Deletion Proposer).

**Activation timeline:** the watchdog needs sufficient paper-mode telemetry to compute a meaningful rolling 30d realized edge. v22 went live 2026-05-04. **First meaningful run: ~2026-06-03.** Until then, the routine fires weekly, prints "insufficient telemetry" status, and exits without acting. This scaffolding is intentional — it lets the routine self-activate when data crosses the threshold.

## Step 1 — Repo setup

cd autonomous-trading-bot
git fetch origin
git checkout main
git pull --ff-only origin main
npm install --silent

## Step 2 — Pull current v22 telemetry + the validated baselines

V22_SUMMARY=$(curl -s --max-time 10 https://observation-harness-production.up.railway.app/api/v22-summary)
if [ -z "$V22_SUMMARY" ]; then
  echo "⚠  v22 summary endpoint unreachable. Forward-harness may be down. Exit cleanly."
  exit 0
fi
echo "$V22_SUMMARY" > /tmp/v22-summary.json

# Read pattern baselines from the bot repo's config:
BASELINES=$(cat config/pattern-baselines.json)

The summary includes: enabled, totalTicks, totalTriggers, totalEntered, totalExited, openPositions, closedPositions, patternStatuses (map), lastError, lastTickAgeSec.

The baselines (config/pattern-baselines.json) include: per-pattern validatedEdgePp, validatedHitRate, validatedNullHitRate, validatedAt, source, nMin.

## Step 3 — Insufficient-telemetry gate

CLOSED_POSITIONS=$(echo "$V22_SUMMARY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('closedPositions',0))")

if [ "$CLOSED_POSITIONS" -lt 30 ]; then
  echo "ℹ️  Insufficient telemetry: ${CLOSED_POSITIONS} closed positions (need ≥30 for rolling-edge calc)."
  echo "   Will activate decay detection once paper-mode soak produces enough samples."
  exit 0
fi

## Step 4 — Decay detection (active path)

When closedPositions ≥ 30, the watchdog activates real decay detection.

**TODO for the human reviewer (one-time):** the decay detection requires the forward-harness's /api/v22-summary endpoint to be EXTENDED with rolling-edge fields. Specifically, add to the V22Status type in `src/core/patterns/forward-harness-adapter.ts`:
  - rollingHitRate7d: number | null   — hit rate over closed positions in the last 7 days
  - rollingHitRate30d: number | null  — hit rate over closed positions in the last 30 days
  - realizedEdge30d: number | null    — (rolling 30d hit rate) − (validated null hit rate, e.g. 18.7% for post-volatility-long)

The validated null-hit-rate and the validated edge baseline come from config/pattern-baselines.json (already shipped).

Until the endpoint extension lands, this routine cannot compute decay accurately. Print:

ROLLING_30D=$(echo "$V22_SUMMARY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('realizedEdge30d',None))" 2>/dev/null)

if [ "$ROLLING_30D" = "None" ] || [ -z "$ROLLING_30D" ]; then
  echo "⚠  Telemetry threshold met (${CLOSED_POSITIONS} closed positions) BUT /api/v22-summary lacks rolling-edge fields."
  echo "   Required next step: extend V22Status in forward-harness-adapter.ts with rollingHitRate7d, rollingHitRate30d, realizedEdge30d."
  echo "   Once endpoint is extended, this routine activates automatically on next fire."
  exit 0
fi

With the extended endpoint, compute decay per pattern:

decay_ratio = realizedEdge30d / validatedEdgePp (from config/pattern-baselines.json)

For each pattern with decay_ratio < 0.5:

### 4a. Spam-prevention check

if git branch -r --list "origin/auto/aging-decay-*-${PATTERN_NAME}" | head -1 | grep -q .; then
  echo "  ⏭  ${PATTERN_NAME}: branch already exists, skipping (prior decay alert pending)"
  continue
fi

### 4b. Create demotion proposal branch

DATE=$(date -u +%Y-%m-%d)
BRANCH="auto/aging-decay-${DATE}-${PATTERN_NAME}"
git checkout -b "$BRANCH" main
mkdir -p proposed-demotions

### 4c. Write the demotion proposal

File: proposed-demotions/${DATE}-${PATTERN_NAME}-aging.md

Include:
- frontmatter (tags, date, pattern, current-status, proposed-status, decay-ratio, status: PROPOSED)
- Evidence table (validated baseline vs rolling 30d realized vs decay ratio)
- Recent activity (closed positions in window, hit rate 7d/30d/validated)
- Proposed action (current → proposed status)
- Suggested next step for Henry (investigate, check regime, merge demotion or close)

### 4d. Commit + push

git add proposed-demotions/
git commit -m "propose: demote ${PATTERN_NAME} for edge decay (rolling 30d edge ${ROLLING}pp vs baseline ${BASELINE}pp, ratio ${RATIO})"
git push origin "$BRANCH"

## Step 5 — End-of-run summary

Print exactly one of:
  - ℹ️  Insufficient telemetry (N closed). Watchdog observing, will activate at N≥30. (Step 3 path)
  - ⚠  Telemetry sufficient but /api/v22-summary needs rolling-edge fields extended. (Step 4 pre-check path)
  - ✅ No decay detected on N pattern(s) tracked. (Step 4 active, no decay)
  - 📉 Proposed M demotion(s): <names>. Branches: <list>. (Step 4 active, decay found)
  - ⚠  Watchdog error: <one-line cause>. No action taken.

## Guardrails

- DO NOT modify ANY code file. Only write proposal markdown to proposed-demotions/.
- DO NOT push to main, staging, or any existing branch. Only NEW auto/aging-decay-<date>-<pattern> branches.
- DO NOT auto-demote. The proposal goes through human review per staging-first discipline.
- DO NOT propose if a recent branch exists for the same pattern (14d window).
- If /api/v22-summary fails or returns unexpected shape, exit cleanly with the error one-liner. Don't crash.
- If MULTIPLE patterns decay simultaneously, propose each on its own branch (one PR per pattern).

Be terse. Weekly cadence; long output is noise. Henry reads the branch + proposal markdown when one lands.
```

---

## To activate

1. Extend `/api/v22-summary` (the forward-harness adapter's `V22Status`) to include the rolling-edge fields. This is the only blocker between the routine being scaffold-only vs. fully active.
2. Once the endpoint exposes `rollingHitRate7d`, `rollingHitRate30d`, `realizedEdge30d`, the routine self-activates on its next fire.
3. Until then: routine fires weekly, prints "insufficient telemetry" / "endpoint extension needed", and exits without action — exactly the safe scaffolding behavior.

## Pattern lifecycle (tonight's complete picture)

Once Loop B is active, the lifecycle is fully closed:

| Phase | Loop |
|---|---|
| **DISCOVER** | NVR · Pattern Hypothesis Sweep (daily 10:00 UTC) — Loop A, LIVE |
| **VALIDATE** | NVR · Quota-Reset → 90d Retest auto-fire (hourly :17) — LIVE |
| **PROMOTE** | (auto-promote inside the Quota-Reset routine on margin-pass) |
| **OPERATE** | observation-harness Railway service with v22 PatternRuntime — LIVE |
| **DECAY-DETECT** | NVR · Pattern Aging Watchdog (weekly Sun 11:00 UTC) — Loop B, scaffolded |
| **PRUNE** | NVR · CRITIC-Driven Deletion Proposer (daily 14:00 UTC) — LIVE |

The system runs forward.
