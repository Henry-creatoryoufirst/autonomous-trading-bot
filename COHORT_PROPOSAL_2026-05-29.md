# NVR Scout Run — 2026-05-29

## Option B Lock Status
Cohort is LOCKED per CLAUDE.md Rule 1 until ~2026-06-15 (30-day Option B window).
No additions to TOKEN_REGISTRY in this run. Candidates logged here for post-window review.

## Scout Trigger
Last kept scout commit: 2026-05-08 (SYRUP) — 21 days ago, past 48h threshold.

## Network Limitations This Run
GeckoTerminal API (403), Railway bot API, CoinGecko API all unreachable from this
execution environment. Scout used WebSearch fallback. Coverage is narrower than a
full GeckoTerminal sweep — Henry should verify candidates on-chain before acting.

## Candidates Evaluated

| Token | Symbol | Age | 24h Vol | Liquidity | Sector | Score | Status |
|-------|--------|-----|---------|-----------|--------|-------|--------|
| XMAQUINA | DEUS | 2 days | $9.26M | >$1M | AI_TOKENS | 7/10 | ❌ Too new (< 3 days) |

### DEUS (XMAQUINA) — Watch List

- **TGE:** May 27, 2026 on Base via Aerodrome + Virtuals Protocol
- **Contract:** On Base (ERC-20) — exact address not confirmed via API in this run
- **Category:** AI/Robotics DAO building on-chain capital markets for humanoid robotics
- **Volume 24h:** $9.26M (strong)
- **Liquidity:** >$1M reported locked; $1M+ pool on Aerodrome
- **Pool age:** ~2 days — **fails >3 days quality filter**
- **CoinGecko ID:** `deus-token` (tentative, verify before use)
- **CEX listings:** KuCoin, MEXC, BingX confirmed at launch
- **Why interesting:** Aerodrome's first Virtuals-protocol token launch; robotics/AI
  narrative aligns with AI_TOKENS sector; strong day-1 volume suggests real demand
- **Why not adding now:** (1) Option B lock — no scout additions until ~2026-06-15,
  (2) pool age < 3 days — needs seasoning, (3) contract address unverified via API

## Action Required (Henry)
1. After 2026-06-15 Option B window closes, evaluate DEUS if still active (>3 days old ✅ by then)
2. Verify Base contract address on Aerodrome or Basescan before adding
3. Check liquidity depth is still >$100k at time of addition
4. Suggested entry: AI_TOKENS sector, riskLevel: HIGH, minTradeUSD: 10, decimals: 18

## Other Notable Finds
- **Aerodrome → "Aero" migration:** MEV-resistant pool migration began May 12. July 2026
  launch of unified cross-chain Aero DEX (merging Aerodrome + Velodrome). This may
  affect routing code — worth reviewing executeDirectDexSwap pool address logic.
- **Base MCP launch May 26:** Base now lets AI agents (Claude, ChatGPT) propose on-chain
  transactions via OAuth 2.1. Not directly actionable for NVR but ecosystem signal.
