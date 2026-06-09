# Cohort Proposal — 2026-06-09

**Submitted by:** automated scout (claude/cool-sagan-5uwn3u)
**Option B window:** ACTIVE (ends ~2026-06-15 — do NOT merge cohort changes until window closes)
**Status:** PROPOSAL ONLY — no TOKEN_REGISTRY changes made

---

## Why This File Exists

The Scout job triggered (last scout commit was 2026-05-14, 26 days ago — well past the 48h check).
Per CLAUDE.md Rule 1 (Option B cohort lock), auto-discovery cannot modify `COHORT_QUALITY_7` or
`TOKEN_REGISTRY` during the 30-day benchmark window. This file documents what was found instead.

---

## Scout Run Summary — 2026-06-09

### Data Sources Consulted
- GeckoTerminal trending/new pools API (`/api/v2/networks/base/trending_pools` + `new_pools`)
  — **BLOCKED**: environment network policy returns 403 "Host not in allowlist" for all external HTTP
- GeckoTerminal token detail API — same block
- WebSearch: "new tokens Base L2 high volume June 2026", "Base ecosystem token launch 2026",
  "Aerodrome Base trending pool June 2026", "coinbase wrapped new tokens 2026"

**Net result:** Direct GeckoTerminal API access unavailable this run. Metrics below are derived
from WebSearch results; exact liquidity/volume numbers could not be independently verified.

---

## Tokens Evaluated

| Symbol | Notes | Already in Registry? | Qualifies? |
|--------|-------|----------------------|------------|
| VVV (Venice Token) | $10.23M liquidity, $2.17M 24h vol per search | ✅ Yes | N/A |
| AERO | $453M TVL, dominant Base DEX | ✅ Yes | N/A |
| BRETT, TOSHI, DEGEN | Top meme coins by search | ✅ Yes | N/A |
| SEAM | Seamless Protocol, $511M TVL | ✅ Yes | N/A |
| HYDX | Hydrex, Base ecosystem | ✅ Yes | N/A |
| VEIL | Privacy token (zk-SNARKs on Base) | Was reverted 2026-05-16 | ⛔ Not eligible |
| Base governance token | Potential 2026 launch (69% Polymarket) — not yet live | ❌ No | Not yet |
| cbSUI / cbDOT | Coinbase Wrapped variants — not confirmed on Base | ❌ No | Not confirmed |
| HYPE (Hyperliquid) | Native to Hyperliquid L1, no Base deployment found | ❌ No | Wrong chain |

**No new tokens found that pass all filters AND aren't already in TOKEN_REGISTRY.**

The most promising future candidate, if it launches before the next scout window:
- **Base native governance token** — if Coinbase launches it in 2026 as signalled (69% Polymarket
  odds as of search date), it would be a strong Blue Chip candidate with guaranteed deep liquidity.
  Suggested params when it launches: `sector: BLUE_CHIP, riskLevel: LOW, minTradeUSD: 25`.

---

## Scout Outcome

🔍 **No qualifying new tokens found this scan — standards maintained.**

Post-Option-B-window (after ~2026-06-15), Henry should:
1. Re-run scout with GeckoTerminal API accessible (env network policy relaxed, or via Railway exec)
2. Evaluate Base governance token if launched
3. Check VEIL re-admission after assessing current liquidity / project health

---

## API Access Note

The scout's GeckoTerminal API calls are blocked by this execution environment's network policy.
A full quality-gate evaluation (liquidity >$100k, vol >$50k, pool age >3 days) was not possible.
To enable proper scouting in future automated runs, the execution environment needs outbound HTTP
access to `api.geckoterminal.com` and `autonomous-trading-bot-production.up.railway.app`.
