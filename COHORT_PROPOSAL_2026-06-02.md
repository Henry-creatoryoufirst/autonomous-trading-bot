# NVR Scout Cohort Proposal — 2026-06-02

**Status:** PROPOSAL ONLY — not added to TOKEN_REGISTRY  
**Reason:** Option B benchmark window active (2026-05-15 → ~2026-06-15). CLAUDE.md Rule 1 prohibits all automatic TOKEN_REGISTRY edits during this window. Cohort changes require explicit human PR after window closes.

## Scout Run Summary

- **Last scout commit:** 2026-05-25 (8 days ago — past the 48h threshold)
- **GeckoTerminal API:** BLOCKED by network policy (host not in allowlist)
- **Bot API:** BLOCKED by network policy (host not in allowlist)
- **Data source used:** Web search only

## Current COHORT_QUALITY_7 (locked until ~2026-06-15)

| Symbol | Address |
|--------|---------|
| cbBTC  | 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf |
| WETH   | 0x4200000000000000000000000000000000000006 |
| cbXRP  | 0xcb585250f852C6c6bf90434AB21A00f02833a4af |
| cbLTC  | 0xcb17C9Db87B595717C857a08468793f5bAb6445F |
| LINK   | 0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196 |
| cbADA  | 0xcbada732173e39521cdbe8bf59a6dc85a9fc7b8c |
| cbSOL  | 0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c |

## Ecosystem Observations (for Henry's review after window closes)

### Aerodrome / "Aero" Merger (July 2026)
Aerodrome Finance is merging with Velodrome to launch "Aero" — a unified cross-chain DEX — in July 2026. The protocol is migrating liquidity to MEV-resistant pools ahead of launch. This is a material structural change for NVR's primary DEX router.

- **AERO token** (already in TOKEN_REGISTRY) may see significant price action around the merger
- The new MEV-resistant pool architecture may affect our Slipstream routing paths — worth validating post-launch

### AI Agent Tokens (Virtuals ecosystem)
The VIRTUAL/cbBTC Aerodrome pool remains one of the largest by TVL and volume on Base. Virtuals Protocol continues to generate high-volume sub-tokens. No single new candidate had sufficient on-chain data available via web search to propose with confidence.

### cbDOGE / Coinbase Wrapped Assets
Coinbase continues to expand its wrapped asset series. cbDOGE is already in TOKEN_REGISTRY (2026-05-01). Monitor for cbAVAX or other cbX wrappers that might achieve sufficient liquidity.

## No Tokens Recommended for Immediate Addition

Without access to real-time GeckoTerminal pool data (API blocked), NVR cannot verify the liquidity (>$100k), volume (>$50k/24h), and age (>3 days) filters that are required before a token earns a registry entry. Writing a proposal without on-chain verification would violate the quality standard. 

**Action for Henry:** After the Option B window closes (~2026-06-15), run a manual scout query against GeckoTerminal to refresh the candidate list with live data.

## Infrastructure Note

This proposal was written to repo root because the NVR-HQ Cathedral vault is not checked out in this environment. Please move to NVR-HQ/Vault/ if desired.
