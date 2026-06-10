# Cohort Proposal — 2026-06-10

**Author**: NVR medic/scout/auditor agent (Run #35)
**Status**: RESEARCH COMPLETE — No candidates verified. Cohort locked per CLAUDE.md Rule 1 (Option B window closes ~2026-06-15, 5 days remaining).

---

## Scout Section

### Methodology
- **Primary source**: GeckoTerminal trending + new pools — **BLOCKED** (execution environment egress restriction on `api.geckoterminal.com`)
- **Fallback**: WebSearch for Base L2 trending tokens, new launches, June 2026
- **Last scout run**: 2026-05-15 (Run #34, 26 days ago — well past 48h threshold)
- **GeckoTerminal blocked since**: Run #1 (2026-04-14) — persistent infrastructure constraint

### Candidates Evaluated

| Token | Finding | Action |
|-------|---------|--------|
| AERO (Aerodrome Finance) | Already in TOKEN_REGISTRY (line 279, DEFI MEDIUM, `0x940181a9...`) | Skip |
| GIZA (Giza Protocol) | Already in TOKEN_REGISTRY (line 507, DEFI MEDIUM, `0x590830df...`) | Skip |
| $BASE (Coinbase network token) | Conflicting sources — Coinbase "exploring" a network token per Sep-2025 announcement; no confirmed contract address, no official TGE. WebSearch shows conflicting claims about May 2026 launch. Cannot verify. | Skip — unconfirmed |
| ARMA (Giza autonomous DeFi agent) | Not a tradeable ERC-20 token — it is a strategy protocol (yield optimization agent) by Giza Protocol. | Skip — not a token |
| VELO (Velodrome) | Deployed on Optimism, not Base. Post-merger ("Aero" DEX) will use AERO token which is already in registry. | Skip — wrong chain |

**Result**: No new qualifying tokens identified. All WebSearch-sourced candidates were either already in TOKEN_REGISTRY, had unverified/no contract addresses, or operated on a different chain.

### Post-Window Scout Checklist (for Henry — after 2026-06-15)

When the Option B window closes, run the following before the next scout:

1. **Enable GeckoTerminal egress**: Add `api.geckoterminal.com` to the Claude Code execution environment allowlist. This unblocks all future scout runs and removes the WebSearch fallback dependency.
2. **Check GeckoTerminal trending pools**: `https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1` — look for pools with >$100K liquidity, >$50K 24h volume, >3 days old.
3. **Aero/VELO cross-chain token**: If the Aerodrome+Velodrome merger creates a new unified token beyond AERO, evaluate for addition.
4. **cbDOGE monitoring**: Already in registry (scout 2026-05-01). Monitor liquidity since cbDOGE is a Coinbase-wrapped asset with variable pool depth on Base.

---

## Auditor Section (Run #35 — 2026-06-10)

**Trigger**: Inferred 96-day BEAR market (48h+ threshold continuously met since ~2026-03-06)

**Option B Status**: Window closes ~2026-06-15 (5 days). No constants changed this run. All findings below are DEFERRED pending window close, per CLAUDE.md: "Unattended automated edits to the constants the strategy runs on muddy the alpha attribution."

### Research Findings

#### 1. Signal Quality
- **Search**: "DeFi trading bot confluence scoring on-chain signals alpha 2026"
- **Finding**: 9+ indicator confluence → 68-72% win rate (vs 55-62% for 6-7 indicators). NVR already at NORMAL_CONFLUENCE_BUY=27 with multi-indicator scoring architecture.
- **Impact**: 1 | **Complexity**: 5 (already implemented) | **Priority**: 0.2
- **Action**: No change needed. NVR already implements this pattern.

#### 2. Execution Efficiency — KEY UPCOMING CATALYST
- **Search**: "Aerodrome Slipstream MEV resistant pools cross chain DEX July 2026 gas optimization"
- **Finding**: Aerodrome is migrating all liquidity pools to MEV-resistant format ahead of its July 2026 cross-chain DEX launch (Aerodrome + Velodrome merger → unified "Aero" DEX expanding to Ethereum mainnet and Circle's Arc blockchain). Key elements:
  - **MEV-resistant pool migration**: All LPs must migrate by July or lose AERO emissions. New pools embed MEV auction directly into AMM — protocol captures MEV revenue instead of external bots.
  - **Dynamic fee module**: Temporarily lowers fees at start of each block before restoring standard fees. Reduces NVR's per-trade execution cost automatically.
  - **Cross-chain MetaSwap**: MEV-protected trading across EVM networks from single interface.
- **Impact**: 3 (auto-benefit, 0 lines of code) | **Complexity**: 0 | **Priority**: ∞
- **Action**: No code change needed — NVR auto-benefits through Slipstream routing. **AERO token (already in registry, DEFI MEDIUM) has significant asymmetric upside from July catalyst. Henry: consider whether to raise AERO position ceiling post-window.**

#### 3. Position Sizing
- **Search**: "Kelly criterion volatility adjusted position sizing bear market crypto 2026"
- **Finding**: ATR-based volatility-adjusted Kelly — dynamically reduce position sizes when ATR is elevated. "Volatility targeting through dynamic position sizing based on current volatility estimates automatically reduces risk during dangerous periods and has demonstrated ability to improve risk-adjusted returns across many asset classes." (multiple 2026 sources)
- **Implementation**: Would require adding ATR check to the Kelly sizing call site in agent-v3.2.ts (not a simple constant change).
- **Impact**: 3 | **Complexity**: 3 | **Risk**: medium | **Priority**: 1.0
- **Action**: Watch list for Henry. Does not qualify for auto-implementation (priority < 2.0, complexity 3, touches sizing logic).

#### 4. Competitive Intelligence — TOP ACTIONABLE FINDING
- **Search**: "autonomous DeFi trading bot Base chain alpha strategy optimization June 2026"
- **Finding**: 40% of all on-chain transactions now AI-initiated (Q1 2026 data). ARMA agent processed $3.96B in yield optimization volume. Key gap vs NVR: HOT_MOVER_MIN_VOLUME_H1_USD is at $200K (set at 65-day bear). Now at 96-day bear, Base DEX volume remains suppressed. $200K no longer filtering lowest-conviction pumps — MEV bots can generate $200K h1 volume on thin liquidity. Raising to $250K narrows the false-positive window.
- **Impact**: 2 | **Complexity**: 1 | **Risk**: low | **Priority**: 2.0
- **Status**: **DEFERRED** (Option B window — 5 days remaining)

### Post-Window Implementation (Ready to Execute After 2026-06-15)

```typescript
// constants.ts line 738 — change:
export const HOT_MOVER_MIN_VOLUME_H1_USD = 200_000;
// to:
export const HOT_MOVER_MIN_VOLUME_H1_USD = 250_000; // Bear-adjusted Jun-2026: 200K→250K — 96-day bear; continued Base DEX vol suppression; MEV bots can coordinate $200K h1 pumps on thin pools; $250K requires broader genuine demand signal
```

This is a 1-line change, Impact 2, Complexity 1, Risk low, Priority 2.0. Safe to implement post-window.

---

## Watch List for Henry

| Finding | Action | Complexity | Notes |
|---------|--------|-----------|-------|
| ATR-based Kelly adjustment | Implement post-window | High (code change to Kelly sizing) | Reduces bear-market position sizes dynamically |
| AERO July catalyst | Consider raising AERO position ceiling | Low (1 constant) | Aerodrome cross-chain DEX launch July 2026 |
| GeckoTerminal egress | Add to Claude Code allowlist | Ops (env config) | Unblocks 35 runs of blocked scout capability |
| $BASE token | Monitor for official launch | N/A | No contract address yet; watch for Coinbase announcement |

---

## Cohort Status as of 2026-06-10

The 7-token quality cohort remains unchanged:

| Symbol | Tier | Status |
|--------|------|--------|
| cbBTC | Tier 1 — always-on | Active |
| WETH | Tier 1 — always-on | Active |
| cbXRP | Tier 2 — rotational | Active |
| cbLTC | Tier 2 — rotational | HOLD_ONLY (thin liquidity) |
| LINK | Tier 2 — rotational | Active |
| cbADA | Tier 2 — rotational | Active |
| cbSOL | Tier 2 — rotational | Active |

Window closes ~2026-06-15. After that date, the Scout is authorized to add candidates to TOKEN_REGISTRY via the normal quality-filter process.
