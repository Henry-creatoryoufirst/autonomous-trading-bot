# NVR Capital — Cohort Proposal 2026-06-18

**Prepared by:** Automated Scout (scheduled hourly run)
**Branch:** claude/cool-sagan-b0l2qh
**Status:** Proposal only — requires Henry's review and explicit human PR to act on

---

## Why This Proposal Exists (Not a Direct Edit)

CLAUDE.md ground rules prohibit automated agents from committing
`feat(scout): add <SYMBOL> to TOKEN_REGISTRY`. The 30-day Option B window
ended ~2026-06-15, but the rule "cohort changes via explicit human PR only"
still applies post-window. This file is the correct output.

---

## Blocker: API + External Data Sources Inaccessible

**All bot API endpoints returned HTTP 403 Forbidden this run:**
- `https://autonomous-trading-bot-production.up.railway.app/api/errors` → 403
- `https://autonomous-trading-bot-production.up.railway.app/api/balances` → 403
- `https://autonomous-trading-bot-production.up.railway.app/` → 403

**External DEX data APIs also returned 403:**
- `https://api.geckoterminal.com/api/v2/networks/base/trending_pools` → 403
- `https://api.dexscreener.com/latest/dex/search` → 403
- `https://www.coingecko.com/en/categories/base-ecosystem` → 403

**Assessment:** This container's outbound network access is restricted to
web search queries only. GeckoTerminal, DexScreener, and CoinGecko direct
fetches are all blocked. Token scouting was conducted via web search results
only — liquidity and volume figures are approximate.

**Bot status (from git history):** The most recent main commit (2026-05-29)
added `/api/admin/liquidate-all` because "Henry is pulling all real capital
out of efficient-peace to run the system on paper until it's proven." The
bot has been in intentional paper-trade mode for ~20 days. No trading
performance data is available for auditing.

---

## Scout Research — Token Candidates

### Quality Filter Applied
- Pool liquidity > $100k USD
- 24h volume > $50k USD
- Pool age > 3 days
- Not already in TOKEN_REGISTRY

---

### Candidate 1: PONKE (Ponke) — RECOMMENDED

| Field | Value |
|-------|-------|
| Symbol | PONKE |
| Name | Ponke |
| Base address | `0x4A0c64af541439898448659AEdcEC8E8e819FC53` |
| BaseScan | basescan.org/token/0x4a0c64af541439898448659aedcec8e8e819fc53 |
| 24h volume | ~$2.5M |
| Liquidity | ~$1.7M |
| Pool age | Q1 2025 entry on Base (15+ months) |
| CoinGecko ID | `ponke` (Solana-origin, bridged via Wormhole) |
| Sector | MEME_COINS |
| Risk | HIGH |
| Market cap | ~$100M (approaching) |

**Quality filter result:** PASSES all criteria
- Liquidity $1.7M >> $100k ✓
- Volume $2.5M >> $50k ✓
- Age 15+ months >> 3 days ✓
- Not in TOKEN_REGISTRY ✓

**Scout score: 7/10**
- Volume consistency: 7 — Active meme with PonkeSwap DEX utility + P2E game roadmap
- Liquidity depth: 8 — $1.7M is solid for a Base meme (comparable to MOG, TYBG)
- Momentum: 6 — Near $100M market cap but meme-category volatility
- Category fit: 7 — MEME_COINS sector has capacity; PONKE is more established than
  several existing registry entries (has Wormhole bridge credibility)

**Risk notes:**
- Solana-origin token; cross-chain bridge adds smart contract risk layer
- Meme coins are inherently speculative; no protocol utility beyond PonkeSwap
- MEME_COINS sector already has 15 entries — consider whether incremental
  registry additions add meaningful alpha vs. spreading attention further

**Proposed TOKEN_REGISTRY entry (if Henry approves):**
```typescript
PONKE: {
  address: "0x4A0c64af541439898448659AEdcEC8E8e819FC53",
  symbol: "PONKE", name: "Ponke", coingeckoId: "ponke",
  sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
},
```

---

### Tokens Evaluated But Not Qualifying / Not Recommended

| Token | Reason |
|-------|--------|
| cbSUI | No Coinbase-wrapped SUI found on Base (product not yet launched as of searches) |
| TYBG | Already in TOKEN_REGISTRY |
| MOG | Already in TOKEN_REGISTRY |
| cbMEGA | Could not confirm Base address or liquidity depth via available search tools |
| New Virtuals agents | Cannot evaluate — GeckoTerminal blocked, no pool-level data |

---

## Monitoring Recommendation

The API being inaccessible from this scheduled agent is a structural problem:
the hourly Medic job cannot assess bot health without API access. Henry should
either:
1. Set `API_AUTH_TOKEN` as an env var accessible to the scheduled agent, OR
2. Add an unauthenticated `/api/ping` health endpoint (status + version only, no
   sensitive data) for monitoring use

---

## Action Required from Henry

1. **Verify PONKE Base address** on BaseScan before acting
2. **Decide if PONKE merits a PR** to add to TOKEN_REGISTRY (not COHORT_QUALITY_7)
3. **Decide when to re-enable live trading** — bot has been in paper mode 20 days
4. **Consider API access for the monitoring agent** (see above)

*Scout ran: 2026-06-18. Next scout window: 48h (2026-06-20).*
