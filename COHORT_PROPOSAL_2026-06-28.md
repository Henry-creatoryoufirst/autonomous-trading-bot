# Cohort Proposal — 2026-06-28

**Filed by**: NVR Capital autonomous agent (Run #38)  
**Per CLAUDE.md Rule 1**: No auto-add to TOKEN_REGISTRY. This is a research proposal for Henry's review.  
**Option B window**: Closed ~2026-06-15 (13 days ago). Cohort changes require explicit human PR.

---

## Scout Status

GeckoTerminal API (`api.geckoterminal.com`) remains blocked by the Claude Code execution environment's egress proxy (403). This is the 43rd+ run with the same block. No direct pool data available.

**Last token added**: MOLT (2026-05-14, 44 days ago). Scout overdue by 42+ days past the 48h cadence.

---

## B20 Token Standard — Opportunity Assessment

Base's Beryl upgrade activated June 25, 2026, introducing the **B20 native token standard**. Tokens are now 3 days old (just past the pool-age filter threshold of >3 days).

### B20 Architecture
- Tokens are Rust precompiles baked into Base's node, **not ERC-20 smart contracts**
- Factory address: `0xB20F000000000000000000000000000000000000`
- B20 token addresses have a structural `0xb2` prefix
- Compatible with existing wallets, DEXes, and CEXes

### Target Audience (Important)
**B20 is targeted at regulated issuers — stablecoins and RWAs — not retail meme/DeFi tokens.**  
Features: role-based access control, supply caps, freeze-and-seize, compliance policy registry.

This means the expected wave of new tradeable tokens is primarily:
- New stablecoins from regulated issuers
- Tokenized real-world assets (similar to existing `deSPXA` in TOKEN_REGISTRY)
- Potentially compliant versions of existing DeFi tokens

The meme/speculative token flood some predicted may not materialize as ERC-20 alternatives since B20's killer feature is compliance tooling, not cost reduction for retail launches.

### NVR Positioning
NVR already has `deSPXA` (Centrifuge S&P 500 RWA, `TOKENIZED_STOCKS` sector). The Bot is already positioned for the RWA category that B20 primarily targets.

### Recommendation
- **Watch**: New B20-native stablecoin pools on Aerodrome/Aero post-July merger (could carry high volume + deep liquidity)
- **No action now**: B20 tokens are 3 days old — insufficient liquidity history to meet pool-age + volume filters reliably
- **Check manually**: Visit `https://www.geckoterminal.com/explore/new-crypto-pools/base` and filter for pools created June 25+, liquidity >$100k, 24h vol >$50k

---

## Aerodrome → Aero Migration Risk (HIGH PRIORITY — ACTION NEEDED)

**Status**: Active liquidity migration in progress. July 2026 is the deadline for LPs to move funds.

### Impact on NVR Bot
The bot routes ~50%+ of DEX trades via:
- `src/core/config/chain-config.ts` → `aerodromeSlipstream.router: '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5'`
- `agent-v3.2.ts:6551` → `AERODROME_SLIPSTREAM_ROUTER`

As LPs migrate from old Slipstream pools to new MEV-resistant pools:
1. Existing pool liquidity will thin → higher slippage → DEX swap failures
2. A new router address may be needed post-Aero launch
3. Pool-level token emissions stop on old pools → further LP exodus

### Risk Level
**HIGH** — affects execution path for most trades. Could manifest as Pattern A or Pattern B medic errors (Insufficient balance, allowance failures from thin pools).

### Recommended Actions (Henry)
1. **Verify router address continuity**: Check whether `0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5` (current Slipstream router) maps to the new Aero MEV-resistant pool router
   - Docs: https://docs.aerodrome.finance/swap
   - Aero migration guide should list new router address
2. **Monitor trade execution**: Watch Railway logs for increasing DEX swap failure rate before July cutoff
3. **Pre-stage router update**: If router address changes, update `chain-config.ts` line 114 via human PR before Aero launch day
4. **AERO token position**: The bot may hold AERO. Self-custodied AERO holders may need to take action during migration. Most auto-converts, but verify if bot's CDP smart wallet is affected.

### Cannot Auto-Fix
The Auditor safety rule prohibits touching `executeDirectDexSwap` or `executeSingleSwap`. This needs a human-reviewed PR.

---

## Watch List for Henry

| Item | Priority | Action |
|------|----------|--------|
| Aerodrome router continuity check | HIGH | Manual verification before July |
| AERO token migration for smart wallet | MEDIUM | Check if auto-converts on CDP smart wallet |
| B20 RWA tokens on Base | LOW | Check GeckoTerminal after July 1 for pools >$100k liq |
| Bear-regime constants review | MEDIUM | KELLY 0.25, HOT_MOVER 7% — calibrated for bear that ended; review for bull |
| Bot USDC status | HIGH | 31 days in full USDC — verify Railway logs, re-enable trading if intended |
| Egress allowlist fix | HIGH | Add `autonomous-trading-bot-production.up.railway.app` + `api.geckoterminal.com` |

---

*NVR Capital autonomous agent — Run #38 — 2026-06-28*
