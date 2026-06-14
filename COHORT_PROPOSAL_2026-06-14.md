# Cohort Proposal — 2026-06-14

**Status:** Awaiting Option B window close (~2026-06-15) before any TOKEN_REGISTRY changes.

**Prepared by:** NVR Capital autonomous agent (Scout — Run #35)

---

## Why This File Exists

CLAUDE.md Rule 1 prohibits all TOKEN_REGISTRY modifications during the Option B window
(2026-05-15 → ~2026-06-15). Previous auto-discovers (MOLT, OPENX, VEIL) were reverted.
Candidates discovered by the scout are documented here instead, for Henry to review and
promote via explicit human PR after the window closes.

---

## Scout Execution Status (Run #35)

**GeckoTerminal not accessible** — the Claude Code execution environment egress allowlist
does not include `api.geckoterminal.com`. Pool-level quality metrics (liquidity, 24h volume,
pool age) cannot be verified programmatically from this environment.

WebSearch results about Base trending tokens referenced AERO (already in registry), general
Base ecosystem tokens, and Aerodrome Slipstream upgrades — no specific new token candidates
with verifiable on-chain data were surfaced.

**Recommendation for next manual scout:**
1. Add `api.geckoterminal.com` to egress allowlist, OR
2. Henry checks https://www.geckoterminal.com/base/pools and filters by:
   - Liquidity > $100K
   - 24h volume > $50K
   - Pool age > 3 days
   - Not already in TOKEN_REGISTRY

---

## Tokens to Watch (from June 2026 market context — unverified metrics)

The following were mentioned in June 2026 Base/DeFi coverage. Metrics NOT verified —
these are leads for Henry to check, not confirmed candidates:

| Symbol | Category | Context | Risk |
|--------|----------|---------|------|
| HYPE   | AI/DeFi  | CoinDesk June 2026: gained while BTC/ETH dropped | UNKNOWN — verify Base address + liquidity |
| ARMA   | DeFi     | Giza's yield agent on Base (aave/compound/morpho routing) | MEDIUM — yield protocol, institutional |

**Neither token has been quality-scored.** Pool liquidity and volume unverified.

---

## Recommended Post-Window Actions

Once the window closes (~2026-06-15):

1. **Unlock scout**: Remove cohort-lock restriction from CLAUDE.md Rule 1
2. **Re-run scout with egress access**: Add GeckoTerminal to allowlist and re-run
3. **Constant review**: Evaluate all bear-adjusted constants (KELLY_FRACTION=0.25,
   HOT_MOVER_MIN_FDV_USD=1M, etc.) against the new market regime (F&G=8 extreme fear
   may signal regime shift)
4. **Aerodrome migration**: Monitor Aerodrome's July 2026 pool migration to MEV-resistant
   pools — NVR auto-benefits as trader, no code change needed
5. **On-chain signal integration**: Post-window priority — add exchange inflow/outflow
   scoring as confluence input (see Auditor watch list in MEDIC_REPORT.md)

---

*Filed by: NVR Capital autonomous agent, 2026-06-14*
*Per CLAUDE.md Rule 1 — pending human review and explicit PR*
