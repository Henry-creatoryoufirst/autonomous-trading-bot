# Cohort Proposal — 2026-06-20

**Filed by:** NVR Capital autonomous agent (scout job, Run #35)
**Status:** PENDING HUMAN REVIEW — do NOT add to TOKEN_REGISTRY without Henry's explicit approval
**Context:** Option B window closed ~2026-06-15. Cohort lock per CLAUDE.md Rule 1 is in effect until Henry opens an explicit PR.

---

## Candidate: VELVET (Velvet Capital)

### Summary
Velvet Capital is a DeFAI (DeFi + AI) portfolio management OS that lets funds and retail users route trades, build vaults, and run agentic strategies on-chain. Protocol-owned liquidity fully migrated to Aerodrome on Base (strong signal for Base-native commitment).

### Quality Filter Check

| Criterion | Value | Pass? |
|-----------|-------|-------|
| Pool liquidity > $100k | ~$3.2M (Aerodrome, per DexScreener) | ✅ |
| 24h volume > $50k | Likely yes (DexScreener showed active trading) | ⚠️ Unconfirmed |
| Pool age > 3 days | Protocol launched 2024, Base liquidity established | ✅ |
| Not in TOKEN_REGISTRY | Not present | ✅ |

### Scoring (1-10)

| Factor | Score | Notes |
|--------|-------|-------|
| Volume consistency | 6 | Cannot confirm via blocked GeckoTerminal API |
| Liquidity depth | 7 | $3.2M on Aerodrome is solid for AI_TOKENS tier |
| Momentum | 6 | Market cap ~$195M, established CEX listings (MEXC/KuCoin/Bitget/Gate) |
| Category fit | 7 | Fits AI_TOKENS sector; direct competitor analysis value |
| **Total** | **6.5/10** | Passes 6+ threshold |

### Proposed Token Registry Entry (for Henry's review)

```typescript
VELVET: {
  address: "NEEDS_VERIFICATION_ON_BASESCAN",  // verify at basescan.org before adding
  symbol: "VELVET", name: "Velvet Capital", coingeckoId: "velvet",
  sector: "AI_TOKENS", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

### Action Required from Henry

1. Verify Base contract address on [Basescan](https://basescan.org) — search "VELVET" or check [CoinGecko VELVET page](https://www.coingecko.com/en/coins/velvet) for the Base address.
2. Confirm 24h volume > $50k on [Aerodrome](https://aerodrome.finance) or [DexScreener Base](https://dexscreener.com/base).
3. If both check out, open an explicit PR adding VELVET to TOKEN_REGISTRY following the format above.

### Sources
- [Velvet Capital — Aerodrome liquidity migration](https://blog.velvet.capital/p/velvet-protocol-owned-liquidity-on)
- [VELVET on CoinGecko](https://www.coingecko.com/en/coins/velvet)
- [DexScreener Base VELVET/USDC](https://dexscreener.com/base) (search VELVET)
- [MEXC VELVET review](https://blog.mexc.com/token-reviews/what-is-velvet/)

---

## Other Candidates Evaluated This Run (Rejected)

| Token | Reason Rejected |
|-------|----------------|
| HYPE (Hyperliquid) | Not on Base L2; Hyperliquid is its own chain |
| HYPER (Bitcoin Hyper) | Presale stage, no live Base liquidity |
| AERO | Already in TOKEN_REGISTRY |
| VIRTUAL | Already in TOKEN_REGISTRY |

---

*This proposal was generated automatically. Per CLAUDE.md Rule 1, no changes were made to `src/core/config/token-registry.ts`. All additions require explicit human review and PR.*
