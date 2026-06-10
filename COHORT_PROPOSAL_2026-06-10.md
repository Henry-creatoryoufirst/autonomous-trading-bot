# Cohort Proposal — 2026-06-10

> Option B lockout active (window closes ~2026-06-15). Automatic scout cannot modify TOKEN_REGISTRY.
> This proposal is for Henry's review. If any token merits addition, merge after the window closes.

## Scout Run — 2026-06-10

**Last scout commit:** 2026-05-16 (25 days ago — threshold: 48h)  
**Note:** GeckoTerminal API unreachable from sandbox (persistent sandbox egress constraint). Research conducted via web search only. On-chain metric verification (liquidity, volume, pool age) requires human review on DexScreener / GeckoTerminal before adding.

---

## Candidates Evaluated

| Token | Category | Est. Liquidity | Est. 24h Vol | Pool Age | In Registry? | Score | Decision |
|-------|----------|---------------|--------------|----------|-------------|-------|----------|
| AERO (Aerodrome Finance) | DeFi | ~$119M | $7.27M | >2 years | ✅ YES | — | Already tracked |
| MORPHO | DeFi | High TVL | High | Established | ✅ YES | — | Already tracked |
| ZORA | AI/Social | Unknown | Unknown | ~14 months | ✅ YES | — | Already tracked |
| CLANKER | AI/Infra | High | High | >1 year | ✅ YES | — | Already tracked |
| AVNT (Avantis) | DeFi/Perps | $5.88M | $23M | Established | ✅ YES | — | Already tracked |
| VIRTUAL | AI | High | $87M | Established | ✅ YES | — | Already tracked |
| RLUSD | Stablecoin | $1.73B circulating | N/A | Added Base Jun 4, 2026 | ❌ NO | N/A | Skip — stablecoin, not a trading target |
| WELL (Moonwell) | DeFi/Lending | High | Moderate | >2 years | ✅ YES | — | Already tracked |
| SEAM (Seamless) | DeFi | Established | Moderate | Established | ✅ YES | — | Already tracked |
| BIFI (Beefy) | DeFi/Yield | Multi-chain | Moderate | Established | ❌ NO | 5/10 | See below |

---

## Watch List — For Henry

### BIFI (Beefy Finance)
- **What it is:** Multi-chain yield optimizer — vaults that autocompound LP positions
- **Why interesting:** Native on Base, Aerodrome integration, yields 8-15% on stablecoin pairs; BIFI is the governance/fee-sharing token
- **Concern:** Yield optimizer tokens have low price momentum; BIFI is more of an income asset than a momentum trade
- **Score:** 5/10 — borderline; would fit DEFI sector
- **Action needed:** Human to verify on DexScreener: pool liquidity >$100k, 24h vol >$50k, pool age >3 days
- **If adding:** `riskLevel: "MEDIUM"`, `minTradeUSD: 25`, `sector: "DEFI"`, `decimals: 18`
- **Base contract:** `0x9e0d7d79735e1c63333128149c7b616a0dc0bbdb` (verify on BaseScan before use)

---

## Macro Observations

- Base DEX weekly volume peaked above Ethereum for first time (driven by Uniswap)
- Aerodrome controls ~52% of Base DeFi TVL ($453M), ~68% of 30-day DEX volume
- Aerodrome + Velodrome merged into "Aero" cross-chain DEX (July 2026 launch planned) — watch for new AERO mechanics
- AI agent tokens (Virtuals ecosystem) remain active; VIRTUAL $87M/day 24h volume
- Potential BASE network token: Polymarket odds at 69% for 2026 launch — if this launches, priority candidate

---

## Recommendation

No new tokens qualify for automatic addition at this time. The registry is comprehensive for current Base activity. Most actively traded Base tokens are already tracked. BIFI is the closest candidate but requires on-chain verification and Henry's discretion given the yield-optimizer category fit.

Review this file after the Option B window closes (~2026-06-15) and decide on BIFI.
