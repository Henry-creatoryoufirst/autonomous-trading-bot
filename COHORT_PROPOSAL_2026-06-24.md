# COHORT PROPOSAL — 2026-06-24

**Filed by:** NVR Capital autonomous agent (Run #35)
**Status:** FOR HUMAN REVIEW — Option B window ended ~2026-06-15; cohort changes now eligible via explicit human PR

---

## Scout Summary

The 48-hour scout cadence was exceeded (last confirmed scout: 2026-05-14 MOLT, ~41 days ago).
Full scout research was executed. Result: **no tokens added to TOKEN_REGISTRY this run.**

### Why Nothing Was Added

The Base L2 ecosystem is in a **pre-Beryl pause** as of 2026-06-24:

- **Base Beryl upgrade launches June 25, 2026 (TOMORROW)** at Unix 1782410400 (18:00 UTC)
- Beryl introduces the **B20 native token standard** (B20 Asset + B20 Stablecoin types)
- This is expected to trigger a wave of new RWA, tokenized equity, and stablecoin issuances on Base
- Any pools from this wave are brand-new (< 3 days old) and fail the scout's pool age filter
- Pre-Beryl period shows no new non-cohort tokens with verified Base addresses, >$100K liquidity, >$50K 24h volume, >3 days old, and quality score ≥6

**Standards maintained — no additions forced.** Consistent with CLAUDE.md Rule 1.

---

## Candidates Evaluated

| Token | Category | Status | Reason Not Added |
|-------|----------|--------|------------------|
| B20 Asset tokens (wave) | RWA/Tokenized Stocks | WATCH | Launches June 25 — brand-new pools, fails age filter |
| B20 Stablecoin tokens | Stablecoin | WATCH | Launches June 25 — brand-new pools, fails age filter |
| New Virtuals AI agents (Base) | AI_TOKENS | WATCH | Virtuals Protocol 15,800+ projects; individual new launches lack 3-day pool age and $100K liquidity |
| AERO (Aerodrome Finance) | DEFI | ALREADY IN REGISTRY | Already at `0x940181a94A35A4569E4529A3CDfB74e38FD98631` |

---

## Recommendations for Henry's Review

### 1. Schedule Re-Scout: July 1–3, 2026
The Beryl B20 wave will produce new pools starting June 25. By July 1 (6 days post-launch), surviving pools will have:
- ≥6 days of trading history
- Measurable liquidity and volume data
- Initial price discovery completed

A re-scout on July 1–3 should yield genuine candidates from the RWA/tokenized equity space.

### 2. Watch: Aerodrome/Velodrome Merger ("Aero") — July 2026
- Aerodrome and Velodrome merging into unified "Aero" platform (July 2026)
- Aero will span Base, Optimism, Ethereum mainnet, and Circle's Arc chain
- **Action required post-merger:** Verify Slipstream Swap Router address is unchanged
  - Current: `0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5`
  - If changed, update routing code before trades silently fail

### 3. Watch: Aerodrome Predictive Allocation Model — July 2026
- Replaces weekly gauge-voting with forward-looking demand forecasting
- APR calculations on pools will shift significantly when this activates
- The bot's pool attractiveness scoring may need recalibration post-launch

### 4. RWA Narrative: Structural Tailwind Independent of BTC
- On-chain RWA market: $5.5B (Jan 2026) → $29.2B (Apr 2026) — independent of BTC cycle
- B20 Stablecoin/Asset standard is a direct on-ramp for regulated issuers
- Post-Beryl, watch for tokenized equity tokens (new Backed/Centrifuge-style issuances)
- `deSPXA` (Centrifuge S&P 500) and `bCOIN` (Backed Coinbase Stock) are already in TOKENIZED_STOCKS sector — new B20 entrants would fit here

### 5. Current Bear Market Context
- Bitcoin: ~$63K (June 23, 2026), down ~50% from October 2025 ATH (~$126K)
- 8 months into post-ATH correction
- Analyst consensus: bottom expected Q3–Q4 2026
- Base TVL: $4.63B (holding stable despite BTC decline)
- AI token narrative remains active independently of BTC cycle

---

## For the Cohort (COHORT_QUALITY_7)

No proposals to change COHORT_QUALITY_7 at this time. The current 7-token quality cohort (cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL) is appropriate for the current bear phase.

**Future cohort consideration (post-Q3 2026 recovery, human PR required):**
- Once the BTC bottom is confirmed and the bull recovery phase begins, consider adding 1-2 high-liquidity B20-standard RWA tokens to the TOKENIZED_STOCKS sector if they demonstrate sustained pool depth >$500K and >$200K daily volume.

---

*Filed per CLAUDE.md Rule 1: automated agents write COHORT_PROPOSAL_<DATE>.md rather than committing directly to TOKEN_REGISTRY. Henry reviews and merges via explicit PR.*
