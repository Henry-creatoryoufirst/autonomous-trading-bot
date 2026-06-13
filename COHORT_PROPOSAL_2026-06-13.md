# Scout Cohort Proposal — 2026-06-13

**Run:** #35 (hourly agent)  
**Scout status:** Ran (last scout was 2026-05-14, 30 days ago — well past 48h threshold)  
**Registry action:** NONE — Option B window active until ~2026-06-15 (CLAUDE.md Rule 1)  
**Next action:** Henry may merge to TOKEN_REGISTRY after 2026-06-15 window close if candidates pass review

---

## Why No Registry Commit

CLAUDE.md Rule 1 explicitly prohibits `feat(scout): add <SYMBOL> to TOKEN_REGISTRY` during the
30-day Option B benchmark window (2026-05-15 → ~2026-06-15). Three previous scout auto-adds
(MOLT 2026-05-14, OPENX + VEIL 2026-05-16) had to be reverted. Window ends in ~2 days.

---

## Scout Scan Results

### API Access This Run

| Endpoint | Status |
|----------|--------|
| `api.geckoterminal.com/api/v2/networks/base/trending_pools` | 403 Forbidden (egress block) |
| `api.geckoterminal.com/api/v2/networks/base/new_pools` | 403 Forbidden (egress block) |
| `api.dexscreener.com` | 403 Forbidden (egress block) |
| `api.coingecko.com` | 403 Forbidden (egress block) |
| Web search (4 queries) | Partial data — general Base ecosystem context |

The Claude Code execution sandbox egress proxy continues to block all third-party API domains.
This is a persistent infrastructure constraint (see MEDIC_REPORT.md Run history).

---

## Candidates Evaluated via Web Search

| Token | Notes | Verdict |
|-------|-------|---------|
| **MXNB** | Mexican peso stablecoin by Bitso; MXNB/USDC pool on Aerodrome; 24h vol $2,771 | ❌ REJECT — 24h vol far below $50K threshold; stablecoin peg (zero alpha) |
| **AZUL** | Base network upgrade name, not a tradeable token (code references in B20Factory) | ❌ NOT A TOKEN — infrastructure upgrade only |
| **BASE token** | Base native token exploration ongoing; no TGE announced as of June 2026 | ❌ WATCH — no contract address yet, Polymarket odds 69% for 2026 TGE |

### Methodology Note

Without API access to GeckoTerminal trending pools and DexScreener, it is impossible to
verify on-chain liquidity (>$100K), 24h volume (>$50K), or pool age (>3 days) for candidates
identified via web search alone. The egress allowlist fix (see MEDIC_REPORT.md recommendation)
remains the prerequisite for effective scout operation.

---

## Watch List for Henry (Post-Window Review ≥2026-06-15)

These are unverified candidates from web search context worth checking once the Option B
window closes and API access is enabled:

| Symbol | Category | Basis for Interest |
|--------|----------|--------------------|
| **BASE** | BLUE_CHIP | If/when the Base native token launches; Polymarket 69% odds 2026 TGE. Would be top-tier addition. Address: TBD |
| **MXNB** | TOKENIZED_STOCKS? | Onchain Mexican peso (Bitso/Juno). Stablecoin so not a trading alpha play, but could have yield/RWA angle. Current vol too thin. |

**Recommended next scan date:** 2026-06-16 (after Option B window closes) with API access enabled.

---

## Infrastructure Ask (Persistent — Run #35)

To unlock meaningful scout operation:
1. Add `api.geckoterminal.com` and `api.dexscreener.com` to Claude Code egress allowlist
2. Or expose a lightweight proxy endpoint on an allowed domain

Without this, the scout can only report general ecosystem context, not verifiable token metrics.
