# Cohort Proposal — 2026-06-02

**Submitted by:** NVR Autonomous Agent (scout run, claude/cool-sagan-JECPw)
**Option B window status:** LOCKED until ~2026-06-15 — no TOKEN_REGISTRY edits made
**Trigger:** Last scout commit was 2026-05-16, >48h threshold exceeded

---

## Methodology Notes

GeckoTerminal API (`/api/v2/networks/base/trending_pools`) and DexScreener returned HTTP 403 from the container's network policy. Scout ran via WebSearch + CoinMarketCap data. Quantitative data is sourced from public search results and may lag real-time.

---

## Candidate: DEUS (XMAQUINA)

| Field | Value |
|-------|-------|
| Symbol | DEUS |
| Full name | XMAQUINA — Humanoid Robotics DAO |
| Base contract | `0x940A319B75861014A220D9c6c144d108552B089B` |
| TGE | 2026-05-27 (6 days ago) |
| Launch venue | Aerodrome Slipstream (Base) + KuCoin/MEXC |
| 24h volume | ~$9.26M USD |
| Liquidity | >$1M USD (portion locked 10 years per protocol) |
| Pool age | 6 days (> 3-day minimum) |
| Market cap | ~$11.4M (CMC rank #930) |
| Sector fit | AI_TOKENS |
| Already in registry | ❌ No |
| Passes all filters | ✅ Yes |

### Quality Score: 7/10

| Dimension | Score | Notes |
|-----------|-------|-------|
| Volume consistency | 7 | $9.26M/day on day 6 post-TGE is strong; unproven longer-term |
| Liquidity depth | 7 | >$1M with portion locked — healthy for a new token |
| Momentum | 8 | Aerodrome-native Virtuals launch, CEX listings on launch day |
| Category fit | 7 | AI/Robotics is a real sector narrative; complements AIXBT/VIRTUAL |

### Rationale

DEUS is the governance and utility token for XMAQUINA, a DAO building on-chain capital markets for humanoid robotics. It launched via Aerodrome's first-ever joint Virtuals Protocol event, giving it strong Base-native distribution. The $9.26M/day volume at 6 days post-TGE substantially exceeds the scout's $50k floor. Liquidity >$1M with locked portions reduces rug risk. The robotics/physical AI narrative is differentiated from existing AI_TOKENS holdings.

### Risk Flags

- Only 6 days old — momentum could fade after TGE excitement
- $11.4M market cap is small; thin beyond top pools
- No on-chain price history to evaluate trend quality
- Recommend waiting until 14+ days post-TGE to validate volume persistence before adding to live cohort

### Suggested Registry Entry (for Henry's review — DO NOT apply before window closes)

```typescript
DEUS: {
  address: "0x940A319B75861014A220D9c6c144d108552B089B",
  symbol: "DEUS", name: "XMAQUINA", coingeckoId: "xmaquina",
  sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
},
```

---

## Candidates Evaluated & Rejected

| Token | Reason Rejected |
|-------|----------------|
| BRETT, TOSHI, MOG, VIRTUAL, AERO | Already in TOKEN_REGISTRY |
| NEAR | Not a Base-native token (Solana/L1); no Base pool data found |
| Generic meme tokens | No specific pool data with verifiable >$100k liquidity + >$50k volume from available sources |

---

## Action Required

- [ ] Henry: review DEUS at 14+ days post-TGE (~2026-06-10) for volume persistence
- [ ] If Option B window ends and volume holds: add registry entry above to `src/core/config/token-registry.ts` via PR
- [ ] If volume collapses before window close: discard this proposal
