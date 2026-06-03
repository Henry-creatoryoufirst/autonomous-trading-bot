# NVR Cohort Proposal — 2026-06-03

**Filed by**: NVR autonomous agent (Scout, Run #35)
**Status**: PENDING HUMAN REVIEW — do NOT auto-merge to TOKEN_REGISTRY
**Option B window**: active until ~2026-06-15. Per CLAUDE.md Rule 1, this proposal replaces a TOKEN_REGISTRY commit.

---

## Candidate: DEUS (XMAQUINA)

| Metric | Value | Threshold | Pass? |
|--------|-------|-----------|-------|
| Contract (Base) | `0x940A319B75861014A220D9c6c144d108552B089B` | — | — |
| Pool liquidity | >$1,000,000 | >$100k | ✅ |
| 24h volume | $9,260,000 | >$50k | ✅ |
| Pool age | 7 days (TGE: May 27, 2026) | >3 days | ✅ |
| Already in registry | No | Not in registry | ✅ |
| Scout quality score | **8 / 10** | ≥6 | ✅ |

### What is XMAQUINA?

XMAQUINA is a DAO building on-chain capital markets for humanoid robotics and Physical AI. The DEUS token launched May 27, 2026 via Aerodrome (Base) and Virtuals Protocol — Aerodrome's first-ever Virtuals-hosted launch. Key facts:

- **Primary pair**: DEUS/VIRTUAL on Aerodrome — $4.63M of the $9.26M 24h volume in this pair alone
- **Liquidity lock**: >$1M locked for 10 years per project announcements
- **CEX listings**: KuCoin and BitMart at launch (May 27, 2026)
- **Category fit**: AI_TOKENS sector (robotics + physical AI, backed by Virtuals Protocol infrastructure)
- **Supply**: 1B DEUS, fixed, no inflation
- **Current price**: ~$0.057 USD

### Score Breakdown (1–10)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Volume consistency | 8 | $9.26M 24h vol at 7 days old; DEUS/VIRTUAL dominant pair |
| Liquidity depth | 8 | >$1M locked; Aerodrome primary venue (50%+ of Base volume) |
| Momentum | 9 | Dual CEX listings day-1; Aerodrome + Virtuals partnership launch (highest-visibility launch format on Base) |
| Category fit | 7 | AI_TOKENS sector — fits NVR's 20% AI allocation target; Physical AI is emerging 2026 narrative |
| **Total** | **8.0** | Exceeds ≥6 threshold |

### Proposed TOKEN_REGISTRY Entry

```typescript
DEUS: {
  address: "0x940A319B75861014A220D9c6c144d108552B089B",
  symbol: "DEUS", name: "XMAQUINA", coingeckoId: "xmaquina",
  sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
},
```

### Risk Flags

- **7 days old** — short track record; high-profile launch does not guarantee sustained liquidity
- **VIRTUAL dependency** — primary pair is DEUS/VIRTUAL; if VIRTUAL weakens, DEUS spreads widen
- **Robotics narrative** — not yet a standard sector; category may not align with the bot's scoring models
- **Option B window** — adding ANY new token during the 30-day benchmark window muddies alpha attribution; recommend waiting until ~2026-06-15

### Recommendation

Add DEUS to TOKEN_REGISTRY **after the Option B window closes (~2026-06-15)** if:
1. 24h volume remains >$200k (sustained depth, not launch hype)
2. Pool age reaches 21+ days
3. No major exploit or rug indicators from community monitoring

---

## Scan Summary (all candidates evaluated)

| Token | Liq | 24h Vol | Age | In Registry | Score | Decision |
|-------|-----|---------|-----|-------------|-------|----------|
| DEUS (XMAQUINA) | >$1M | $9.26M | 7d | No | 8/10 | PROPOSED above |
| AERO | Very high | Very high | Established | **Yes** | N/A | Skip — already in registry |
| WELL (Moonwell) | High | High | Established | **Yes** | N/A | Skip — already in registry |
| SEAM (Seamless) | High | High | Established | **Yes** | N/A | Skip — already in registry |
| Ondo/USDY (RWA) | High | High | Established | No | ~6 | No Base-native pool w/ confirmed $100k liq data available |

*Note: GeckoTerminal and DexScreener APIs are blocked by the egress proxy in this execution environment. Candidate data sourced via WebSearch; live on-chain confirmation recommended before adding.*

---

**Henry**: To act on this proposal, manually add the DEUS entry to `src/core/config/token-registry.ts` after reviewing the on-chain data on Aerodrome / BaseScan. Do not rely solely on this scout's WebSearch data for the final liquidity/volume numbers.
