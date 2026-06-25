# Cohort Proposal — 2026-06-25

**Agent run:** scheduled scout, 2026-06-25  
**Branch:** claude/cool-sagan-u54adu  
**Status:** No additions recommended this cycle — watch list below for human review.

---

## Run Constraints This Cycle

The proxy policy governing this remote execution environment blocks outbound connections to:
- `autonomous-trading-bot-production.up.railway.app` (bot API — Medic and Auditor could not run)
- `api.geckoterminal.com` (pool data API)
- `www.coingecko.com`, `defillama.com` (supporting data)

Additionally, **Base Beryl mainnet upgrade** began at 10:00 AM UTC on June 25, 2026, halting network activity. This may explain any gaps in bot trading logs for today. The upgrade introduces the B20 token standard (reduces token creation costs and L2 gas usage). Services expected to resume same day.

---

## Scout Candidates Evaluated

| Token | Network | Why Evaluated | Verdict |
|-------|---------|---------------|---------|
| **Aero** (Dromos Labs) | Base + multi-chain | Merged Aerodrome (AERO) + Velodrome (VELO) into a single unified DEX token | ⏳ NOT LAUNCHED — targeting July 2026 |
| **GEOD** (GEODNET) | Polygon (primary) | Listed on Coinbase June 23, 2026; DePIN, $200K/week on-chain revenue | ❌ No Base L2 liquidity pool confirmed |
| **B20 token** | Base | New token standard from Beryl upgrade | ❌ Not a tradeable token — it's a standard |

No candidates passed all quality filters (liquidity > $100k on Base, 24h vol > $50k, pool age > 3 days, not in registry).

---

## Watch List (for Henry's review)

### 1. Aero — High Priority Watch (July 2026)
- **What:** Dromos Labs merging AERO (Aerodrome) + VELO (Velodrome) into single unified DEX token "AERO" on the new Aero protocol.
- **Migration:** 94.5% of new AERO goes to existing AERO holders, 5.5% to VELO holders. Existing AERO entry in the registry will likely map to the new token post-migration.
- **Action needed:** After July 2026 launch, confirm the AERO contract address in `TOKEN_REGISTRY` still points to the canonical post-merger token. If a new address is issued, a human PR is needed to update it.
- **No registry change needed now** — existing `AERO` entry should survive the merge.

### 2. GEOD (GEODNET) — Low Priority
- **What:** DePIN precision navigation network, 20,000 base stations, $200K/week on-chain revenue, just listed on Coinbase (June 23, 2026).
- **Why not now:** Primary liquidity is on Polygon, not Base. Would need a Base L2 pool with >$100k liquidity before qualifying.
- **Action:** Monitor for Base pool launch. If liquidity emerges on Base post-Beryl upgrade, run a targeted eval.

---

## Medic Status

Bot API unreachable this run (proxy policy). **Cannot confirm health.** Henry should verify:
- Was bot active during Base Beryl upgrade halt today?
- Check Railway logs for any errors during the network pause window.
- Next run with an unblocked proxy should auto-verify via `/api/errors`.

## Auditor Status

Cannot run — requires `/api/trades`, `/api/portfolio`, `/api/patterns`, `/api/adaptive` endpoints, all blocked by proxy.

---

*Written by scheduled agent. All cohort changes require explicit human PR per CLAUDE.md Rule 1.*
