# Cohort Proposal — 2026-06-18

**Prepared by:** Automated Scout (Run #35)
**Status:** Proposal only — requires Henry's review and explicit human PR to act
**Policy basis:** CLAUDE.md Rule 1 — cohort changes require explicit human PR even post-Option-B-window

---

## Context

The Option B 30-day benchmark window ended ~2026-06-15. The scout has been skipped since
2026-05-14 (MOLT, subsequently reverted). The bot is in paper/dry-run mode with no live
capital. GeckoTerminal API is blocked from the scout sandbox, so this proposal is based
on web-search market intelligence rather than live pool data — Henry should verify all
numbers before acting.

---

## Market Conditions (as of 2026-06-18)

From web search intelligence:
- Base chain: ~2.15M transactions/24h, ~$931.9M trading volume (+68% vs prior day)
- Uniswap V3 on Base: ~300K txns/24h, ~$117M 24h vol (+169%)
- PancakeSwap V3 on Base: ~419K txns/24h, ~$109M 24h vol
- Total Base L2 DeFi TVL peaked above $5.6B; Base accounts for ~46.6% of all L2 DeFi TVL
- Aerodrome/Velodrome announced merge in 2026

This is a significant uptick from the 70-day bear market that ran through May 2026. The
+68% volume spike warrants fresh cohort consideration.

---

## Scout Candidates for Henry's Review

### GeckoTerminal data unavailable from sandbox

The sandbox egress policy blocks `api.geckoterminal.com` (403 on all requests), so live
pool liquidity, volume, and age cannot be verified programmatically. The following are
research-based candidates Henry should cross-reference at geckoterminal.com/base/pools
before making any PR.

### Candidate 1 — Virtuals Ecosystem Tokens

The Virtuals Protocol ecosystem continues to generate high volume on Base. Existing
registry entries: VIRTUAL, AIXBT, HIGHER, LUNA, CLANKER, VADER, AXR.

**Suggested lookup:** Check if any Virtuals-launched tokens since May 2026 have established
>$100K liquidity, >$50K 24h vol, and are >3 days old. The Top Virtuals (Base) pools page
at geckoterminal.com/base/virtuals-base/pools would surface these.

### Candidate 2 — cbMEGA (Coinbase Wrapped MEGA)

Flagged in Run #27 (2026-05-04) as a watchlist item — $2.19M 24h vol noted at the time
but address could not be confirmed from sandbox. If still liquid and the address can be
verified on Basescan, this is a BLUE_CHIP LOW candidate alongside the other cbXXX tokens.

**Required verification:** Full contract address, current liquidity, current volume.

### Candidate 3 — Morpho (MORPHO)

Already in `DEX_SWAP_TOKENS` set in token-registry.ts, meaning CDP SDK can't swap it but
Aerodrome DEX can. Consider whether to add it to `TOKEN_REGISTRY` proper as a DEFI MEDIUM
entry (minTradeUSD: 25) for direct DEX trading. Base Morpho is a top-tier DeFi protocol
with substantial TVL on Base.

**Required verification:** Confirm Base address and current pool liquidity.

### Candidate 4 — General Quality Sweep

Given the Option B window is over and the cohort is no longer locked, the following
sectors are underweight relative to targets and merit fresh scouting:

- **DeFi (target 15%):** Current registry has MORPHO (DEX-only), AERO, SYRUP, UP. Post-
  bear, Aerodrome (AERO) itself may warrant addition if not already in TOKEN_REGISTRY.
- **RWAs/Tokenized Stocks (target 5%):** deSPXA is in DEX_SWAP_TOKENS; no active RWA
  tokens in TOKEN_REGISTRY for trading.

---

## Quality Filter Reminders (for Henry's PR)

When evaluating at geckoterminal.com/base/pools, apply:
- Pool liquidity > $100K USD
- 24h volume > $50K USD
- Pool age > 3 days
- Not already in TOKEN_REGISTRY

Entry format (from token-registry.ts):
```typescript
SYMBOL: {
  address: "0x...",
  symbol: "SYMBOL", name: "Full Name", coingeckoId: "coingecko-id",
  sector: "DEFI",           // BLUE_CHIP | AI_TOKENS | MEME_COINS | DEFI | TOKENIZED_STOCKS
  riskLevel: "MEDIUM",      // LOW (established) | MEDIUM (mid-cap) | HIGH (meme/speculative)
  minTradeUSD: 25,          // 10 for memes | 25 for mid-caps | 50 for established
  decimals: 18,             // verify on Basescan
},
```

---

## What the Scout Did NOT Find

No specific tokens passed all quality filters this scan due to GeckoTerminal API
unavailability. This is a research/watchlist proposal, not a confirmed discovery.

The watchlist above should be treated as a starting point for a manual 10-minute check
at geckoterminal.com/base/pools before the next round of capital is deployed.
