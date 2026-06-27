# COHORT PROPOSAL — 2026-06-27

**Filed by**: NVR autonomous agent (scout job, Run #35)
**Status**: AWAITING HENRY REVIEW — no TOKEN_REGISTRY changes made
**Branch**: claude/cool-sagan-ik35ur

---

## Why This Exists

Per CLAUDE.md Rule 1, the COHORT_QUALITY_7 is locked and no automated additions to TOKEN_REGISTRY are permitted during the Option B benchmark window. The 30-day window started 2026-05-15 (~2026-06-15 projected close). Even post-window, changes require explicit human PR per CLAUDE.md.

The scout job last ran 2026-05-14 (MOLT addition — 43+ days ago). This proposal documents the scout's 2026-06-27 run in compliance with Rule 1.

---

## Infrastructure Constraint

GeckoTerminal (`api.geckoterminal.com`) remains blocked by the egress proxy (403), as it has been since at least Run #1 (2026-04-14). Pool liquidity, 24h volume, and pool age data from GeckoTerminal are unavailable. WebSearch was used instead. This means **no candidate token passed the full quality filter** (liquidity > $100k, 24h vol > $50k, pool age > 3 days, contract address verified) because these data points require GeckoTerminal or DexScreener API access.

---

## Market Context (June 27, 2026)

| Metric | Value |
|--------|-------|
| BTC price | ~$65k (range $62k–$69k in June) |
| BTC from ATH ($126k, Oct-2025) | -45% |
| ETH price | ~$1,673 |
| Market regime | VOLATILE/CORRECTIVE |
| Base DEX 30-day volume | $12.4B (as of June 3) |
| Aerodrome TVL | $453.76M |

---

## Ecosystem Watch Items (Not TOKEN_REGISTRY Candidates)

### 1. Aerodrome "Aero" Merger — July 2026
Aerodrome and Velodrome are merging into "Aero" in July 2026. MEV-resistant pool migration is underway. This is the primary routing engine for NVR. **No code change needed** — bot auto-benefits from DEX routing improvements. However, if Aerodrome's Slipstream Router contract address changes post-merger, the address in `executeDirectDexSwap` may need updating. Henry should watch Aerodrome's official docs/Discord for contract migration notices.

### 2. AERO Token (Already in Registry)
AERO surged +44% in the week of June 21, 2026 — led altcoin gainers that week. It is already in TOKEN_REGISTRY under DEFI/MEDIUM. Bot should be handling this via normal signal evaluation. No registry change needed.

---

## Candidates Evaluated

| Token | Source | Liquidity | 24h Vol | Pool Age | Address | Score | Decision |
|-------|--------|-----------|---------|----------|---------|-------|----------|
| *(none)* | WebSearch (GeckoTerminal blocked) | ❌ cannot verify | ❌ cannot verify | ❌ cannot verify | ❌ cannot verify | N/A | Cannot qualify — no pool data |

**All candidates rejected**: Pool liquidity, volume, and age data are unverifiable without GeckoTerminal or DexScreener API access. No tokens added.

---

## Action Required from Henry

1. **No immediate action needed** — no tokens proposed for addition.
2. **Optional**: If the Option B window has closed and Henry wants to resume auto-discovery, add `api.geckoterminal.com` and `api.dexscreener.com` to the Claude Code egress allowlist. This would allow the scout to perform verified quality-filter checks in future runs.
3. **Watch**: Aerodrome "Aero" merger July 2026 — confirm routing contract addresses remain unchanged post-merger.

---

## Standards Maintained

- No modifications to `src/core/config/token-registry.ts`
- No modifications to `COHORT_QUALITY_7`
- No push to `main` or `staging`
- Committed to `claude/cool-sagan-ik35ur` only
