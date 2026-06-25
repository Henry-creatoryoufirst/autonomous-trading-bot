# Cohort Proposal — 2026-06-25

**Filed by:** NVR autonomous scout (hourly run #35)
**Status:** Awaiting Henry review — DO NOT auto-merge
**Option B window:** Ended ~2026-06-15 (10 days ago). Per CLAUDE.md Rule 1, cohort changes require explicit human PR regardless of window state.

---

## Candidate: OPG (OpenGradient)

| Field | Value |
|-------|-------|
| Symbol | OPG |
| Name | OpenGradient |
| Category | AI infrastructure / verifiable AI compute |
| Base contract | `0xFbC2051AE2265686a469421b2C5A2D5462FbF5eB` |
| Listings | Binance (TGE launch) + Upbit (June 15, 2026) |
| 24h CEX volume | ~$169M (June 15 listing day, +357% spike); ongoing volume unknown |
| Backing | $9.5M |
| Supply | 1B OPG (fixed) |
| Bridge | LayerZero (Base as reference chain) |
| Base pool (Aerodrome) | **UNVERIFIED** — GeckoTerminal/DEX APIs blocked by proxy |
| Pool age | TGE ~early June 2026 → est. >3 days by June 25 |
| Score | **Tentative 5/10** — strong CEX momentum, Base-native, AI sector fit; penalized for unverified DEX liquidity |

### Why OPG is interesting for NVR
- Deployed on Base as the **reference chain** (not just bridged as an afterthought)
- Verifiable AI compute infrastructure aligns with NVR's AI_TOKENS sector (20% target)
- Binance listing + $9.5M backing suggests institutional quality vs. meme launches
- Category fit: similar to KAITO (AI data), VVV (AI inference) already in registry

### What needs human verification before adding
1. **Aerodrome/Slipstream pool liquidity** — must confirm >$100k USD reserve on Base DEX
2. **24h DEX volume on Base** — must confirm >$50k USD (CEX volume ≠ on-chain)
3. **Pool age** — must confirm the Base pool is >3 days old
4. **Contract verification** — confirm `0xFbC2051AE2265686a469421b2C5A2D5462FbF5eB` is the canonical token (not a bridged wrapper with separate liquidity)

### Suggested registry entry if verification passes
```typescript
OPG: {
  address: "0xFbC2051AE2265686a469421b2C5A2D5462FbF5eB",
  symbol: "OPG", name: "OpenGradient", coingeckoId: "opengradient",
  sector: "AI_TOKENS", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

---

## Candidates Evaluated and Rejected This Run

| Token | Reason rejected |
|-------|----------------|
| STRATO | ICO June 3, 2026 — pool likely <3 days old at time of launch; no volume data |
| HOME (DeFi.app) | TGE June 4, 2026 — pool age borderline; no liquidity data available |
| TEA | TGE June 4, 2026 — too new, no verified Base liquidity |
| HYPE (Hyperliquid) | Not Base-native; operates on its own chain |

---

## Scout Run Constraints This Run

- GeckoTerminal API (`api.geckoterminal.com`) — **blocked by proxy** (connect_rejected: policy denial)
- Bot API (`autonomous-trading-bot-production.up.railway.app`) — **blocked by proxy** (same)
- All WebFetch calls to financial data sites (defillama.com, coingecko.com, geckoterminal.com) — **blocked by proxy**
- Data sourced from WebSearch only (Anthropic infra, not proxy-blocked)

**Impact:** Cannot apply full quality filter (liquidity, volume, pool age) without DEX API access. Scout quality is degraded until egress policy is updated.

---

## Action Required

Henry: To action this proposal, please:
1. Verify OPG on GeckoTerminal Base pools: `https://www.geckoterminal.com/base/tokens/0xFbC2051AE2265686a469421b2C5A2D5462FbF5eB`
2. Confirm pool liquidity >$100k, 24h DEX volume >$50k, pool age >3 days
3. If verified, open a PR adding OPG to `src/core/config/token-registry.ts` using the entry above
4. Merge intentionally — do NOT auto-merge

Also consider:
- Recreating the `staging` branch (see MEDIC_REPORT.md — staging is missing from remote)
- Adding `autonomous-trading-bot-production.up.railway.app` and `api.geckoterminal.com` to the egress allowlist so the scheduled job can actually do its work
