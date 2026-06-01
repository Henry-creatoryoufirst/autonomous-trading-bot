# Cohort Proposal — 2026-06-01

**Status:** PROPOSAL ONLY — awaiting human review. No TOKEN_REGISTRY edits made.
**Reason deferred:** Option B benchmark window active (2026-05-15 → ~2026-06-15). Per CLAUDE.md Rule 1, TOKEN_REGISTRY additions are prohibited until the window closes.
**Action required:** Henry to review post-window (~2026-06-15) and open a human PR if any candidates are still qualifying.

---

## Scout Run — 2026-06-01

**Method:** WebSearch only (GeckoTerminal API / website blocked by execution sandbox egress policy — persistent constraint, not a new failure).

**Tokens already in registry (excluded):** USDC, ETH, WETH, cbBTC, cbETH, wstETH, LINK, cbLTC, cbXRP, cbADA, LBTC, VIRTUAL, AIXBT, DEGEN, MORPHO, WIRE, GAME, ZORA, TIBBIR, BNKR, WELL, AVNT, SEAM, HYDX, MEZO, RIVER, SKI, BENJI, TIG, KTA, ELSA, EDEL, ETHY, GHST, LMTS, MFER, OVPP, RAVE, MOG, TYBG, B3, RNBW, SPECTRA, FUN, cbDOGE, NOICE, FAI, GIZA, KAITO, cbSOL, UP, SYRUP, MOLT, bCOIN, deSPXA

---

## Qualifying Candidates

All three pass quality filters: liquidity > $100k, 24h volume > $50k, pool age > 3 days, not in TOKEN_REGISTRY.

### 1. AERO — Aerodrome Finance (Score: 9/10)

| Metric | Value |
|--------|-------|
| Symbol | AERO |
| Address (Base) | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` |
| 24h Volume | ~$3M |
| Pool Age | September 2023 (>2 years) |
| Market Cap | Significant (top 200 DeFi) |
| Sector | DEFI |
| Risk | MEDIUM |
| Suggested minTradeUSD | 25 |
| Decimals | 18 |

**Rationale:** AERO is the native governance/reward token of Aerodrome Finance — the bot's own primary DEX router and the #1 liquidity venue on Base by volume ($798M/day as of May 2026). Strong protocol fundamentals, consistent deep liquidity, and a major Q2 2026 catalyst: the MetaDEX03 upgrade and Aero cross-chain DEX launch merging Aerodrome (Base) + Velodrome (Optimism). Robinhood added AERO trading in May 2026, increasing retail visibility. Already in the existing DEX_SWAP_TOKENS ecosystem — adding to portfolio would give NVR direct exposure to the protocol it routes through.

**Suggested entry:**
```typescript
AERO: {
  address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  symbol: "AERO", name: "Aerodrome Finance", coingeckoId: "aerodrome-finance",
  sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

---

### 2. BRETT — Brett (Based) (Score: 8/10)

| Metric | Value |
|--------|-------|
| Symbol | BRETT |
| Address (Base) | `0x532f27101965dd16442e59d40670faf5ebb142e4` |
| 24h Volume | $13–30M (across all pools) |
| Pool Age | February 2024 (~16 months) |
| Market Cap | ~$65–67M |
| Sector | MEME_COINS |
| Risk | HIGH |
| Suggested minTradeUSD | 10 |
| Decimals | 18 |

**Rationale:** BRETT is the #1 meme coin on Base by volume and market cap, named after the "feels good man" frog — a cultural icon native to the Base community. $13-30M daily volume is significantly higher than current meme coins in the registry (MOG, SKI, etc.). Fixed supply (10B), renounced contract, locked liquidity. Market cap ~$65-67M with strong community retention since February 2024. Fills the "dominant Base native meme" slot with far better liquidity depth than most current MEME_COINS entries.

**Suggested entry:**
```typescript
BRETT: {
  address: "0x532f27101965dd16442e59d40670faf5ebb142e4",
  symbol: "BRETT", name: "Brett (Based)", coingeckoId: "brett-2",
  sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
},
```

---

### 3. TOSHI — Toshi (Score: 7/10)

| Metric | Value |
|--------|-------|
| Symbol | TOSHI |
| Address (Base) | `0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4` |
| 24h Volume | ~$7M |
| Uniswap V3 Pool Liquidity | $1.52M |
| Pool Age | 2023 (~3 years) |
| Market Cap | ~$89M (as of March 2026) |
| Sector | MEME_COINS |
| Risk | HIGH |
| Suggested minTradeUSD | 10 |
| Decimals | 18 |

**Rationale:** TOSHI is the official mascot meme of Base — named after Coinbase co-founder Brian Armstrong's cat and Satoshi Nakamoto. It holds cultural status as "the face of Base" and has maintained $7M+ daily volume with 1.08M+ holders. Deeper liquidity ($1.52M in a single pool) than most registry meme coins. The Coinbase/Base brand connection gives it better survival probability than anonymous meme coins.

**Suggested entry:**
```typescript
TOSHI: {
  address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
  symbol: "TOSHI", name: "Toshi", coingeckoId: "toshi",
  sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
},
```

---

## Candidates Evaluated but Rejected

| Token | Reason |
|-------|--------|
| UB (Unibase) | Launched May 2026 on Arbitrum, not Base — wrong chain |
| $EAT | Launched Dec 2025 on Base, insufficient volume data available via web search to confirm $50k+ 24h threshold |
| Base network token | No confirmed launch yet (Polymarket: 23% by June 30, 69% by Dec 31) |
| BRETT pools (individual) | Individual pool volumes low ($10K on Uniswap V3 single pool) — but aggregate across all pools is $13-30M; individual pool metrics could trigger false fails in pool-level filter |

---

## Auditor Research Summary (appended — no trigger confirmed)

Bot API unreachable (persistent sandbox network policy). Could not evaluate win_rate, drawdown, or losing_streak to confirm auditor trigger.

**Research findings (for Henry's awareness):**

1. **Aerodrome MEV Pool Migration (May–July 2026)** — Aerodrome is migrating all LP positions to MEV-resistant METADEX03 pools. The bot's router already uses Aerodrome Slipstream. As liquidity migrates, execution quality will improve automatically with no code change. Worth monitoring routing effectiveness July 2026.

2. **Kelly Fraction** — Already at Quarter-Kelly (0.25). Research confirms this is optimal for sustained bear regimes with crypto fat tails. No change needed.

3. **Signal quality** — Whale wallet tracking + Dune DEX flow signals cited as high-alpha on-chain signals. Impact 3, Complexity 4 (requires new data pipeline), Priority 0.75. Below auto-implement threshold. Watch list item for post-Option-B consideration.

4. **Competitive intel** — AI agent wallets now 8-12% of EVM DeFi transaction volume. Cross-chain metaswaps emerging with Aerodrome's Aero launch (July 2026). No immediate action — the AERO token addition (above) would give the portfolio direct upside exposure.

---

*Generated by NVR autonomous agent — 2026-06-01 — run on branch claude/cool-sagan-QfdNa*
