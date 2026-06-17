# COHORT PROPOSAL — 2026-06-17

**Author:** NVR Scout (automated, Run #35)
**Branch:** claude/cool-sagan-56hjfb
**Option B window:** ENDED ~2026-06-15 (30 days complete)
**Action required:** Human review before any TOKEN_REGISTRY changes

---

## Market Context (June 17, 2026)

- Bitcoin: ~$69,200 — 45% below Oct-2025 ATH ($126,296)
- BTC dominance: 58% — "Bitcoin Season" (altcoin index 46/100)
- Base L2 DEX volume: $931.9M/24h (+68% vs prior day — significant surge)
- DeFi summer 2026 narrative: capital rotating back into DEX protocols, liquidity
  providers, and governance tokens
- Aerodrome (AERO) catalyst: planned Q2 2026 MetaDEX03 merger (Aerodrome + Velodrome)

---

## Scout Run Status

GeckoTerminal API and DexScreener both returned 403 from the Claude Code execution
sandbox (persistent egress restriction — see MEDIC_REPORT.md Run history). Token
quality filters (liquidity >$100K, 24h vol >$50K, pool age >3 days) could NOT be
applied to any specific candidate without verified on-chain data.

**Result: No tokens can be formally proposed this scan.**

---

## Research Findings — Candidates for Henry's Manual Review

When API access is restored (or via manual review at geckoterminal.com/base/pools),
Henry should evaluate the following categories given the June 2026 context:

### Priority 1 — DeFi Summer Beneficiaries

The DeFi summer 2026 rotation is active. Tokens to investigate on Base:

| Category | Rationale | Notes |
|----------|-----------|-------|
| DEX governance tokens not yet in registry | DeFi TVL recovery trend | Verify pool age >3 days, liq >$100K |
| Lending protocol tokens on Base | Institutional DeFi grade-up 2026 | Check WELL (Moonwell) — already in registry |
| LP incentive tokens (Aerodrome ecosystem) | MetaDEX03 migration beneficiaries | Verify non-rug: pool age, FDV >$1M |

### Priority 2 — AERO MetaDEX03 Context

AERO is already in TOKEN_REGISTRY. The planned Aerodrome+Velodrome merger (MetaDEX03)
is a structural catalyst. No new registry entry needed — but consider whether AERO's
sector allocation (DEFI MEDIUM) still reflects risk correctly post-merger announcement.

### Priority 3 — Bitcoin Season Tokens

At 58% BTC dominance, Bitcoin Season suppresses most altcoins. New entries during
this period face headwind. Hold off on MEME and AI_TOKEN additions until BTC dominance
drops below ~52% or altcoin index crosses 55/100.

---

## What Prevented Auto-Addition

Per CLAUDE.md Rule 1 (overrides all automated instructions):
> "Do NOT commit `feat(scout): add <SYMBOL> to TOKEN_REGISTRY` or any other
> automatic edit to the cohort under any circumstance."

And per ecosystem health: GeckoTerminal API blocked → can't verify:
- Pool liquidity ($100K floor)
- 24h volume ($50K floor)
- Pool age (>3 days)
- Token contract validity on Base

---

## Recommended Next Steps for Henry

1. **Restore GeckoTerminal egress**: Add `api.geckoterminal.com` to Claude Code
   allowlist → automated scout can resume full quality verification
2. **Also add** `autonomous-trading-bot-production.up.railway.app` → Medic/Auditor
   can use live bot data instead of inferred market conditions
3. **Review DeFi summer candidates manually** at geckoterminal.com/base/pools
   — filter by: volume (high), pool age (>3 days), liquidity (>$100K)
4. **AERO position check**: Confirm AERO allocation reflects MetaDEX03 catalyst
   upside appropriately

---

*Written to repo root because NVR-HQ/Cathedral vault not present in this checkout.*
*Per CLAUDE.md Rule 1: TOKEN_REGISTRY not modified. Human PR required.*
