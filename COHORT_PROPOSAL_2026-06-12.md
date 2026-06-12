# Cohort Proposal — Post-Option-B-Window Expansion
**Date**: 2026-06-12  
**Author**: NVR Scout Agent (automated research — requires human ratification)  
**Status**: PROPOSED — Do NOT merge during Option B window (ends ~2026-06-15)  
**Target branch for ratification**: review on `claude/cool-sagan-wnqija`, merge to staging only after Henry approves

---

## Context

The 30-day Option B benchmark window ends ~2026-06-15. This proposal captures scout research conducted on 2026-06-12 for Henry's post-window cohort review.

GeckoTerminal API was unreachable from the scout sandbox (network egress restriction), so on-chain liquidity figures below come from WebSearch aggregation only — **not independently verified**. Henry must verify pool liquidity, volume, and contract addresses before any addition.

Current COHORT_QUALITY_7: cbBTC, WETH, cbXRP, cbLTC (HOLD_ONLY), LINK, cbADA, cbSOL.

---

## Candidate Tokens

### Candidate 1: AERO (Aerodrome Finance)
- **What it is**: Governance token of Base's dominant DEX (~$453M TVL, ~$12.4B 30-day volume per CoinMarketCap June 2026)
- **Why interesting**: Deepest native Base liquidity. Aerodrome expanding to Ethereum mainnet and Circle's Arc chain in July 2026 — potential catalyst. MEV-resistant pool migration in progress.
- **Risk**: Governance token price tied to protocol fee revenue and ve(3,3) vote dynamics; can swing with emission schedule changes
- **Estimated sector**: DEFI
- **Estimated risk level**: MEDIUM
- **Scout score**: 7/10 (high liquidity, Base-native, revenue-generating, but emission dilution risk)
- **GeckoTerminal verification needed**: Yes — confirm pool liquidity >$100K, 24h volume >$50K, pool age >3 days on Base
- **Suggested address**: `0x940181a94A35A4569E4529a3CDfB74e38FD98631` (verify before use)

### Candidate 2: $BASE (Base Native Token)
- **What it is**: Native token launched by the Base team in May 2026
- **Why interesting**: Network-native token; airdrop to Base users; high retail attention
- **Risk**: Very new (<30 days old as of this proposal). Airdrop recipients typically sell. High volatility likely. May not meet pool age >3 days filter by margin — needs on-chain verification.
- **Estimated sector**: BLUE_CHIP (if it becomes network collateral) or MEME_COINS (if purely speculative)
- **Scout score**: 4/10 (too new, unproven, airdrop sell pressure)
- **Recommendation**: WATCH LIST — revisit in 30 days once sell pressure clears and price discovery stabilizes
- **GeckoTerminal verification needed**: Yes — also need to confirm contract address and that it's not a fork/scam

### Candidate 3: VIRTUAL (Virtuals Protocol)
- **What it is**: Governance token of Virtuals Protocol on Base — largest AI agent launchpad (15,800+ AI projects, $477M aGDP as of Feb 2026)
- **Why interesting**: AI agent category leader on Base; direct play on NVR's AI_TOKENS sector target. Already in `CDP_UNSUPPORTED_TOKENS` and `DEX_SWAP_TOKENS` sets — meaning the bot already knows about it.
- **Status**: Already in TOKEN_REGISTRY as `CDP_UNSUPPORTED_TOKENS` / `DEX_SWAP_TOKENS` routing sets. Check if full TOKEN_REGISTRY entry exists.
- **Scout score**: N/A — likely already tracked

---

## What Is NOT Recommended

- Any micro-cap meme coin discovered via trending pools — CLAUDE.md audit pass 2 (2026-05-16) and HOT_MOVER_MIN_FDV_USD=1M confirm these are MEV sandwich targets
- Any token with pool age <3 days
- Any token without verifiable on-chain address

---

## Recommended Post-Window Action (for Henry)

1. **Verify AERO on GeckoTerminal**: confirm liquidity, volume, pool age, contract address
2. **If AERO passes filter**: add to TOKEN_REGISTRY with `sector: "DEFI"`, `riskLevel: "MEDIUM"`, `minTradeUSD: 25`, `decimals: 18`
3. **Monitor $BASE**: revisit in 30 days (July 2026) once airdrop sell pressure clears
4. **Fix egress allowlist**: add `autonomous-trading-bot-production.up.railway.app` and `api.geckoterminal.com` so future scout runs can perform proper on-chain verification

---

## Sources
- [Aerodrome June 2026 — CryptoDaily](https://cryptodaily.co.uk/2026/06/aero-base-proxy-liquidity)
- [Aerodrome Finance CoinMarketCap](https://coinmarketcap.com/cmc-ai/aerodrome-finance/latest-updates/)
- [Virtuals Protocol / Base AI agents — WEEX](https://www.weex.com/news/detail/5-best-ai-agents-in-2026-a-beginners-guide-to-cryptos-autonomous-future-689701)
- [Top 4 AI Trading Solutions 2026 — CryptoDaily](https://cryptodaily.co.uk/2026/05/top-4-ai-trading-solutions-redefining-on-chain-execution-in-2026)
