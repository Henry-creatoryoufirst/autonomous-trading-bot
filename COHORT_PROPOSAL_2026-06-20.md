# Cohort Proposal — 2026-06-20

**Filed by:** NVR Capital autonomous agent (Run #35)
**Status:** PENDING HUMAN REVIEW — do not merge to TOKEN_REGISTRY without explicit Henry sign-off

> Per CLAUDE.md Rule 1 (cohort is locked, changes via explicit human PR only), this file replaces any direct TOKEN_REGISTRY commit. Henry reviews, approves or rejects, then opens a PR if desired.

---

## Context

The Option B benchmark window (started 2026-05-15, 30 days) completed approximately **2026-06-15**. Today is 2026-06-20 — the window closed 5 days ago.

Scout last ran successfully 2026-05-14 (MOLT added). This proposal covers scout research from Run #35.

---

## Candidate: VELVET (Velvet Capital)

| Field | Value |
|-------|-------|
| Symbol | VELVET |
| Name | Velvet Capital |
| Base Address | `0xbf927b841994731c573bdf09ceb0c6b0aa887cdd` |
| Sector | DEFI |
| Risk Level | MEDIUM |
| 24h Volume | ~$6.1M |
| Liquidity (Aerodrome) | ~$3.2M |
| Market Cap | ~$3.5M |
| Holders | 6,759 (as of 2026-06-19) |
| Aerodrome Pool Age | 8 days (migrated 2026-06-12) |
| minTradeUSD | 25 |
| Decimals | 18 |

### What is Velvet Capital?
AI-powered DeFi operating system for on-chain portfolio management. 100k+ users. Vaults deployed across Base, BNB Chain, Solana, Ethereum, Sonic. Smart order routing with MEV protection. MEXC and KuCoin listed (centralized exchange presence confirms legitimacy).

### Scout Quality Score: 7/10
- ✅ Liquidity > $100k ($3.2M — well above threshold)
- ✅ 24h volume > $50k ($6.1M — very high, 175% of market cap)
- ✅ Pool age > 3 days (8 days on Aerodrome)
- ✅ Not in TOKEN_REGISTRY (confirmed)
- ✅ FDV likely > $1M (market cap $3.5M)
- ⚠️ Pool age 8 days — young on Aerodrome (migrated from prior pool)
- ⚠️ Volume/mcap ratio ~175% — unusually high, watch for wash trading

### Suggested TOKEN_REGISTRY entry (if Henry approves)
```typescript
VELVET: {
  address: "0xbf927b841994731c573bdf09ceb0c6b0aa887cdd",
  symbol: "VELVET", name: "Velvet Capital", coingeckoId: "velvet",
  sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

---

## Base Beryl Upgrade (June 25, 2026) — Watch Item

Base launches its Beryl upgrade on **June 25** with the new **B20 token standard** for stablecoins and RWAs. This may surface new legitimate RWA tokens worth adding to the TOKENIZED_STOCKS sector in a future scout run. No specific candidates yet — wait until post-Beryl pools establish 3+ days of history.

---

## Action Required from Henry

1. **Review the Option B 30-day performance** — did NVR outperform cbBTC/WETH 60/40 by ≥5% annualized?
2. **VELVET decision** — approve/reject the candidate above
3. **Egress allowlist** — add `autonomous-trading-bot-production.up.railway.app` and `api.geckoterminal.com` to Claude Code environment egress so the Medic can actually check bot health (35 consecutive runs blind)
4. **Post-Beryl scout** — run a manual scout after June 25 for new B20/RWA tokens
