# Cohort Proposal — 2026-06-10

**Prepared by:** NVR Scout Agent (claude/cool-sagan-h2puwp)
**Status:** PROPOSAL ONLY — awaiting Henry's review. Option B window is active (~closes 2026-06-15). NO changes made to TOKEN_REGISTRY per CLAUDE.md Rule 1.

---

## Why This File Exists

CLAUDE.md Rule 1 prohibits scout-driven auto-edits to `TOKEN_REGISTRY` during the 30-day Option B benchmark window (2026-05-15 → ~2026-06-15). Per that rule, candidates are written here for human review rather than committed directly. The window closes in ~5 days; this proposal is timed for Henry's decision at window close.

---

## Scout Run: 2026-06-10

**Last scout commit:** 2026-05-25 (16 days ago — well past the 48h threshold)

**Data sources attempted:**
- `api.geckoterminal.com` trending/new pools → 403 (network policy)
- `geckoterminal.com` web pages → 403
- `api.dexscreener.com` → 403
- WebSearch (fallback) → ✅ used

---

## Candidates Evaluated

| Symbol | Name | Address | 24h Vol | Liquidity | Pool Age | In Registry? | Score | Verdict |
|--------|------|---------|---------|-----------|----------|-------------|-------|---------|
| **cbMEGA** | Coinbase Wrapped MEGA | `0xcb111e6a2a3bde90856d299d61341ac302167d23` | ~$578K ✅ | Unconfirmed* | ~41 days ✅ | ❌ New | **7/10** | **RECOMMEND** |
| H1DR4 | H1DR4 by Virtuals | `0x83abfc4beec2ecf12995005d751a42df691c09c1` | ~$1.5K ❌ | ~$61 ❌ | ~1yr ✅ | ❌ New | 2/10 | REJECT |
| PRL | Pearl Research | `0xed55c02068a89e764f9fa99d24baae0873f1bba3` | ~$0 ❌ | ~$21K ❌ | ~44 days ✅ | ❌ New | 2/10 | REJECT |

*cbMEGA liquidity: not confirmed >$100k from search results, but $578K/day volume on Aerodrome Slipstream + Uniswap V4 strongly implies deep pool. **Verify on-chain before adding.**

---

## Recommended Addition: cbMEGA

### Token Details
| Field | Value |
|-------|-------|
| Symbol | `cbMEGA` |
| Name | Coinbase Wrapped MEGA |
| Address (Base) | `0xcb111e6a2a3bde90856d299d61341ac302167d23` |
| CoinGecko ID | `coinbase-wrapped-mega` |
| Sector | `BLUE_CHIP` |
| Risk Level | `MEDIUM` |
| Min Trade USD | `25` |
| Decimals | `18` (⚠️ unverified — confirm on BaseScan before committing) |

### Rationale
- **Coinbase 1:1 backing**: Same quality tier as cbXRP, cbADA, cbDOGE already in registry. Counterparty risk is Coinbase custody.
- **MegaETH**: EVM-compatible high-performance L2 that launched April 30, 2026. Listed on 13 major exchanges at TGE including Binance, Coinbase, OKX. $1.65B FDV at launch.
- **Volume**: $578K/24h on Base DEXes (Aerodrome Slipstream + Uniswap V4) — consistent with mid-tier Coinbase wrapped assets.
- **Pattern fit**: Extends NVR's BLUE_CHIP Coinbase-wrapped roster. cbXRP, cbADA, cbLTC were similar thesis adds.
- **Price note**: Dropped ~70% from TGE ($0.156 → ~$0.046) — typical for new L2 tokens. Long position aligns with mean-reversion and BLUE_CHIP hold thesis rather than momentum.

### Risk Factors
- MEGA circulating supply only 11.3% at launch; heavy unlock schedule ahead → selling pressure risk
- MegaETH is a newer L2 (not battle-tested like Ethereum/Base)
- Price has retraced heavily — if strategy takes a position, size conservatively

### Proposed Registry Entry (do NOT commit until Henry approves and Option B window closes)
```typescript
cbMEGA: {
  address: "0xcb111e6a2a3bde90856d299d61341ac302167d23",
  symbol: "cbMEGA", name: "Coinbase Wrapped MEGA", coingeckoId: "coinbase-wrapped-mega",
  sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

### Pre-Commit Checklist (Henry must verify)
- [ ] Confirm decimals on BaseScan: `basescan.org/token/0xcb111e6a2a3bde90856d299d61341ac302167d23`
- [ ] Confirm pool liquidity >$100k on Aerodrome (GeckoTerminal → Base → Aerodrome → search cbMEGA)
- [ ] Confirm MEGA unlock schedule is acceptable (next unlock not within 30 days)
- [ ] Confirm CDP SDK can route cbMEGA (test `/api/test-swap` if available) — may need `DEX_SWAP_TOKENS` flag

---

## Rejected Candidates

**H1DR4 by Virtuals** — Virtuals AI agent. Liquidity $61, 24h volume $1,500. Far below quality thresholds. Pass.

**Pearl Research (PRL)** — AI compute L1. Liquidity $21K, 24h volume ~$0. Thin liquidity, trading activity dried up after May ATH. Pass.

---

## Note: API Access Blocked This Run

All bot API endpoints (`/api/errors`, `/api/balances`, `/api/portfolio`, `/api/trades`) returned 403 Forbidden from this Claude Code environment. The `API_AUTH_TOKEN` env var is set on Railway but not in this container. **Medic and Auditor jobs could not access live bot metrics this run.** Henry should check Railway dashboard for any alerts.
