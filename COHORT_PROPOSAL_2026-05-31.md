# Cohort Proposal — 2026-05-31

**Status:** PROPOSED — awaiting human review. NOT added to TOKEN_REGISTRY per CLAUDE.md Rule 1 (Option B window active until ~2026-06-15).

**Scout run:** This scout ran because the last scout commit with "scout" in the message was 2026-05-25 (6 days ago, > 48h threshold). However, under CLAUDE.md Rule 1 the cohort is locked — auto-discovery results are filed here rather than committed to `src/core/config/token-registry.ts`.

---

## Candidates Evaluated

| Symbol | Name | Sector | Liquidity | 24h Vol | Pool Age | Score | Decision |
|--------|------|--------|-----------|---------|----------|-------|----------|
| AERO | Aerodrome Finance | DeFi | $1.3B TVL | $50M+ daily | 800+ days | 8/10 | PROPOSED |
| BRETT | Brett (Base meme) | Meme | Unknown from sandbox | Unknown | 400+ days | 5/10 | WATCH |
| HYPER | Bitcoin Hyper | Unknown | Unverifiable | Unverifiable | New | 2/10 | REJECTED |
| MAXI | Maxi Doge | Meme | Unverifiable | Unverifiable | New | 1/10 | REJECTED |

**Note:** GeckoTerminal API (`api.geckoterminal.com`) is not reachable from this execution sandbox. Liquidity/volume figures for AERO are sourced from web research (CoinMarketCap, Aerodrome Finance docs). Exact pool-level metrics could not be verified live.

---

## Top Proposal: AERO (Aerodrome Finance)

**Rationale:**
- Aerodrome is the dominant DEX on Base — $1.3B TVL, ~70% of all Base DEX liquidity, $50M+ daily volume as of May 2026.
- Third-largest DEX by volume globally at $798M (trailing only Uniswap and PancakeSwap) as of May 28, 2026.
- Pool age: launched 2023, 800+ days old — far exceeds the 3-day minimum and the tightened 48h HOT_MOVER_MIN_POOL_AGE_HOURS.
- NVR already routes trades through Aerodrome Slipstream — AERO itself would trade on its home network with minimal slippage.
- AERO accrues 100% of protocol fees (ve-tokenomics) — strong fundamental demand driver regardless of market regime.
- Market regime note: DEX token fundamentals tend to hold better than pure memes in extended bear markets because trading volume (and thus fees) continues on both sides.

**Proposed registry entry:**
```typescript
AERO: {
  address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
  symbol: 'AERO',
  name: 'Aerodrome Finance',
  sector: 'DEFI',
  riskLevel: 'MEDIUM',
  minTradeUSD: 25,
  decimals: 18,
  description: 'Native token of Aerodrome Finance — dominant Base DEX, 70% of Base liquidity'
},
```

**Quality score: 8/10**
- Volume consistency: 9/10 (consistently $50M+ daily, protocol earns fees from both bull and bear)
- Liquidity depth: 9/10 ($1.3B TVL on-protocol)
- Momentum: 6/10 (bear market headwinds; DEX volume down from $159B peak in Oct 2025 to $6.05B as of May 2026)
- Category fit: 8/10 (DEFI target 15%; AERO is a quintessential DeFi infrastructure token)

**Henry's decision required.** When Option B window closes (~2026-06-15), add AERO to TOKEN_REGISTRY via PR if this cohort proposal is approved.

---

## BRETT (Brett Base Meme)

CoinGecko identifies Brett as one of the "Top 5 projects on Base Network" by market cap. However:
- Cannot verify live liquidity / volume from this sandbox.
- MEME_COINS sector is currently at 15% allocation target — already in the cohort via existing meme entries.
- Score 5/10 — does not meet 6+ threshold for proposal.
- Status: **WATCH** — revisit after Option B window when direct GeckoTerminal API access is available.

---

## Rejected Candidates

- **HYPER (Bitcoin Hyper)**: New listing, unverifiable liquidity, no pool age data. Score 2/10.
- **MAXI (Maxi Doge)**: Speculative memecoin listing candidate. Score 1/10.

---

*Filed by automated scout run #35 — 2026-05-31. Commit this to `claude/cool-sagan-GL3V4` only.*
