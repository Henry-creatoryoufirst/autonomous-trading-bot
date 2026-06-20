# Cohort Proposal — 2026-06-20

**Author:** Scheduled scout agent (claude/cool-sagan-oqw540)
**Status:** PROPOSAL ONLY — awaiting Henry review per CLAUDE.md Rule 1
**Note:** GeckoTerminal API was blocked by container egress policy this run.
Quantitative criteria (liquidity >$100k, vol >$50k, age >3 days) COULD NOT
be verified. Everything below is web-search-derived narrative intelligence only.

---

## Ecosystem Signal: Aerodrome → Aero Merger (July 2026)

**What:** Dromos Labs is merging Aerodrome (Base) + Velodrome (Optimism) into a
single cross-chain protocol called **Aero**, targeting July 2026 launch. Key changes:

- Weekly gauge voting replaced by **Predictive Allocation** (June 17 announced)
  — liquidity incentives flow where participants _forecast_ demand, not where it
  previously went. AI agents are explicitly listed as participants.
- MEV-resistant pool migration underway (May 2026)
- Cross-chain: Base + Optimism + Ethereum mainnet unified liquidity

**Impact on NVR:** AERO is already in TOKEN_REGISTRY as a DEFI token. The Aero
merger may rename/reissue the governance token. Henry should watch whether
existing AERO positions need to be migrated or whether a new token address is
issued at Aero launch.

**Source:** [Aerodrome Predictive Allocation announcement, June 14 2026 via CryptoBriefing](https://cryptobriefing.com/aerodrome-predictive-allocation-dex-liquidity/)
[Dromos dethrone Uniswap announcement via DL News](https://www.dlnews.com/articles/defi/aerodrome-devs-target-uniswap-with-new-ethereum-protocol/)

---

## Ecosystem Signal: TRX on Aerodrome via LayerZero (March 2026)

**What:** TRON's TRX was integrated into Aerodrome Base pools via LayerZero bridge
as of March 2026 (TRX/USDC pair live).

**Potential candidate:** TRX is a high-volume, established asset. If the Aerodrome
TRX/USDC pool has >$100k liquidity and >$50k 24h volume, it may qualify for the
expanded TOKEN_REGISTRY (not COHORT_QUALITY_7).

**Not yet verified:** Address, current liquidity depth, volume, pool age.
**Action needed:** Henry or next scout run with GeckoTerminal access should verify.

---

## No New Tokens Proposed for COHORT_QUALITY_7

The Option B 30-day benchmark window closed ~2026-06-15. COHORT_QUALITY_7
changes still require explicit human PR per CLAUDE.md Rule 1. No change proposed.

---

## Scout Data Blocked This Run

GeckoTerminal API (`api.geckoterminal.com`) and web pages returned HTTP 403 from
this container. DeFiLlama, CoinGecko, and DexScreener web pages also blocked.
Full quantitative scout (liquidity, volume, pool age for all trending pools) was
not possible. Next run needs GeckoTerminal egress whitelisted to execute properly.
