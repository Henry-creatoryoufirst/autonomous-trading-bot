# NVR Scout Report & Cohort Proposal — 2026-06-11

**Status:** PROPOSAL ONLY — Option B window active (2026-05-15 to ~2026-06-15).
TOKEN_REGISTRY was NOT modified per CLAUDE.md Rule 1. Human review required before any registry change.

---

## Run Context

- **Date:** 2026-06-11
- **Last successful scout commit:** 2026-05-14 (MOLT auto-discovered, ~28 days ago)
- **Option B window closes:** ~2026-06-15
- **API access:** 403 Forbidden (API_AUTH_TOKEN is auto-generated per Railway deployment; this agent does not hold it)
- **GeckoTerminal direct access:** Blocked by network policy
- **Data source for candidates:** DexScreener web search snippets + general market research

---

## Candidates Evaluated

| Token | 24h Volume | Liquidity | Source | Pool Age Known? | In Registry? | Scout Score | Verdict |
|-------|-----------|-----------|--------|----------------|-------------|-------------|---------|
| VELVET | ~$9.8M | ~$809K | DexScreener snippet | Unknown | No | 6/10 | **PROPOSE** |
| CTR | ~$22.3M | ~$593K | DexScreener snippet | Unknown | No | 7/10 | **PROPOSE** |
| v3DEGEN | ~$2.1M | ~$1.4M | DexScreener snippet | Unknown | DEGEN yes (different contract?) | N/A | **SKIP — parent token in registry** |

**Scoring rationale:**
- VELVET: Strong volume ($9.8M) relative to liquidity ($809K), volume/liquidity ratio of ~12× implies active trading. Category TBD. Score 6/10 pending address/age verification.
- CTR: Very high volume ($22.3M), solid liquidity ($593K). Volume/liquidity ratio ~37× is extremely high — could indicate a short-lived pump. Score 7/10 pending age/address verification. Warrants caution.

---

## Data Limitations

GeckoTerminal API and bot production API were both unreachable during this run (network policy + auth). The above data comes from web search result snippets — no addresses, pool creation dates, or full metadata could be verified. Before human review, the following must be confirmed:

1. **Contract addresses** — verify via BaseScan
2. **Pool age** — must be >3 days old (filter out brand-new launches)
3. **Audit:** Not already in TOKEN_REGISTRY under a different key
4. **Category fit** — assign correct sector (DEFI, AI_TOKENS, MEME_COINS, etc.)

---

## Scout Quality Filter Summary (against standard criteria)

| Criterion | VELVET | CTR |
|-----------|--------|-----|
| Liquidity > $100K | ✅ $809K | ✅ $593K |
| 24h volume > $50K | ✅ $9.8M | ✅ $22.3M |
| Pool age > 3 days | ❓ unknown | ❓ unknown |
| Not in TOKEN_REGISTRY | ✅ | ✅ |
| Address verified | ❌ not confirmed | ❌ not confirmed |

Both tokens **tentatively pass liquidity and volume filters** but cannot advance until address + pool age are confirmed by Henry or a future run with full API access.

---

## Recommendation

If Henry or a follow-up agent can confirm:
1. VELVET Base contract address + pool creation date > 3 days
2. CTR Base contract address + pool creation date > 3 days

Then a registry PR would look like:

```typescript
// === AUTO-DISCOVERED (scout 2026-06-11) ===
VELVET: {
  address: "<BASE_CONTRACT_ADDRESS>",
  symbol: "VELVET", name: "Velvet", coingeckoId: "<id>",
  sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
CTR: {
  address: "<BASE_CONTRACT_ADDRESS>",
  symbol: "CTR", name: "<full name>", coingeckoId: "<id>",
  sector: "DEFI", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
},
```

> Note: CTR's very high volume/liquidity ratio (~37×) is atypical and warrants extra scrutiny before adding. Could be wash trading or a short-term momentum spike.

---

## Auditor Research (collected even though API trigger check was skipped)

*Trigger check was not possible — production API returned 403 across all endpoints (/api/trades, /api/portfolio, /api/patterns, /api/adaptive).*

### Signal Quality
- **Finding:** Mirroring on-chain whale wallet activity achieves ~65% win rate vs 41% for pure technical bots (2026 research)
- **Source:** Multiple bot comparison guides, June 2026
- **Impact:** 4, **Complexity:** 4, **Risk:** medium
- **Priority:** 1.0 — below threshold of 2.0, and requires new data feeds (Dune/Nansen integration)
- **Implemented:** No — too complex, requires new data pipeline

### Execution Efficiency
- **Finding:** Aerodrome Slipstream V2 (launched March 2026) includes improved routing algorithm with better price discovery across liquidity pools; NVR may already benefit if using latest router address
- **Source:** Aerodrome SlipStream Review 2026 — cryptoadventure.com
- **Impact:** 2, **Complexity:** 2, **Risk:** low
- **Priority:** 1.0 — marginal gain since NVR already routes through Aerodrome; worth verifying router version on next human review
- **Implemented:** No — cannot verify router address against production config without API access; low priority

### Position Sizing
- **Finding:** Fractional Kelly (25-50%) with drawdown-aware reduction — automatically reduce position size as portfolio drawdown increases beyond a threshold. Specifically: `adjustedKelly = fullKelly * max(0.25, 1 - drawdown / maxDrawdownTolerance)`
- **Source:** Kelly Criterion for Crypto Traders (Medium, 2026) + Altrady blog
- **Impact:** 3, **Complexity:** 2, **Risk:** low
- **Priority:** 1.5 — promising but below auto-implement threshold of 2.0 without confirmed drawdown data
- **Implemented:** No — cannot confirm trigger condition without API access

### Competitive Intelligence
- **Finding:** MEV protection via private relay submission (bypass public mempool) is going mainstream in 2026; Quicknode Base DeFi Power Bundle and MevX both offer this for Base
- **Source:** Bitsgap MEV Protection 2026, Quicknode guides
- **Impact:** 3, **Complexity:** 3, **Risk:** low
- **Priority:** 1.0 — useful but complex; NVR currently relies on Aerodrome's internal routing which provides some MEV resistance already
- **Implemented:** No

### Top Finding for Henry's Review
**Drawdown-aware Kelly sizing** (Impact 3, Complexity 2, Risk low) is the most implementable improvement identified this cycle. In `agent-v3.2.ts`, the Kelly formula could be enhanced with a drawdown multiplier:
```typescript
// Current: kellySizing = edgeEstimate / (variance || 1)
// Enhanced: apply drawdown penalty
const drawdownPct = (peakPortfolioValue - currentValue) / peakPortfolioValue;
const drawdownMultiplier = Math.max(0.25, 1 - drawdownPct / MAX_TOLERABLE_DRAWDOWN);
kellySizing = (edgeEstimate / (variance || 1)) * drawdownMultiplier;
```
This is 2-3 lines, low risk, and directly addresses over-sizing during drawdown periods. Recommend Henry review and approve for implementation on next cycle with confirmed trigger data.

---

## Next Steps for Henry

1. **Confirm Option B window end date** (~June 15) — after that, scout can auto-add to TOKEN_REGISTRY again
2. **Set API_AUTH_TOKEN** as a stable env var on Railway so this agent can access `/api/errors`, `/api/balances`, `/api/trades`, etc. on future runs
3. **Verify VELVET + CTR addresses** on BaseScan if interested in adding post-window
4. **Review drawdown-aware Kelly sizing** enhancement for authorization
