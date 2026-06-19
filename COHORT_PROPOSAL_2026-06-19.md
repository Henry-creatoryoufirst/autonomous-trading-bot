# Cohort Proposal — 2026-06-19

**Prepared by:** NVR Capital autonomous agent (Scout, Run #35)
**Branch:** claude/cool-sagan-xgkk23
**Status:** PROPOSAL ONLY — no TOKEN_REGISTRY edits made (CLAUDE.md Rule 1)

## Context

The Token Scout ran because the last scout commit was 2026-05-25 (~25 days ago, well past the 48h threshold). Per CLAUDE.md Rule 1 (Option B benchmark window — cohort locked), automatic adds to TOKEN_REGISTRY are prohibited. This proposal is written to the repo root as a substitute for the "Cathedral vault" (NVR-HQ not in this checkout).

**Critical limitation:** GeckoTerminal API (`api.geckoterminal.com`) and DexScreener are blocked by the Claude Code egress policy. Quality filter criteria (pool liquidity > $100k, 24h volume > $50k, pool age > 3 days) **could not be machine-verified** for any candidate. Henry must manually verify on GeckoTerminal or DexScreener before acting on any proposal below.

---

## Research Performed

### Trending Base Network Activity (WebSearch — June 2026)

- **Base network 24h volume**: ~$931.9M (+68.39% vs prior day as of June 18-19)
- **Top DEXes on Base**: Uniswap V4 ($109M 24h vol), Uniswap V3 ($117M), PancakeSwap V3 ($109M), Aerodrome ($12.4M)
- **Aerodrome AERO**: Surged ~30% June 16-18 following "Predictive Allocation" upgrade announcement and Aerodrome+Velodrome merger (planned July 2026). AERO is already in TOKEN_REGISTRY ✓

### New Protocol Launches on Base

| Candidate | Category | Notes | Already in Registry? |
|-----------|----------|-------|----------------------|
| **SPK** (Spark Protocol) | DeFi | $6.5B TVL, $170M ARR, governance token, launched June 17, 2025. Multi-chain (Sky/MakerDAO lineage). May have Base pool — unverified. | No |
| **HOME** (DeFi.app) | DeFi | All-in-one SuperApp ERC-20, multi-chain incl. Base. Listed Binance/KuCoin/MEXC. 750M tokens, $23.56M unlock June 10, 2026. | No |
| **AXL** (Axelar) | Infrastructure | Cross-chain interop, ~$666M mkt cap. | **Yes — already in registry** |
| **VIRTUAL** | AI Agents | $373M+ mkt cap, 500K+ robot tasks/mo. | **Yes — already in registry** |
| Doppler Protocol | Infrastructure | 90% of new Base pool launches use it. Protocol infra — may have a token, unverified. | Unknown |

### Ecosystem Signals

- **Base MCP**: Coinbase launched "Base MCP" May 2026 — bridges AI tools (ChatGPT, Claude) to on-chain DeFi (Uniswap, Morpho, Moonwell integration). No new token; infrastructure play.
- **ERC-4337 Smart Accounts**: 30M+ live across Ethereum/L2s — strong Base growth signal.
- **Aerodrome + Velodrome merge**: Planned July 2026. LPs migrating now. Consider whether merged platform emits a new governance token.

---

## Candidate Scoring (Provisional — metrics unverified)

| Symbol | Name | Category | Est. TVL/Mkt Cap | Base Pool? | Est. Score | Recommendation |
|--------|------|----------|------------------|------------|------------|----------------|
| SPK | Spark Protocol | DeFi | $6.5B TVL | Unverified | 7/10 (if Base pool exists with $100k+ liq) | **Verify on GeckoTerminal → add if qualifying** |
| HOME | DeFi.app | DeFi | Listed major CEXes | Unverified | 5/10 (multi-chain but Base pool unconfirmed) | Verify volume/age before considering |
| Doppler | Doppler Protocol | Infrastructure | Unknown | Unknown | Unscored | Investigate if it has a token |

---

## Recommended Human Actions

1. **Check GeckoTerminal** → `https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1` — look for pools with $100k+ liquidity, $50k+ 24h vol, and pool age > 3 days that aren't in the current TOKEN_REGISTRY.

2. **SPK on Base**: Search BaseScan or GeckoTerminal for SPK/Spark token contract on Base. If a pool exists with qualifying metrics, it's a strong DeFi add (high TVL, multi-year protocol lineage).

3. **AERO situation**: The Aerodrome→"Aero" rebranding/merge (July 2026) may require updating the AERO registry entry. Check if the token contract address changes.

4. **Option B window**: CLAUDE.md states the 30-day benchmark window ended ~2026-06-15. Today is 2026-06-19. If Henry deems the window closed and lifts Rule 1, the scout can resume direct TOKEN_REGISTRY additions in the next run.

5. **Egress allowlist** (urgent — 35+ consecutive blocked runs):
   - Add `autonomous-trading-bot-production.up.railway.app` to Claude Code egress settings
   - Add `api.geckoterminal.com` to egress settings
   - Without these, Medic cannot detect critical bot errors, Scout cannot verify token quality, Auditor cannot check trigger conditions.

---

## What Was NOT Changed

- TOKEN_REGISTRY: **no edits**
- agent-v3.2.ts: **no edits**
- constants.ts: **no edits**
- staging branch: **not touched** (per CLAUDE.md Rule 2)

All changes committed to `claude/cool-sagan-xgkk23` only.
