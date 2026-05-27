# NVR Capital — Cohort Proposal 2026-05-27

**Filed by:** Scout agent (Run #35)
**Status:** PENDING — Henry must review, verify data, and approve before any TOKEN_REGISTRY add
**Constraint:** Option B window active until ~2026-06-15. No auto-adds to COHORT_QUALITY_7.
  TOKEN_REGISTRY additions for non-cohort discovery tokens require Henry sign-off.

---

## Why This Run

Last scout add: 2026-05-16 (MOLT, reverted alongside OPENX + VEIL). 11 days elapsed — well beyond
the 48h scout threshold. GeckoTerminal API is blocked in this sandbox (403 Forbidden, same
persistent egress restriction as bot API), so quality metrics (liquidity, 24h vol, pool age)
are based on web research only — **not verified against live on-chain data**.

Henry: please verify each candidate at:
- https://www.geckoterminal.com/base/pools (trending/new)
- https://api.geckoterminal.com/api/v2/networks/base/tokens/{address}

Quality gate to pass before adding:
- Pool liquidity > $100k USD
- 24h volume > $50k USD
- Pool age > 3 days
- Not already in TOKEN_REGISTRY (see src/core/config/token-registry.ts)

---

## Candidates (Web Research Based — Needs Verification)

### 1. Aero (unified cross-chain DEX token)
- **Status:** Not yet launched — July 2026 expected launch
- **Source:** Aerodrome/Velodrome merger announcement; AERO holders receive 94.5% of new supply
- **Why watch:** Will inherit Aerodrome's $1.3B+ TVL dominance on Base. If/when live, likely
  highest-volume DeFi token on Base. sector=DEFI, riskLevel=MEDIUM
- **Action:** Monitor for launch. DO NOT add until pool age > 3 days and volume > $50k confirmed.

### 2. Hyperliquid (HYPE) on Base
- **Status:** Uncertain — HYPE is primarily on Arbitrum/Hyperliquid L1
- **Source:** Competitive intelligence searches; HYPE is a growing perp DEX native token
- **Why watch:** If Coinbase/Base bridge HYPE to Base, it could have strong volume
- **Action:** Verify Base contract address exists and passes quality gate before considering.

### 3. Base Network Token (working title: BASE)
- **Status:** Speculative — 69% Polymarket probability before Dec 31 2026; not yet launched
- **Source:** CoinGecko learn article; Jesse Pollak confirmed exploration
- **Why watch:** If/when launched, immediate BLUE_CHIP candidate (LOW risk, Coinbase-backed)
- **Action:** Watch Coinbase announcements. Would be highest-conviction add of 2026 if launched.

### 4. cbSUI / cbAVAX / cbPOL (Coinbase wrapped assets)
- **Status:** Unconfirmed Base addresses — no verified contract found
- **Source:** Coinbase wrapped assets page (only cbBTC confirmed at time of search)
- **Why watch:** Coinbase has pattern of launching cbXRP, cbADA, cbSOL, cbDOGE, cbLTC — more
  wrapped assets likely follow as Coinbase expands DeFi bridge offerings
- **Action:** Monitor https://www.coinbase.com/campaigns/wrapped-assets for new launches.

---

## What Is NOT a Candidate

Tokens already in TOKEN_REGISTRY (full list in src/core/config/token-registry.ts). Top Base
ecosystem tokens from research (AERO, VIRTUAL, BRETT, AAVE) are all already registered.

---

## Option B Note

This proposal intentionally contains ZERO TOKEN_REGISTRY edits. Per CLAUDE.md Rule 1:
the COHORT_QUALITY_7 (cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL) is locked until
~2026-06-15. TOKEN_REGISTRY additions for non-cohort scouted tokens still require Henry's
explicit approval — they affect which tokens the bot can trade even outside the quality cohort.

After the 30-day Option B window closes, the scout can resume normal TOKEN_REGISTRY adds
for tokens passing all quality gates.
