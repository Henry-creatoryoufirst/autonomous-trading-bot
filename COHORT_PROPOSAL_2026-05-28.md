# NVR Scout Report — 2026-05-28

> **Option B window is active (2026-05-15 → ~2026-06-15).**
> Per CLAUDE.md Rule 1, no `feat(scout)` commit to `TOKEN_REGISTRY` is permitted.
> Candidates are documented here for Henry's review and intentional merge after the window.

---

## Run metadata

| Field | Value |
|---|---|
| Run timestamp | 2026-05-28 (UTC) |
| Last scout commit | 2026-05-25 07:19 UTC (3 days ago — > 48h threshold met) |
| Bot API status | ⚠️ Unreachable from this environment (network allowlist) |
| GeckoTerminal API status | ⚠️ Unreachable from this environment (network allowlist) |
| Research method | WebSearch + public market data |

---

## Scout candidates evaluated

### AERO — Aerodrome Finance

| Metric | Value | Threshold | Pass? |
|---|---|---|---|
| Contract address | `0x940181a94a35a4569e4529a3cdfb74e38fd98631` | — | — |
| Network | Base mainnet | Base | ✅ |
| 24h trading volume | ~$24M | > $50k | ✅ |
| Protocol TVL (as liquidity proxy) | $1.3B | > $100k | ✅ |
| Pool/token age | Launched 2023 | > 3 days | ✅ |
| Already in TOKEN_REGISTRY | No | Not present | ✅ |
| **Quality score** | **8 / 10** | ≥ 6 | ✅ |

**Score breakdown:**
- Volume consistency: 9/10 — $24M 24h volume, consistently top DEX on Base
- Liquidity depth: 9/10 — 70% of all Base DEX liquidity, $1.3B TVL
- Momentum: 7/10 — Volume up 29% day-over-day; upcoming Aero cross-chain merger (July 2026)
- Category fit: 8/10 — DEFI sector, directly strategic (NVR routes via Aerodrome Slipstream)

**Recommended TOKEN_REGISTRY entry (do not apply until Option B window closes ~2026-06-15):**

```typescript
AERO: {
  address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
  symbol: "AERO", name: "Aerodrome Finance", coingeckoId: "aerodrome-finance",
  sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

**Why it matters:** AERO is the native governance/fee token of Aerodrome, which already routes ~50%+ of NVR's trades. Adding AERO gives NVR exposure to the infrastructure layer NVR already relies on. With the July 2026 Aero cross-chain DEX launch (merging Aerodrome + Velodrome), upside catalysts are clear and near-term.

**Risk note:** Token unlock schedule and inflation via gauge emissions. veAERO lockers receive 100% of protocol fees; unhedged AERO spot could underperform vs holding veAERO. Treat as MEDIUM risk, not LOW.

---

## Tokens rejected

No additional candidates could be verified with specific on-chain pool data due to GeckoTerminal API being blocked in this environment. AERO was confirmed via multiple independent public sources (BaseScan, CoinMarketCap, CoinGecko, Aerodrome.finance).

---

## Auditor research findings (run context)

Bot API was unreachable — trigger conditions (win_rate, drawdown, losing_streak) could not be calculated. Full audit skipped. Research runs included below for Henry's async review.

### Signal quality
- **Finding:** Smart Money wallet confluence (≥2 known profitable wallets accumulating same token) lifts empirical win rates from ~41% to ~65% in on-chain bots.
- **Source:** BingX on-chain analysis tools guide 2026; Nansen Smart Money methodology
- **Impact/Complexity:** 4/5 × 3/5 = priority 1.33 — medium-term implementation
- **Recommendation:** Adding a Smart Money accumulation signal layer into confluence scoring is the highest-alpha unlock. Not auto-implementable in ≤10 lines; flagged for Henry's review.

### Position sizing
- **Finding:** Half-Kelly (f × 0.5) captures ~75% of full-Kelly growth while cutting max drawdown materially. NVR currently uses full-Kelly with 8% fallback floor.
- **Source:** astuteinvestorscalculus.com Kelly Criterion guide; GPTrader AI strategy 2026
- **Impact/Complexity:** 3/5 × 1/5 = priority 3.0 — low complexity, meaningful downside protection
- **Recommendation:** Simple 1-line change to Kelly multiplier (`kellyFraction * 0.5`). Qualifies for auditor auto-implementation IF audit triggers had been confirmed. Held for Henry review since triggers couldn't be verified.

### Execution efficiency
- **Finding:** Aerodrome has begun migrating to MEV-resistant pools (May 12, 2026). NVR should ensure its Slipstream router targets the new MEV-resistant pool addresses after the July 2026 launch.
- **Source:** cryptoadventure.com Aerodrome Slipstream Review 2026; ainvest.com Aerodrome news
- **Impact/Complexity:** 3/5 × 2/5 = priority 1.5 — medium priority, needs pool address tracking
- **Recommendation:** Monitor Aerodrome pool migration; update router config for new MEV-resistant pool contracts in July 2026.

### Competitive intelligence
- **Finding:** Leading 2026 DeFi bots use specialized sub-agent cooperation + Agentic RAG querying The Graph for real-time order book depth. NVR already has a MirrorAgent (spec-036) — logical next step is wiring live order-book depth.
- **Source:** exmon.pro AI Trading Agents 2026; DeepAlpha bot architecture
- **Impact/Complexity:** 4/5 × 4/5 = priority 1.0 — high impact but high complexity
- **Recommendation:** Watch list for post-Option B window.

---

## Action required from Henry

1. **After ~2026-06-15 (Option B window close):** Review AERO entry above and merge via intentional PR.
2. **Near-term optional:** Consider applying Half-Kelly multiplier (`kellyFraction * 0.5` in Kelly sizing code) — low-risk, 1-line change, protective during remaining benchmark window.
3. **July 2026:** Monitor Aerodrome MEV-resistant pool migration and update router pool addresses.
