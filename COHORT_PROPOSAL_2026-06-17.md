# COHORT PROPOSAL — 2026-06-17

**For:** Henry (human review required — no auto-merge)
**Branch:** `claude/cool-sagan-qo6l4d`
**Scout run:** Yes — >48h since last scout (MOLT added 2026-05-14, OPENX+VEIL reverted 2026-05-16)
**Reason for proposal file (not TOKEN_REGISTRY commit):** CLAUDE.md Rule 1 prohibits `feat(scout)` TOKEN_REGISTRY auto-adds. Cohort changes require explicit human PR. Option B window ended ~2026-06-15.

---

## Limitations This Run

The scout's primary data source (GeckoTerminal API) is blocked by the execution environment's egress allowlist. Specific pool liquidity, 24h volume, and pool age could not be verified for any candidate. Candidates below are derived from WebSearch only and require manual verification before any TOKEN_REGISTRY addition.

---

## Market Context (2026-06-17)

- **Crypto regime shift**: HYPE (Hyperliquid) hit ATH $76.90 on 2026-06-16, up 11.6% in 24h. Broad recovery signals.
- **Base L2 TVL**: $11.2B as of April 2026 (was $2.1B October 2024).
- **Aerodrome TVL**: $602M, dominant Base DEX. Merged with Velodrome under Dromos Labs in late 2025.
- **Virtuals Protocol**: Expanded cross-chain in 2026 with Virtuals Console (no-code agent creation).
- **Coinbase AI agents**: Launched June 11, 2026 — autonomous trading on Coinbase accounts.

---

## Research Findings — Potential Candidates

The following were noted from web research but **cannot be scored 1–10** without verified GeckoTerminal pool data. Henry should manually check each against the quality filter (liquidity >$100K, 24h vol >$50K, pool age >3 days, not already in TOKEN_REGISTRY).

### Already in registry — confirmed active ecosystem tokens
| Symbol | Status |
|--------|--------|
| AERO   | ✅ In registry |
| MORPHO | ✅ In registry |
| WELL   | ✅ In registry (Moonwell, $80M+ TVL, 250K+ users) |
| SEAM   | ✅ In registry (Seamless Protocol leverage tokens Jun 2025) |

### Potential new candidates (unverified)

1. **Dromos token (if any)** — Merged Aerodrome+Velodrome entity "Dromos Labs." If a separate Dromos governance token launched, it would be a high-conviction DeFi candidate given combined TVL scale. Symbol/address unknown from available sources — requires Henry to verify on GeckoTerminal.

2. **cbHYPE (speculative)** — Given Coinbase's pattern of wrapping major L1 assets (cbBTC, cbSOL, cbXRP, cbADA, cbLTC), a Coinbase-wrapped Hyperliquid token on Base is plausible following HYPE's ATH. Not confirmed to exist — Henry to check Coinbase Wrapped asset announcements.

3. **Any Virtuals Protocol agents newly graduated** — Virtuals ecosystem continues expanding. New AI agents with established Aerodrome pools ($100K+ liquidity) that are >3 days old could qualify for AI_TOKENS/HIGH. Already-registered: VIRTUAL, AIXBT, LUNA, CLANKER, VADER, AXR, WIRE, GAME, TIBBIR, BNKR, ELSA, ETHY, MOLT. Check GeckoTerminal `networks/base/trending_pools` for new Virtuals agents not in this list.

---

## Recommended Actions for Henry

1. **Open GeckoTerminal** → `api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1` and check for pools meeting the quality filter that are NOT in TOKEN_REGISTRY.
2. **If any qualify**: Open a human PR adding them via the normal `// === AUTO-DISCOVERED (scout <date>) ===` pattern in `token-registry.ts`.
3. **Review bear-calibrated constants**: Now that Option B window has ended and crypto recovery signals are strong (HYPE ATH), consider whether KELLY_FRACTION=0.25, CONFLUENCE_BUY=27, and HOT_MOVER_MIN_FDV_USD=1M should be partially normalized. See Run #35 auditor findings in MEDIC_REPORT.md.

---

*Filed by automated scout agent. Requires human review per CLAUDE.md Rule 1.*
