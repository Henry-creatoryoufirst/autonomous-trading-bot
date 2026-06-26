# NVR Scout Run — 2026-06-26

## Run Status

| Job | Status | Reason |
|-----|--------|--------|
| 🏥 Medic | ⚠️ SKIPPED | Bot API unreachable (proxy 403) |
| 🔍 Scout | ✅ Research complete — proposal only (no auto-add per CLAUDE.md Rule 1) |
| 📊 Auditor | ⚠️ SKIPPED | Bot API unreachable (proxy 403) |

---

## Medic Note

**Bot API unreachable this run.** The agent proxy is blocking outbound HTTPS to
`autonomous-trading-bot-production.up.railway.app` with 403 (policy denial). This
means `/api/errors` and `/api/balances` could not be checked. The bot may be healthy
or it may be down — Henry should verify directly via Railway dashboard or Telegram.

Proxy relay failure log:
```
"kind": "connect_rejected"
"detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)"
"host": "autonomous-trading-bot-production.up.railway.app:443"
```

---

## Scout Research — 2026-06-26

**Last scout commit:** 2026-05-25 (32 days ago — past 48h threshold, scout triggered)

**API Access:** GeckoTerminal API and CoinGecko API both blocked by proxy (403).
Research conducted via web search only. Quality filter could not be confirmed with
live on-chain data — Henry should verify liquidity/volume before any merge.

### Candidates Evaluated

| Token | Symbol | Contract (Base) | Liquidity | 24h Vol | Pool Age | Registry? | Score | Decision |
|-------|--------|----------------|-----------|---------|----------|-----------|-------|----------|
| Clawstr | CLAWSTR | `0x33b1EA5F4cFa8D26038198746d20BD1230Bfcb07` | ~$521K | ~$13.8M | Feb 2026 (~4 mo) | No | 4/10 | ❌ REJECT |
| WYDE End Hunger | EAT | unknown (pool only found) | ~$2.8M | ~$35K | Dec 2025 | No | 3/10 | ❌ REJECT (vol) |
| DeAgentAI | AIA | N/A | — | — | — | No | N/A | ❌ REJECT (wrong chain — SUI/BNB) |
| Hyperliquid | HYPE | N/A | — | — | — | No | N/A | ❌ REJECT (own L1, not Base) |

### Candidate Notes

**CLAWSTR** (`0x33b1EA5F4cFa8D26038198746d20BD1230Bfcb07`)
- AI agent decentralized social platform using Nostr + Lightning
- Launched February 2026, peaked at 3,300% gain, now -89.65% from ATH
- 40% top-10 holder concentration — centralization risk
- $521K liquidity and $13.8M 24h volume meet filter thresholds on paper
- **Rejection reason:** -89.65% 24h price crash, high concentration, speculative social token
  with no sustainable utility signal. Would likely drag bot performance.

**EAT** (WYDE End Hunger)
- Cause coin — 25% of trading fees go to hunger relief nonprofits
- $2.8M liquidity (strong), but 24h volume only $35K < $50K filter
- **Rejection reason:** Volume filter fails.

### Observation: Existing Registry Performing

Tokens added by prior scouts (WIRE, HYDX) showed strong performance in March 2026
(+105%, +93% 7-day respectively). No new quality candidates identified this scan.
The broader Base AI/DeFi ecosystem is rotating between established tokens (VIRTUAL,
CLANKER, VVV, AERO) already tracked in the registry.

---

## CLAUDE.md Rule 1 Compliance Note

This run did NOT commit any changes to `TOKEN_REGISTRY` or `COHORT_QUALITY_7`.
CLAUDE.md Rule 1 explicitly bans `feat(scout): add <SYMBOL> to TOKEN_REGISTRY`
auto-commits during the Option B window and requires explicit human PR for cohort
changes. The 30-day window ended ~2026-06-15, but the policy remains: human PR required.

This proposal is written to the `research/` directory on the `claude/cool-sagan-s5uann`
branch for Henry's review.

---

## Recommendations for Henry

1. **Check Railway dashboard directly** — bot API was unreachable this run, so medic
   could not confirm bot health. Verify `efficient-peace` and fleet services are up.
2. **No TOKEN_REGISTRY changes recommended** this scan — no candidates cleared quality
   filters cleanly.
3. **Next scout:** Consider allowing direct GeckoTerminal API access in proxy policy,
   or schedule a manual scout when proxy allows financial API access.
