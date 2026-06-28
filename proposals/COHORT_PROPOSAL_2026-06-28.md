# Scout Candidate Proposal — 2026-06-28

**Run date:** 2026-06-28  
**Status:** PROPOSAL ONLY — per CLAUDE.md Rule 1, no auto-add to TOKEN_REGISTRY was made.  
**Action required:** Human review + explicit PR to add any token.

---

## Scout Run Notes

- GeckoTerminal API: blocked by network policy (403)
- DEXScreener API: blocked by network policy (403)
- Bot API (Railway): blocked by network policy (403)
- Research conducted via WebSearch + secondary sources

---

## Candidate Evaluated: VELVET

| Field | Value |
|-------|-------|
| Symbol | VELVET |
| Name | Velvet Capital (DeFAI) |
| Contract (Base) | `0xbf927b841994731c573bdf09ceb0c6b0aa887cdd` |
| CoinGecko ID | `velvet` |
| 24h Volume | ~$87M USD |
| Market Cap | ~$721M USD (#67 CoinGecko) |
| Liquidity | Protocol-owned, consolidated on Aerodrome (Base) |
| Pool Age | >3 days (migrated POL to Aerodrome, pre-existing) |
| Already in Registry | No |

**Quality filter result: PASS** (all four criteria met)

**Scores (1-10):**
- Volume consistency: 9 — top trending on DEXScreener ($87M/day)
- Liquidity depth: 8 — Aerodrome POL, tight spreads
- Momentum: 9 — +1,400% surge driven by synthetic pre-IPO markets (SpaceX, OpenAI, Anthropic)
- Category fit: 9 — DeFAI operating system; perfect match for AI_TOKENS sector

**Composite score: 8.75/10** (threshold 6+) ✅

**Proposed registry entry (for human review):**
```typescript
VELVET: {
  address: "0xbf927b841994731c573bdf09ceb0c6b0aa887cdd",
  symbol: "VELVET", name: "Velvet Capital", coingeckoId: "velvet",
  sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
},
```

**Caution flags:**
- High momentum token (+1400% in weeks) — elevated volatility risk
- Market cap-driven liquidity (POL), not organic; verify depth via Aerodrome directly before trading
- Should verify decimals on-chain before merge

---

## Rejected / Insufficient Data

| Symbol | Reason |
|--------|--------|
| BEAT (Audiera) | Not Base-native; cross-chain token |
| NEAR | Not on Base chain |
| DEXE | Not on Base chain |
| ADI | Not enough Base-specific data |
| SIREN | Insufficient liquidity/pool data |

---

## API Availability Issues This Run

The following data sources were blocked by environment network policy:
- `api.geckoterminal.com` — 403
- `api.dexscreener.com` — 403
- `autonomous-trading-bot-production.up.railway.app` — 403

This affected both the Medic (cannot check bot health) and the Auditor (cannot check win rate / drawdown). Henry should verify bot health manually via Railway dashboard.
