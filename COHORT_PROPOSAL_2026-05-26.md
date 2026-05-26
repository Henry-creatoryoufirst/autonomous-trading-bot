# NVR Cohort Proposal — 2026-05-26

**Status:** PROPOSAL ONLY — Cohort is locked during Option B window (~2026-06-15).  
**Scout run:** 2026-05-26 (previous qualifying scout was 2026-05-16, >10 days ago).  
**Constraint:** CLAUDE.md Rule 1 — No auto-additions to TOKEN_REGISTRY until Option B window closes.  
**GeckoTerminal API:** Blocked from this execution environment (403 on all attempts).

## Research Method

Used WebSearch + prior BASE ecosystem knowledge. Could not verify live liquidity/volume via GeckoTerminal API (blocked). All candidates below are UNVERIFIED against the required filters ($100K liquidity, $50K 24h vol, >3 days pool age) and should be manually validated before any TOKEN_REGISTRY addition.

## Market Context

- BTC at $68K (retraced from $122K ATH) — bull market with correction
- Base TVL rose 23% to ~$7.8B in March 2026 (very active ecosystem)
- Aerodrome processing 85%+ of Base token launches; MEV-resistant pool migration live (May-12)
- Daily trading volume for Clanker-issued AI agent tokens frequently surpasses $300M
- Ethereum Layer-2 adoption (including Base) is a key 2026 bull narrative driver

## Candidate Watch List (for Henry to verify after window closes)

> All require manual verification via GeckoTerminal / DexScreener before any TOKEN_REGISTRY addition.

| Candidate | Thesis | Sector | Risk | Check |
|-----------|--------|--------|------|-------|
| **Aero (cross-chain DEX token)** | Unified Aerodrome+Velodrome launching July 2026. If new token address on Base, may have deep liquidity from day 1. | DEFI | MEDIUM | Verify address + pool age post-launch |
| **Clanker V2 ecosystem tokens** | Daily $300M+ volume; AI agent token issuance. Any Clanker-issued token with 7+ days pool age + $500K FDV qualifies for scout consideration. | AI_TOKENS | HIGH | Screen via GeckoTerminal trending |
| **Any new Coinbase-wrapped asset (cb*)** | cbDOGE, cbSOL, cbXRP pattern — Coinbase continues adding wrapped assets on Base. Check for new cb* additions in May/June 2026. | BLUE_CHIP | LOW-MEDIUM | Monitor Coinbase announcements |

## Why No Additions This Run

1. **Cohort is locked** (CLAUDE.md Rule 1): Token additions muddy Option B alpha attribution during the 30-day benchmark window.
2. **GeckoTerminal API unreachable**: Cannot verify liquidity, volume, or pool age against the required quality filters.
3. **WebSearch results** are not granular enough to confirm specific contracts meet the $100K liquidity / $50K volume / 3-day age requirements.

## Recommended Action for Henry

After the Option B window closes (~2026-06-15):
1. Enable GeckoTerminal API access from the execution environment (allowlist `api.geckoterminal.com`)
2. Re-run the scout — the ecosystem has been very active during the 70-day bear + bull recovery
3. Verify any candidates against the quality filters manually
4. Open a human-reviewed PR to add qualifying tokens to TOKEN_REGISTRY

## Note on MOLT

MOLT (added 2026-05-14) remains in TOKEN_REGISTRY and was NOT reverted. OPENX and VEIL (added 2026-05-16) were reverted. MOLT passed the original filter at time of add — no action needed on existing entries.
