# Cohort Proposal — 2026-06-29

**Author:** Scout (automated run, claude/cool-sagan-1y27hb)
**Status:** For Henry's review — NOT auto-added (CLAUDE.md Rule 1)
**Note:** NVR-HQ vault not in this repo checkout; filed here as fallback.

---

## Run Context

- GeckoTerminal API: blocked (403 from remote exec environment)
- Bot API (/api/errors, /api/balances, etc.): blocked (403)
- Token liquidity/volume data sourced from WebSearch only — estimates, not verified on-chain
- Days since last scout commit: 40+ days (last was 2026-05-16, reverted)

---

## Candidates Evaluated

| Symbol | Address (Base) | Market Cap | 24h Vol (est.) | Liquidity (est.) | Pool Age | Score | Decision |
|--------|---------------|------------|-----------------|-------------------|----------|-------|----------|
| cbDOGE | 0xcbD06E5A2B0C65597161de254AA074E489dEb510 | ~$7.4M | unknown | likely <$100k | recent | 3/10 | FAIL — too small |
| UNI    | 0xc3de830ea07524a0761646a6a4e4be0e114a3c83 | ~$2.47B | unknown | unverified | established | ?/10 | DATA GAP |

---

## Candidate Details

### cbDOGE — Coinbase Wrapped DOGE
- Backed 1:1 by DOGE in Coinbase custody; launched alongside cbXRP
- Market cap: ~$7.4M as of 2026-06-22, only 7,925 holders
- Sector fit: BLUE_CHIP (same family as cbBTC, cbXRP, cbADA, cbLTC)
- **Disqualified:** Market cap implies liquidity almost certainly below $100k threshold.
  cbXRP (already in registry) has similar mechanics and is the better representative.
  cbDOGE adds marginal differentiation; DOGE is meme-adjacent, not quality blue chip.

### UNI — Uniswap Governance Token (Base deployment)
- Base address: 0xc3de830ea07524a0761646a6a4e4be0e114a3c83
- Strong global metrics: $2.47B market cap, Uniswap is #1 DEX on Base by volume
- Sector fit: DEFI (alongside AERO, AAVE, MORPHO, CRV)
- **Data gap:** GeckoTerminal blocked — cannot verify Base-specific pool liquidity or
  24h Base DEX volume for UNI token itself (not the protocol). UNI governance token
  trading volume on Base may be thin despite the protocol's dominance.
- **Recommendation:** Henry or a manual check on GeckoTerminal/Aerodrome should
  verify UNI/USDC or UNI/WETH pool on Base has > $100k liquidity before adding.

---

## Broader Ecosystem Notes (for Henry)

1. **Aerodrome → Aero merge (July 2026):** Aerodrome is migrating to a unified "Aero"
   DEX combining Velodrome on OP and Aerodrome on Base. AERO is already in the registry.
   Monitor whether the token symbol/address changes post-merge.

2. **New Virtuals agents:** Thousands of agents launched; none rose to the level of
   verifiable $100k+ liquidity pools in this scan (most are sub-$10M market caps).
   Registry already covers the top agents: AIXBT, VIRTUAL, LUNA, VADER, CLANKER.

3. **Base native token (possible 2026):** Polymarket puts 69% odds on a Base native
   governance token launching by year-end. If/when it launches with strong liquidity,
   it would be a priority addition to DEFI or BLUE_CHIP sector.

---

## API Access Issue (Operational Alert)

**The remote execution environment cannot reach the Railway bot API.**
All calls to `autonomous-trading-bot-production.up.railway.app` return HTTP 403.
This blocks:
- Medic (cannot check error rates or circuit breakers)
- Auditor (cannot check win_rate, drawdown, losing streak)
- Any health monitoring that requires the live API

Root cause candidates:
1. Railway is blocking the execution environment's IP range
2. The bot has an API key / auth layer not configured in the run environment
3. Network policy change in the remote sandbox

**Recommended fix:** Add the runner's IP to Railway's allowlist, or expose a
lightweight unauthenticated `/api/ping` or `/api/health` endpoint that returns
minimal status. Alternatively, configure a `BOT_API_KEY` env var in the runner.
