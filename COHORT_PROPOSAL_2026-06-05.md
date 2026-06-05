# NVR Cohort Proposal — 2026-06-05

**Written by:** NVR Scout (automated agent, `claude/cool-sagan-9W26G`)
**Status:** PROPOSAL ONLY — Option B window active until ~2026-06-15. Cohort is locked per CLAUDE.md Rule 1. No TOKEN_REGISTRY changes made.

---

## Scout Run — Constraints This Session

The remote execution environment's network policy blocked outbound connections to:
- `autonomous-trading-bot-production.up.railway.app` (bot health API, medic job)
- `api.geckoterminal.com` (trending/new pool data, scout quality filter)

**Result:** The scout could not perform the standard GeckoTerminal quality filter (liquidity > $100k, 24h vol > $50k, pool age > 3 days, not in registry). WebSearch was used for general market intelligence only. No specific token candidates could be verified to the quality bar this run.

---

## Market Intelligence (from WebSearch — June 2026)

### Base Ecosystem Health
- Base is the #1 Ethereum L2 by DeFi TVL (46.6% of all L2 DeFi liquidity)
- 7–10M daily transactions
- Aave: $44.9B deposits, $17.8B active loans, $73.9M monthly fees
- Morpho: liquidity doubled in recent months
- AI agent ecosystem and NFT/social applications growing strongly

### No New Qualifying Candidates Identified
Without GeckoTerminal API access, specific pool metrics (liquidity depth, 24h volume, pool age) could not be verified. General search results returned category-level data (Aave, Morpho, Aerodrome) — all already in TOKEN_REGISTRY.

**Recommendation:** Re-run scout with GeckoTerminal access after the Option B window closes (~2026-06-15) and full API connectivity is available.

---

## CRITICAL WATCH ITEM — Aerodrome/Velodrome Merger

**Finding:** Aerodrome Finance and Velodrome Finance are merging into a unified cross-chain DEX called **"Aero"**, targeted for July 2026 launch.

**What this means for NVR:**
- The Aerodrome Slipstream router (`0xbe6d8f0d...5be6d18a5`) handles >50% of bot trade volume
- LPs must migrate to new MEV-resistant pools — existing pool addresses may change
- AERO holders receive new token distribution (94.5% to current AERO holders)
- The new protocol will expand to Ethereum mainnet and Circle's Arc
- TVL has dropped from $501M (January) to $312M currently — migration-related LP withdrawal

**Risk:** If NVR's swap routing hits deprecated Slipstream pools after the migration, swaps will fail or see elevated slippage.

**Action required (for Henry):** Before July 2026:
1. Monitor Aerodrome migration announcements for new router contract addresses
2. Update the Aerodrome router address in `agent-v3.2.ts` when published
3. Consider temporarily increasing slippage tolerance (to 3-4%) during the migration window
4. Watch AERO token for potential post-merger volatility entry

**Sources:**
- [Aerodrome Finance Latest News — CMC](https://coinmarketcap.com/cmc-ai/aerodrome-finance/latest-updates/)
- [Aerodrome & Velodrome Merge in 2026 — HashBasis](https://www.hashbasis.xyz/blog/aerodrome-velodrome-protocols-set-to-merge-in-2026)
- [AERO Base Proxy Problem — CryptoDaily](https://cryptodaily.co.uk/2026/06/aero-base-proxy-liquidity)

---

## Tokens Currently in Registry (COHORT_QUALITY_7)

As required by Option B rules, the 7-token quality cohort remains unchanged:
| Symbol | Address | Tier |
|--------|---------|------|
| cbBTC | 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf | Tier 1 — always-on |
| WETH | 0x4200000000000000000000000000000000000006 | Tier 1 — always-on |
| cbXRP | 0xcb585250f852C6c6bf90434AB21A00f02833a4af | Tier 2 — rotational |
| cbLTC | 0xcb17C9Db87B595717C857a08468793f5bAb6445F | Tier 2 — rotational (HOLD_ONLY) |
| LINK | 0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196 | Tier 2 — rotational |
| cbADA | 0xcbada732173e39521cdbe8bf59a6dc85a9fc7b8c | Tier 2 — rotational |
| cbSOL | 0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c | Tier 2 — rotational |

---

## Post-Window Scout Checklist (after ~2026-06-15)

When the Option B window closes, the next scout should check:
1. Any new Coinbase-wrapped tokens on Base (cbDOT, cbATOM, cbSUI — these would fit quality cohort criteria)
2. KAITO (already in registry) performance vs quality bar
3. New DeFi protocols with $500k+ TVL that launched since May 2026
4. Aero token (post-merger AERO) — may qualify as a DEFI sector addition if liquidity is sufficient
5. Any new RWA tokens via Centrifuge or Backed on Base (thin TOKENIZED_STOCKS sector)
