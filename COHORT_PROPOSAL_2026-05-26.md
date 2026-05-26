# NVR Cohort Proposal — 2026-05-26 (Scout Run #35)

**Status:** PROPOSAL ONLY — per CLAUDE.md Rule 1, TOKEN_REGISTRY not modified during Option B window (~2026-06-15)

**Run context:** Option B benchmark day 11. GeckoTerminal API unreachable from this execution environment (host not in allowlist — persistent constraint since Run #1). Research conducted via WebSearch only.

---

## Scout Execution Summary

| Step | Result |
|------|--------|
| Last scout commit | 2026-05-16 (~10 days ago — beyond 48h threshold) |
| GeckoTerminal trending pools | BLOCKED (host not in allowlist) |
| GeckoTerminal new pools | BLOCKED (host not in allowlist) |
| WebSearch research | Completed |
| CLAUDE.md Rule 1 check | LOCK ACTIVE — no TOKEN_REGISTRY edits until ~2026-06-15 |

---

## Candidate Evaluation (WebSearch-based, unverified on-chain)

All entries below are from public web sources. On-chain verification (contract address, liquidity, volume, pool age) must be done by Henry or post-Option-B scout with GeckoTerminal access.

### Candidates Reviewed

| Token | Symbol | Source Signal | Registry Status | Notes |
|-------|--------|--------------|-----------------|-------|
| cbBTC-cbADA LP | — | Aerodrome pool ~906% APR (CoinMarketCap, May 2026) | Both tokens IN registry/cohort | Confirms cohort quality; no new token |
| cbBTC-cbXRP LP | — | Aerodrome pool ~634% APR (CoinMarketCap, May 2026) | Both tokens IN registry/cohort | Confirms cohort quality; no new token |
| AERO | AERO | MEV-resistant pool migration ahead of July 2026 Aero launch | IN registry | Liquidity migration context — no add needed |
| Virtuals Protocol ecosystem tokens | Various | AI agents trending on Base (DEXTools 2026) | LUNA, GAME, VADER, AXR, TIBBIR, BNKR, ETHY IN registry | No new Virtuals agents identified with verified data |
| Base meme coins | Various | General trending signal | BRETT, DEGEN, TOSHI, MOG, TYBG, SPX etc. IN registry | No new memes identified with verified liquidity |

### Verdict: No Qualifying New Tokens

**Reason:** GeckoTerminal unreachable means liquidity ($100k+), volume ($50k+), and pool age (3+ days) cannot be verified for any candidate. WebSearch surfaced no specific new token with on-chain data. All trending signals point to existing registry tokens.

---

## Post-Option-B Watch List (for Henry to evaluate ~2026-06-15+)

The following may be worth investigating once the benchmark window closes and GeckoTerminal is accessible:

1. **New Aerodrome pools** — the July 2026 "Aero" cross-chain launch (Aerodrome + Velodrome merge) may surface new high-APR Base pools worth adding to the registry.
2. **cbDOGE momentum** — cbDOGE is in registry; verify current Aerodrome pool liquidity is adequate for active trading.
3. **New Virtuals Protocol AI agents** — the ecosystem has >17,000 agents; any surviving >3 months with $1M+ FDV and $100k+ liquidity merits consideration.

---

## Aerodrome Router Watch Item (for Henry — PRIORITY)

Aerodrome is migrating to MEV-resistant pools ahead of its **July 2026 "Aero" cross-chain DEX launch** (Aerodrome + Velodrome merger). Per May 2026 research:

- LPs must migrate liquidity to new pools to continue earning emissions
- The current Slipstream router at `0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5` may be deprecated at launch
- **If the router contract changes, bot DEX swaps (executeDirectDexSwap) will silently fail or route through empty pools**

**Recommended action (Henry):** Before July 2026, verify the Slipstream router address in `agent-v3.2.ts` against the Aerodrome docs for any announced migration. A one-line address update may be needed before the Aero launch to prevent execution failures.

---

*Filed by: NVR Capital autonomous agent, Run #35, 2026-05-26T UTC*
*Branch: claude/cool-sagan-8F5IQ*
