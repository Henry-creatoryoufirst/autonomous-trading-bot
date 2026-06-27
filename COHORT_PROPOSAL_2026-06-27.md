# Cohort Proposal — 2026-06-27

_Filed by NVR Capital autonomous agent (scout run #35) per CLAUDE.md Rule 1._
_Note: NVR-HQ vault not present in this repo checkout; filed here instead._

## Context

- **Option B window**: 2026-05-15 → ~2026-06-14 (COMPLETED — window closed 13 days ago)
- **Last TOKEN_REGISTRY scout add**: 2026-05-14 (MOLT) — 44 days elapsed
- **Scout trigger**: >48h since last run ✓
- **Constraint**: GeckoTerminal, DEXscreener, and bot API all return 403 from this
  execution environment (persistent sandbox egress policy — see MEDIC_REPORT.md, 35
  consecutive runs). Proposals below rely on WebSearch data; contract addresses and
  live pool metrics MUST be verified by Henry before any registry addition.

---

## Candidate 1 — VELVET (Velvet Capital)

| Field | Value | Source |
|-------|-------|--------|
| Symbol | VELVET | DEXscreener / velvet.capital |
| Full name | Velvet Capital | |
| Category | DeFAI — AI-powered on-chain portfolio OS | Falcon Finance, velvet.capital |
| Chain | Base | DEXscreener search result |
| Pool | VELVET/USDC | DEXscreener |
| Est. 24h volume | ~$2.1M | DEXscreener (unverified, snapshot) |
| Est. liquidity | ~$4.0M | DEXscreener (unverified, snapshot) |
| Pool age | Unknown — requires verification | |
| Contract address | **UNVERIFIED — must check basescan.org** | |

**Why it qualifies (qualitative):**
- Velvet Capital is an on-chain DeFAI (DeFi + AI) portfolio management terminal
  built on Base with an AI-powered routing engine and integrated MEV protection
- Directly relevant to NVR's own strategy category — a competitor/complement
- Volume and liquidity metrics (from a single DEXscreener web search result)
  suggest meaningful market depth if verified
- Aligns with AI_TOKENS sector (or DEFI if routing/product focus scores higher)

**Proposed registry entry (PENDING Henry verification):**
```typescript
VELVET: {
  address: "0x<VERIFY ON BASESCAN>",
  symbol: "VELVET", name: "Velvet Capital", coingeckoId: "velvet-capital",
  sector: "AI_TOKENS", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

**Verification checklist (Henry action required):**
- [ ] Confirm contract address on basescan.org/token search for "Velvet Capital"
- [ ] Confirm pool age > 3 days on dexscreener.com/base
- [ ] Confirm 24h volume > $50K and liquidity > $100K (current, not snapshot)
- [ ] Confirm not on DEX_SWAP_TOKENS or CDP_UNSUPPORTED_TOKENS blocklist
- [ ] Score: Volume consistency / liquidity depth / momentum / category fit → 6+ to proceed

---

## Candidate 2 — Aerodrome/Velodrome AERO (post-merger)

**Status: Already in TOKEN_REGISTRY as AERO** ✓

The Aerodrome + Velodrome merger (Dromos Labs, Q2 2026) has completed or is near
completion, unifying both DEXs into a single AERO token across Base, Optimism, and
OP Superchain. NVR already holds AERO — no registry action needed. However:

**Watch list observation for Henry:**
- Post-merger AERO now represents liquidity across multiple L2s, not just Base
- TVL ~$335M at merger (down from bull peaks but stabilizing)
- VELO holders receive 5.5% of merged token; existing NVR AERO position auto-qualifies
- The merger may affect AERO's price correlation with Base specifically — monitor

---

## Tokens Evaluated but Rejected This Cycle

| Symbol | Reason for rejection |
|--------|----------------------|
| GRASS | Strong AI narrative (Nvidia GTC catalyst), but primarily Solana ecosystem — no confirmed Base L2 pool with adequate liquidity found via web search |
| TAO / FET | Not on Base L2 (Ethereum / other chains) |
| BRETT, TOSHI, DEGEN | Already in TOKEN_REGISTRY |
| MORPHO, AAVE, AERO | Already in TOKEN_REGISTRY |

---

## Recommended Action for Henry

1. **Verify VELVET contract address** on basescan.org (search "Velvet Capital token")
2. **Check current DEXscreener pool** at dexscreener.com/base for live liquidity/volume/age
3. **If verified** (all 4 criteria met + score 6+): add to TOKEN_REGISTRY in a human PR
4. **If not verified**: discard this proposal; next scout cycle will re-evaluate with live data

_This proposal was generated with web-search-only data due to sandbox API restrictions.
No TOKEN_REGISTRY commit was made per CLAUDE.md Rule 1._
