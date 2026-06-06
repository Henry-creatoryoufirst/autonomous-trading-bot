# NVR Strategy Audit Research — 2026-06-06T00:00Z

## Run Context

**Trigger check:** Bot API (`/api/trades`, `/api/portfolio`, `/api/patterns`, `/api/adaptive`) returned HTTP 403 "Host not in allowlist" from this remote execution container. Trigger conditions (win_rate, drawdown, losing_streak, marketRegime) **could not be verified**.

**Decision:** Research portion run proactively given:
- Forced full liquidation to USDC on 2026-05-28 (commit `f29798d`) — 9 days ago, likely in portfolio rebuild phase
- Option B benchmark window ends ~2026-06-15 (9 days remaining)
- No automated oversight since 2026-05-22

**No code changes made** — trigger conditions unverified; Auditor Safety rules apply.

---

## Internal Diagnosis

| Metric | Status |
|--------|--------|
| Win rate | Cannot verify (API blocked) |
| Drawdown | Cannot verify (API blocked) |
| Losing streak | Cannot verify (API blocked) |
| Market regime | Cannot verify (API blocked) |
| Last trade data | Last commit: forced liquidate-all 2026-05-28 |

**Bot is likely rebuilding from all-USDC position as of 2026-05-28.**

---

## Research Findings

### 1. Signal Quality
**Searches:** "DeFi trading bot confluence scoring on-chain signals alpha 2026 Base L2"

**Key finding:** Leading bots in 2026 monitor stablecoin inflows/outflows across DeFi protocols (into Aave, Aerodrome) as a forward signal — capital moving into yield before it moves into risk assets. This is distinct from Fear & Greed index (sentiment) or funding rates (derivatives).

**NVR current state:** Uses RSI, MACD, BB, SMA, Fear & Greed, wallet flow signals. Stablecoin protocol flow data (e.g., Aave deposit delta) not integrated.

**Score:** Impact 3/5, Complexity 4/5, Risk: medium
**Priority:** 0.75 — **below 2.0 threshold, not implementing**

---

### 2. Execution Efficiency
**Searches:** "Aerodrome Slipstream routing gas optimization 2026", "permit2 batch transaction ERC-20 approval"

**Key finding:** Permit2 batch permits can cover multiple tokens in one off-chain signature, saving on-chain approve() calls. However, the NVR bot already uses Permit2 (evident from PATTERN B medic fix for allowance timing). The incremental gain here is minor.

**NVR current state:** Permit2 integrated. 20s wait added after approval (from prior medic fix). Gas on Base is already $0.01–0.05 per transaction.

**Score:** Impact 2/5, Complexity 4/5, Risk: medium
**Priority:** 0.5 — **below 2.0 threshold, not implementing**

---

### 3. Position Sizing
**Searches:** "Kelly criterion volatility adjusted cryptocurrency 2026", "drawdown aware position sizing DeFi bot"

**Key finding:** Research confirms Quarter-Kelly (0.25×) as optimal for sustained bear regimes with crypto fat tails. Half-Kelly captures 75% of growth with significantly less volatility. Daily recalculation using 30-day rolling window is best practice.

**NVR current state:** `KELLY_FRACTION = 0.25` (Quarter Kelly), `KELLY_ROLLING_WINDOW = 30`. Already at the research-recommended configuration. Bear-adjusted in May-2026. Alpha trades use `ALPHA_KELLY_MULTIPLIER = 0.5` (Half-Kelly for uncertainty).

**Score:** Impact N/A (already implemented optimally), Complexity N/A
**Priority:** N/A — **already optimal, no change needed**

---

### 4. Competitive Intelligence
**Searches:** "autonomous DeFi trading bot Base chain alpha strategy 2026", "MEV protection slippage optimization Base L2"

**Key finding:** Best-in-class bots use adaptive slippage: 3–5% for established tokens, 15–25% for memecoins. This prevents failed trades on thin-liquidity HIGH risk tokens while protecting against sandwich attacks on large blue-chip swaps.

**NVR current state:** `calculateAdaptiveSlippage()` already implements MEV-aware adaptive slippage that **tightens** for larger trades (to resist sandwiches). Base slippage is 100bps (1%) for all tokens. The research-cited improvement would be to also **widen** base slippage for HIGH riskLevel tokens to improve fill rate on meme coins.

**Score:** Impact 3/5, Complexity 2/5, Risk: low
**Priority:** 1.5 — **below 2.0 threshold (borderline). Not implementing without verified trigger.**

**Implementation sketch (≤5 lines if triggered):**
In `calculateAdaptiveSlippage()` in `agent-v3.2.ts`, add a token risk-tier lookup before computing adaptive slippage:
```typescript
// Widen base slippage for high-risk tokens (meme coins fill better with 2-3%)
const riskTierBps = tokenRiskLevel === 'HIGH' ? 200 : CONFIG.trading.slippageBps; // 2% for memes vs 1% default
let adaptiveSlippage = riskTierBps;
```
This would require passing `tokenRiskLevel` from TOKEN_REGISTRY into `calculateAdaptiveSlippage`. Currently the function doesn't receive this parameter — would need a small signature change.

---

## Action Taken

**None.** Trigger conditions could not be verified (API blocked). No code was changed.

The position sizing (Research #3) is already optimally configured. The slippage improvement (#4, Priority 1.5) is the most actionable finding if a trigger is confirmed on next accessible run.

---

## Watch List for Henry's Review

1. **Slippage widening for HIGH risk tokens (Priority 1.5):** Could improve fill rate on BRETT, TOSHI, DEGEN, meme cohort members during thin markets. Simple ≤5 line change. Implement if win_rate < 0.45 confirmed.

2. **Bot API allowlist — remote agent access:** The agent cannot check bot health or metrics from Railway's remote execution environment. Consider adding the execution container's IP range to the API allowlist, or expose a lightweight public health endpoint (no auth, read-only failure rate only) to enable automated health checks.

3. **Scout data access:** GeckoTerminal, DexScreener, DefiLlama APIs all return 403 from this container. The scout cannot run properly. Same network policy issue as above. Potential fix: use the GeckoTerminal API key from Railway env vars if one exists, or run scout from within the bot container via a Railway cron endpoint.

---

## Option B Window Status

9 days remain (~2026-06-15). The bot was force-liquidated to USDC on 2026-05-28. For the 30-day benchmark to be meaningful, the portfolio needs to be deploying capital during this period. Henry should verify the bot is actively trading from its USDC position.

Sources consulted:
- [BingX: Top On-Chain Analysis Tools 2026](https://bingx.com/en/learn/article/what-are-the-top-on-chain-analysis-tools-for-crypto-traders)
- [QuickNode: MEV Protection on Base](https://www.quicknode.com/guides/defi/bots/build-a-telegram-trading-bot-on-base)
- [LBank: Kelly Criterion for Crypto](https://www.lbank.com/explore/mastering-the-kelly-criterion-for-smarter-crypto-risk-management)
- [Phemex: Top 10 Bot Strategies Q1 2026](https://phemex.com/blogs/top-10-profitable-bot-strategies-q1-2026)
- [Eco.com: Permit2 2026 Guide](https://eco.com/support/en/articles/12005545-what-is-permit2-a-2026-guide-to-token-approvals)
