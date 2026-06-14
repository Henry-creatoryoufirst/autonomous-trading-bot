# Cohort Proposal — 2026-06-14

**Filed by:** NVR Capital autonomous agent (Run #35)
**Status:** PROPOSAL ONLY — no TOKEN_REGISTRY edit made (Option B hard rule)
**Action required:** Henry to review after Option B window closes (~2026-06-15)

---

## Context

Scout triggered (last run: 2026-05-25, 20 days ago). GeckoTerminal API inaccessible
from this execution environment (403 Forbidden — network egress restriction). Pool metrics
(liquidity, 24h volume, pool age) cannot be verified programmatically.

Research via WebSearch identified one high-confidence candidate. Cannot score fully
without pool data. Filed here per CLAUDE.md Rule 1 guidance.

---

## Candidate: BASE (Coinbase Base Network Token)

**Launched:** May 2026
**Category:** BLUE_CHIP / L2 ecosystem token
**Why interesting:**
- Coinbase's own L2 network token — deep institutional backing
- Listed directly on Coinbase (immediate liquidity depth)
- 2026 Base network strategy: tokenized markets, stablecoins, developer ecosystem
- High expected trading volume given network's dominant position on L2
- Natural alignment with NVR's Coinbase Smart Wallet + Base infrastructure

**Risk factors:**
- New token (TGE May 2026) — pool age may be <90 days
- Airdrop supply overhang typical for network token launches
- Must verify: pool age >3 days ✓, liquidity >$100k (likely ✓ given Coinbase), 24h vol >$50k (likely ✓)

**Suggested registry entry (if verified):**
```typescript
{
  address: "TBD — verify via Aerodrome/GeckoTerminal",
  symbol: "BASE",
  name: "Base Network Token",
  coingeckoId: "base-token",  // verify
  sector: "BLUE_CHIP",
  riskLevel: "MEDIUM",
  minTradeUSD: 25,
  decimals: 18,
}
```

**Verification steps for Henry:**
1. Check GeckoTerminal: `api.geckoterminal.com/api/v2/networks/base/tokens/{address}`
2. Confirm: liquidity >$100k, 24h vol >$50k, pool age >3 days
3. Confirm: not already in COHORT_QUALITY_7 (it isn't — but should it be?)
4. If verified: add to TOKEN_REGISTRY and consider Tier-2 cohort candidacy post-window

---

## Candidate Table

| Symbol | Found Via | Liquidity | 24h Vol | Pool Age | In Registry | Score |
|--------|-----------|-----------|---------|----------|-------------|-------|
| BASE   | WebSearch | Unverified | Unverified | ~30 days | No | Unscored |

No tokens added this run. GeckoTerminal API blocked. Proposal only.

---

## Note on Option B Timing

The Option B benchmark window closes 2026-06-15 (tomorrow). After the window closes:
- Cohort additions resume normally (with human PR review)
- Scout should run a full GeckoTerminal scan with API access restored
- BASE token is the top candidate to evaluate first

See also: `NVR-Audit-2026-06-14.md` for full strategy audit.
