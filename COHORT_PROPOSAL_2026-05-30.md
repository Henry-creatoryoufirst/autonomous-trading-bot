# Cohort Proposal — 2026-05-30

**Filed by:** NVR Capital autonomous agent (Run #35 — scout job)  
**Status:** PROPOSAL ONLY — awaiting Henry's review. Per CLAUDE.md Rule 1, no TOKEN_REGISTRY changes during Option B window (~2026-05-15 to 2026-06-15).

---

## Scout Context

- GeckoTerminal API (`api.geckoterminal.com`) remains blocked by egress proxy — 403 on all endpoints.
- Web searches run for trending Base L2 tokens May 2026.
- Last successful scout with TOKEN_REGISTRY add: 2026-05-16 (OPENX + VEIL — later reverted per CLAUDE.md Rule 1).
- Days since last qualifying add: 14 days.

---

## Research Findings (web search, unverified on-chain data)

### Watch List — Cannot Qualify (No Verified Contract / Liquidity Data)

| Token | Notes | Why Not Qualified |
|-------|-------|------------------|
| AAVE on Base | AAVE V3 deployed on Base; major DeFi protocol. High institutional participation (25.77% weekly gain April 2026, $490M volume). | Cannot verify Base contract address or current pool liquidity from blocked environment. DEFI sector. |
| Aero (new token) | Aerodrome+Velodrome merger producing new unified "Aero" token, ~July 2026 launch. AERO holders get 94.5% of supply. Aerodrome is NVR's primary DEX router. | Token not yet launched. Watch for July 2026. |
| HYPE (Hyperliquid) | Up 136% since Jan 2026, TVL $5.16B. | Not on Base — Hyperliquid is its own chain. Cannot trade via Aerodrome. |
| LINK | 260% CCIP volume surge, exchange outflows at 2026 record. Already in TOKEN_REGISTRY. | Already tracked. |

### Why No Token Was Added

1. GeckoTerminal blocked → cannot verify pool liquidity > $100k, 24h volume > $50k, or pool age > 3 days for any new candidate.
2. Web search results confirm macro L2/DeFi trends but don't provide verifiable Base-specific contract addresses.
3. Even if data were available, CLAUDE.md Rule 1 prohibits TOKEN_REGISTRY additions until Option B window closes (~2026-06-15).

---

## Recommendation for Henry

**After 2026-06-15 (Option B window close):**

1. **AAVE on Base** — Verify contract address and Aerodrome pool liquidity. If pool > $100k liquidity and $50k/day volume: strong DEFI candidate (established, audited, real protocol revenue). Risk: MEDIUM. Suggested minTradeUSD: 25.

2. **Aero token (July 2026)** — When the Aerodrome+Velodrome merger completes, the new Aero token will be native to NVR's primary DEX. Monitor launch metrics at aerodrome.finance. If liquidity builds to >$500k within first week: consider as DEFI entry.

3. **Restore GeckoTerminal egress access** — Scout has been unable to do on-chain data verification for 35 consecutive runs. Recommend adding `api.geckoterminal.com` to Claude Code egress allowlist.

---

*Filed to repo root (NVR-HQ vault not present in this checkout). Move to NVR-HQ/Specs when syncing vaults.*
