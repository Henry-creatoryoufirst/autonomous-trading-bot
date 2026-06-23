# NVR Scout Proposal — 2026-06-23

**Status:** Proposal only — per CLAUDE.md Rule 1, no TOKEN_REGISTRY edits were made.
Human review and explicit PR required before any addition.

---

## Context

Scout ran 2026-06-23. Last scout commit was 2026-05-25 (29 days ago).
GeckoTerminal and DexScreener APIs returned 403 Forbidden from this container;
pool data was gathered via WebSearch + public sources.

---

## Candidates Evaluated

| Symbol | Address (Base) | Market Cap | Notes | Pool Liquidity | Pass? |
|--------|---------------|------------|-------|----------------|-------|
| HYPE | `0x15D0e0c55a3E7eE67152aD7E89acf164253Ff68d` | $17.55B | Bridged from Hyperliquid L1 via Wormhole | **Unconfirmed** | ❓ |
| cbMEGA | `0xcb111e6a2a3bde90856d299d61341ac302167d23` | ~$1.7M | Coinbase Wrapped MEGA, 725 holders | Likely <$100k | ❌ |

---

## HYPE — Hyperliquid (Manual Verification Needed)

**Why it's interesting:**
- Hyperliquid is the dominant on-chain perps exchange as of mid-2026 ($17.55B market cap, $556M 24h volume on its own L1)
- HYPE is bridged to Base via Wormhole: `0x15D0e0c55a3E7eE67152aD7E89acf164253Ff68d`
- Also appears on Uniswap/Base at: `0x2a65b29dd6933faf82c5c642ac7468ac72c60749` ("Based Hyperliquid")
- Could fit AI_TOKENS or DEFI sector

**Why it may NOT qualify:**
- Primary liquidity is on Hyperliquid L1, not Base
- Base bridge inflow over 90 days (Mar-Jun 2026) was only ~$1.35M total across all assets
- HYPE's Base DEX pool liquidity is almost certainly thin (<$100k), failing the scout filter
- June 6 token unlock: 238M HYPE tokens (~$16B) distributed to core contributors — supply shock risk

**Recommendation:** Henry should check Aerodrome / GeckoTerminal for HYPE/USDC pool liquidity
on Base directly. If pool > $100k and >$50k 24h volume, HYPE (DEFI, MEDIUM risk) is a
strong candidate. Do NOT add until verified.

---

## cbMEGA — Rejected

- $1.7M total market cap as of 2026-05-23, 725 holders
- Pool liquidity almost certainly under $100k
- Does not meet quality threshold

---

## Aerodrome → Aero Merger (Strategic Note)

Aerodrome and Velodrome are merging into "Aero" in July 2026. The new token replaces AERO.
Existing AERO holders receive 94.5% of new supply. The bot's current AERO position will
need attention when this migration happens. Henry should review the migration mechanics
and decide whether to:
1. Hold AERO through the migration (automatic conversion)
2. Exit before July upgrade

AERO is already in TOKEN_REGISTRY — no registry change needed, but this is operationally
significant.

---

## What Wasn't Checked (Due to API Access)

The following could not be verified from this container due to network egress policy:
- GeckoTerminal trending/new pools for Base
- DexScreener Base chain volume rankings
- Full Aerodrome pool list

Henry: to manually scout, check:
- `https://www.geckoterminal.com/base/aerodrome-base/pools` (sort by 24h volume)
- `https://dexscreener.com/base` (filter >3 days old, >$100k liquidity)

---

## Infrastructure Issue — Bot API Inaccessible

All bot API endpoints (`/api/errors`, `/api/balances`, `/api/health`) returned 403 Forbidden
from WebFetch, and the Railway domain is blocked from direct curl by this container's network
egress policy. The routine **cannot monitor bot health** from this environment.

This means:
- Medic cannot assess failure rates or recent error patterns
- Auditor cannot evaluate win_rate, drawdown, or losing streak
- This is a recurring blind spot for every scheduled run

**Recommendation:** Add Railway's production URL to the container's network egress allowlist,
or expose a health webhook (e.g., Telegram ping on error) as a secondary signal.
