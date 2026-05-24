# Cohort Proposal — 2026-05-24

**Status:** PROPOSAL ONLY — cohort locked until ~2026-06-15 (Option B window).
No changes made to `TOKEN_REGISTRY` or `COHORT_QUALITY_7`.
Per CLAUDE.md Rule 1: additions require human PR after the window closes.

---

## Scout Run — 2026-05-24

Last successful scout commit: 2026-05-16 (VEIL/OPENX, both reverted).
48-hour threshold exceeded → scout triggered.

Note: Bot API (`/api/errors`, `/api/balances`) and GeckoTerminal API were
inaccessible from the remote execution environment (403 / host-not-in-allowlist).
Scout used WebSearch + DexScreener trend data as fallback sources.

---

## Candidates Evaluated

| Symbol | Name | Liquidity | 24h Vol | Pool Age | Sector | Score | Decision |
|--------|------|-----------|---------|----------|--------|-------|----------|
| GITLAWB | gitlawb (AI dev platform) | $4.87M | ~$1.5M | ~2 months | AI_TOKENS | 7/10 | PROPOSE (cohort locked) |
| VIRTUAL | Virtuals Protocol | $498M mktcap | $13.3M | 2+ years | AI_TOKENS | — | Already in registry |
| Root Edge | Root Edge | $924K vol | unknown liq | unknown age | unknown | 3/10 | Rejected (insufficient data) |
| Syntra402 | Syntra402 | $294K vol | unknown liq | unknown age | unknown | 2/10 | Rejected (too speculative) |

---

## Top Candidate: GITLAWB

**Symbol:** GITLAWB
**Pool:** GITLAWB/WETH on Uniswap V4 (Base)
**Pool address:** `0xec33256bf1ded407a57fd3c1965e7556e42ac14db09bc4e6fef57d5e2eb0b0b9`
**Liquidity:** $4.87M (pool: 21.41B GITLAWB + 411 WETH)
**24h Volume:** ~$1.5M (trending on DexScreener)
**Pool Age:** ~2 months ✅
**CoinPaprika:** https://coinpaprika.com/coin/gitlawb-gitlawb/
**GeckoTerminal:** https://www.geckoterminal.com/base/pools/0xec33256bf1ded407a57fd3c1965e7556e42ac14db09bc4e6fef57d5e2eb0b0b9

**Description:** Gitlawb is a decentralized code collaboration platform for AI agents
and human developers. Repositories stored on IPFS/Filecoin/Arweave, peer
connectivity via libp2p. Strong AI_TOKENS narrative alignment.

**Quality scores:**
- Volume consistency: 6/10 (trending but 24h data only, no weekly view)
- Liquidity depth: 8/10 ($4.87M is well above $100k floor)
- Momentum: 7/10 (on DexScreener trending list, $1.5M 24h vol)
- Category fit: 8/10 (AI/developer tooling, strong Base-native narrative)
- **Overall: 7/10** (above 6/10 threshold)

**Proposed TOKEN_REGISTRY entry (for human review):**
```typescript
GITLAWB: {
  address: "0x...", // verify exact ERC-20 address on BaseScan
  symbol: "GITLAWB", name: "gitlawb", coingeckoId: "gitlawb",
  sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
},
```
⚠️ Token contract address must be verified on BaseScan before merging —
search was unable to return the ERC-20 contract address directly (only the
Uniswap V4 pool address was retrieved).

**Why held:** CLAUDE.md Rule 1 — cohort frozen until 2026-06-15.

---

## Auditor Research (background, no API data available)

Bot API inaccessible this run — win_rate, drawdown, and streak cannot be
computed. Audit trigger conditions could not be evaluated. Research below
is cached for the next triggered audit.

### Position Sizing Finding (Impact 3/5, Complexity 2/5, Risk: low)

**Finding:** Half-Kelly (50% of computed Kelly size) captures ~75% of
optimal long-run growth while cutting volatility in half versus Full Kelly.
Cripton AI and Polymarket bots capped at 25-40% of Kelly in 2026 practice.

NVR current: `Kelly fallback 8%, LIGHT tier 20%`. These caps are already
conservative. However, a dynamic drawdown-based scale-down is absent:
if portfolio drops >20% from peak → position sizes should halve automatically.

**Source:** https://cripton.ai/en/guides/bot-risk-management

**Recommendation for Henry's review:** Add a `DRAWDOWN_SCALE_DOWN_PCT`
constant (e.g., `0.20`) to `src/core/config/constants.ts`. When
`(peakValue - currentValue) / peakValue > DRAWDOWN_SCALE_DOWN_PCT`,
reduce all Kelly sizes by 50% until recovery. Complexity: ~5 lines in
the Kelly sizing block of `agent-v3.2.ts`. Risk: low.

### Signal Quality Finding (Impact 2/5, Complexity 3/5, Risk: low)

**Finding:** Mirroring on-chain smart-money wallet flows achieves 65%
win rate vs 41% for pure-technical bots (2025-2026 data). NVR already
tracks wallet flow via signal-service but confluence scoring weighting
for wallet flow vs technical indicators may be under-weighted.

**Recommendation:** Review confluence score weights in `agent-v3.2.ts`
— if wallet_flow_signal is present but weighted <20% of total confluence,
consider raising to 25-30%. Requires bot API access to validate current
scoring weights before implementing.

---

## Action Items for Henry

1. **Verify GITLAWB contract address** on BaseScan and confirm liquidity
   is still >$100k when the 30-day Option B window closes (~2026-06-15).
   Then PR to add to TOKEN_REGISTRY if cohort expansion is approved.

2. **Drawdown scale-down:** Review adding `DRAWDOWN_SCALE_DOWN_PCT`
   constant as described above — low complexity, measurable downside
   protection, no execution logic touched.

3. **Bot API access from CI environment:** The remote execution environment
   cannot reach `autonomous-trading-bot-production.up.railway.app`. This
   means Medic and Auditor metric checks are blind when running in cloud
   CI. Consider exposing a read-only `/api/health-public` endpoint or
   adding the Railway API domain to the network allowlist.
