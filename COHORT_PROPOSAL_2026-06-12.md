# NVR Cohort Proposal — 2026-06-12

**Run type:** Scheduled hourly agent (Medic + Scout + Auditor)
**Branch:** claude/cool-sagan-bejloo
**Option B window closes:** ~2026-06-15 (3 days remaining)

---

## JOB 1 — MEDIC

**Status: ⚠️ API UNREACHABLE**

The production API (`autonomous-trading-bot-production.up.railway.app`) is blocked by
the execution environment's network egress policy. Neither curl nor WebFetch can reach
the host.

- `/api/errors` → network egress denied
- `/api/balances` → network egress denied

**Implication:** Cannot determine failure rate or recent error patterns. This is a
network policy configuration issue in the remote execution environment, not necessarily
a bot issue. No medic fix applied (no confirmed pattern). Henry should manually check
the Railway dashboard or run `curl` from a local terminal if concerned.

---

## JOB 2 — SCOUT

**Status: 🔍 No qualifying tokens verified — cohort locked (3 days to window close)**

Last scout commit: 2026-05-16 (27 days ago — threshold exceeded).

### Network limitations this scan

Both GeckoTerminal API (`api.geckoterminal.com`) and DexScreener API
(`api.dexscreener.com`) are blocked by the execution environment's network egress
policy. Pool liquidity and 24h volume data could not be fetched and verified against
the quality filter. Per CLAUDE.md Rule 1, the cohort is locked regardless until
~2026-06-15.

### Tokens evaluated

| Token | Source | Liquidity | 24h Vol | Pool Age | Score | Decision |
|-------|--------|-----------|---------|----------|-------|----------|
| AERO | In registry | — | — | — | — | Already tracked |
| VIRTUAL | In registry | — | — | — | — | Already tracked |
| FLUID (InstaDapp) | WebSearch mention | NOT VERIFIED | NOT VERIFIED | Unknown | N/A | Needs API verification |
| HYPE (Hyperliquid) | WebSearch (token unlock) | NOT VERIFIED | NOT VERIFIED | Not Base L2 native | N/A | Likely reject — wrong chain |
| Base network token | Polymarket (69% by Dec 2026) | N/A — not launched | N/A | N/A | N/A | Monitor — future candidate |
| GRVT / RSGP / ARX | WebSearch (June TGEs) | Too new | Too new | <3 days | N/A | Reject — pool age filter |

**Result:** No additions. Cohort remains locked at COHORT_QUALITY_7.

### Candidates for Henry's review after June 15

The following tokens are worth a manual scout pass once the Option B window closes
and GeckoTerminal access is restored:

1. **FLUID (InstaDapp)** — Major DeFi lending/liquidity protocol; DefiLlama listed it
   as a top-six DeFi protocol in 2026. Check Base pool liquidity vs. $100k threshold.
   Category: DEFI, expected riskLevel: MEDIUM.

2. **Base network token** (symbol TBD) — Polymarket at 69% probability for 2026
   launch. When (if) it launches, it would be an immediate BLUE_CHIP tier-1
   candidate given Coinbase's L2 sponsorship. Monitor Jesse Pollak announcements.

3. **AERO migration pool addresses** — Aerodrome is migrating all LPs to new
   MEV-resistant pools ahead of the "Aero" cross-chain launch in July 2026.
   Some existing pool addresses may become stale. Verify routing config remains
   valid post-migration (see Auditor section below).

---

## JOB 3 — AUDITOR RESEARCH

**Status: 📊 Trigger conditions unverifiable — research-only pass**

Trade API endpoints are blocked by network egress, so win rate, drawdown,
and losing streak cannot be calculated. No code changes made. Research findings
recorded here for Henry's review.

### Internal diagnosis (from codebase, not API)

From `src/core/config/constants.ts` as of this run:

| Parameter | Current value | Notes |
|-----------|--------------|-------|
| `KELLY_FRACTION` | 0.25 (Quarter-Kelly) | Bear-adjusted May 2026 from 0.30 |
| `KELLY_POSITION_CEILING_PCT` | 12% | Bear-adjusted May 2026 from 14% |
| `NORMAL_CONFLUENCE_BUY` | 27 | Bear-adjusted May 2026 from 25 |
| `NORMAL_CONFLUENCE_SELL` | -18 | Bear-adjusted May 2026 from -20 |
| `LIFETIME_DRAWDOWN_BUY_BLOCK_PCT` | 20% | Block buys at 20% drawdown from peak |
| `LIFETIME_DRAWDOWN_CAUTION_PCT` | 12% | Halve sizes at 12% drawdown |
| `VOLUME_SPIKE_THRESHOLD` | 2.0 | Set by prior auditor (was 2.5) |
| `BREAKER_DAILY_DD_PCT` | 7% | Tightened Apr 2026 from 8% |

### Research findings

#### Signal Quality
**Finding:** Autonomous agents in 2026 increasingly monitor mempool + social signals
(Discord, Telegram) alongside pure technicals for pre-price-move alpha. Source: Dysnix
AI agent guide, KuCoin AI+Crypto deep-dive.
- Impact: 3/5, Complexity: 5/5, Risk: HIGH (mempool access requires infra changes)
- **Decision: Watch list** — too complex for ≤10 line implementation.

#### Execution Efficiency — CRITICAL WATCH ITEM
**Finding (high priority):** Aerodrome is undergoing mandatory pool migration to new
MEV-resistant contracts, with the migration starting May 12, 2026. A new "Aero"
cross-chain DEX launches July 2026 via Aerodrome + Velodrome merger. Additionally,
Slipstream V2 (improved routing) launched March 2026.

Potential impact: pool addresses the bot currently routes through may become
deprecated after July 2026. The bot's DEX router config (`UNISWAP_V3_SWAP_ROUTER`,
`activeChain.dexRouters`) should be verified against the Aerodrome docs after the
migration window closes.
- Impact: 4/5, Complexity: 2/5, Risk: HIGH (affects execution, not config)
- **Decision: Manual verification required** — Henry should check
  [Aerodrome docs](https://docs.aerodrome.finance/swap) and compare router
  addresses against what's configured in `agent-v3.2.ts` around line 6549-6550.

#### Position Sizing
**Finding:** Research confirms Quarter-Kelly (0.25×) is the current academic and
practitioner consensus for sustained volatile/bear crypto markets. The bot already
applies this via `KELLY_FRACTION = 0.25`. No change needed.
- Impact: 1/5, Complexity: 1/5 — already implemented optimally.
- **Decision: Confirmed — current config matches best practice.**

#### Competitive Intelligence
**Finding:** HeyElsa (ELSA — already in registry) processed $300M+ on-chain volume
since launch, backed by Coinbase Ventures. Cross-chain arbitrage bots are increasingly
dominant on Base (fast bridges + Base/Arbitrum/Optimism price gaps). MEV protection
via private mempools (QuickNode Power Bundle for Base) is becoming standard.
- Impact: 2/5, Complexity: 4/5, Risk: MEDIUM (private mempool requires RPC change)
- **Decision: Watch list** — worth a dedicated spike when the Option B window
  closes and strategy iteration resumes.

### Watch list for Henry

1. **Aerodrome router addresses**: Verify `UNISWAP_V3_SWAP_ROUTER` and any Aerodrome
   Slipstream router addresses in `agent-v3.2.ts` ~line 6549 are the V2/post-migration
   contracts, not legacy addresses that may be deprecated by July 2026.

2. **Cross-chain arbitrage opportunity**: Base/Arbitrum/Optimism price gaps have become
   a reliable alpha source for 2026 bots. NVR is Base-only — worth scoping a
   cross-chain sleeve for post-Option-B iteration.

3. **MEV-resistant routing**: QuickNode's Base DeFi Power Bundle offers MEV protection
   at the RPC level. Switching from standard RPC to MEV-protected RPC could improve
   execution quality, especially for larger trades.

4. **Base native token**: When (if) Coinbase launches a BASE governance token
   (Polymarket: 69% by Dec 2026), it should be added immediately as BLUE_CHIP tier-1.

---

## Summary

```
🏥 Medic:   ⚠️ API unreachable (network egress policy) — cannot assess failure rate
🔍 Scout:   no qualifying tokens verified — API pool data blocked + cohort locked until ~Jun 15
📊 Auditor: trigger conditions unverifiable (API blocked) — research-only; watch Aerodrome migration
```

**Henry: the Option B window closes in ~3 days (~June 15). After that:**
- Run a manual scout pass with GeckoTerminal access restored
- Check Aerodrome router addresses against V2/post-migration contracts
- Consider whether cross-chain arbitrage fits the next strategy shape

No code changes made this run. All findings on `claude/cool-sagan-bejloo` for review.
