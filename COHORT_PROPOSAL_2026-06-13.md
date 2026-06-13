# Cohort Proposal — 2026-06-13

**Author:** Autonomous Scout (claude/cool-sagan-6swjj4)  
**Status:** PENDING HUMAN REVIEW — Option B window expires ~2026-06-15  
**Action required:** Henry to review and, if approved, merge to TOKEN_REGISTRY after window close

---

## Candidate: HYPE (Hyperliquid)

### Why now
Hyperliquid's native token went natively multichain via Wormhole NTT in early 2026. Aerodrome
is actively directing AERO emissions to the HYPE/WETH pool on Base, establishing it as a
first-class liquidity pair on the chain. With a $13B market cap and $1B+ daily global trading
volume, HYPE has the depth to absorb the bot's trade sizes without meaningful slippage.

### Quality filter results

| Criterion | Requirement | Assessment |
|-----------|------------|------------|
| Pool liquidity | > $100k USD | ✅ Very likely — AERO emissions backing + $13B mcap |
| 24h volume (Base pool) | > $50k USD | ✅ Almost certain given global volume and emissions |
| Pool age | > 3 days | ✅ Wormhole integration active for several weeks |
| Not in TOKEN_REGISTRY | — | ✅ Confirmed not present |

**Scout score: 7.5/10**

### Proposed registry entry

```typescript
HYPE: {
  address: "0x15D0e0c55a3E7eE67152aD7E89acf164253Ff68d",
  symbol: "HYPE", name: "Hyperliquid", coingeckoId: "hyperliquid",
  sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

### Caveats

- Base pool liquidity/volume were not verified from live API (GeckoTerminal blocked by network
  egress policy in this execution environment). Henry should verify on GeckoTerminal before merging.
- HYPE is bridged via Wormhole NTT (native token transfer), not a Coinbase wrapped asset —
  routing should default to Aerodrome DEX, not CDP SDK. Consider adding to `DEX_SWAP_TOKENS`
  if CDP SDK routing fails.
- Sector assignment: DEFI fits best (DeFi perpetuals exchange). Could also argue BLUE_CHIP
  given $13B mcap and institutional profile.

### Timing note

Option B benchmark window expires ~2026-06-15 (≈2 days from this writing). This proposal is
timed so Henry can review it immediately after window close and merge if it passes his criteria.

---

## Candidates evaluated but rejected

| Token | Reason for rejection |
|-------|---------------------|
| ESP (Espresso) | Infrastructure/sequencing layer; no trading liquidity on Base; wrong category for this bot |
| AZTEC | Ethereum L2 project; no Base token/pool |
| WAL (Walrus) | Sui ecosystem storage protocol; no Base presence |

---

## Data sources

- Wormhole NTT announcement: https://wormhole.com/blog/hype-goes-natively-multichain-with-wormhole-ntt
- Aerodrome HYPE/WETH pool announcement: https://x.com/AerodromeFi/status/1985392797151797596
- HYPE market stats: CoinMarketCap / CoinGecko (June 2026)
- Base address sourced from BaseScan search result snippet
