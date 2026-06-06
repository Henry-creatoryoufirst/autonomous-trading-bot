# NVR Capital — Cohort Proposal 2026-06-06

**Written by**: NVR autonomous agent (scout run #35)
**Branch**: claude/cool-sagan-ADwmB
**Status**: PROPOSAL ONLY — cohort locked until ~2026-06-15 (Option B window). No TOKEN_REGISTRY edit made.
**Vault note**: NVR-HQ not present in this repo checkout; filed to repo root instead.

---

## Why This File Exists

CLAUDE.md Rule 1 prohibits auto-adds to `COHORT_QUALITY_7` or `TOKEN_REGISTRY` during the Option B
benchmark window. The window closes ~2026-06-15 (9 days from this run). Scout ran because the last
token addition was MOLT on 2026-05-14 — 23 days ago, well past the 48h threshold — but the cohort
lock takes precedence. Candidates are documented here for Henry's review at window close.

---

## Scan Constraints This Run

- GeckoTerminal API blocked from execution sandbox (403 on all endpoints)
- Production bot API also unreachable (403)
- Research conducted via WebSearch only — no on-chain liquidity/volume verification possible
- **Implication**: liquidity and volume figures below are WebSearch-sourced estimates, not on-chain confirmed.
  Henry or the next scout run (after window close, ~2026-06-15) must verify before any registry add.

---

## Ecosystem Event: Aerodrome → Aero Merger (July 2026)

**This is the most significant Base ecosystem event since the scout program launched.**

- Aerodrome Finance and Velodrome Finance are merging into a unified cross-chain DEX called **"Aero"**
- Target launch: **July 2026** (one month out)
- Current Aerodrome metrics: TVL $453M, 30-day volume ~$12.4B, AERO price $0.33
- AERO market cap: $313M — significantly below all-time highs

**Implications for NVR**:

1. **Router address risk**: `executeDirectDexSwap` is coded to Aerodrome Slipstream contracts. The Aero
   merger may change router addresses. Henry must monitor Aerodrome's migration announcements and update
   the DEX router address in agent-v3.2.ts before the July 2026 migration window.

2. **AERO position watch**: AERO is already in TOKEN_REGISTRY (DEFI sector). At $0.33 with healthy
   protocol metrics, it may represent a quality entry ahead of the Velodrome merger catalyst. This is NOT
   a cohort proposal — AERO is already tracked — but worth flagging for Henry's manual portfolio review.

3. **Liquidity migration**: LPs must migrate to new MEV-resistant Aero pools. NVR's routing automatically
   follows liquidity concentration, so this is likely a passive benefit. No code change needed at scout
   level; verify at merge time.

---

## Token Candidates (Post-Window Review Queue)

The following tokens were surfaced via WebSearch research but **cannot be verified** from this
environment's sandboxed API access. They are documentation-only proposals for Henry to evaluate
after the Option B window closes (~2026-06-15).

### Candidate 1: cbDOT (Coinbase Wrapped Polkadot) — if launched on Base by June 2026

**Rationale**: Coinbase has been systematically wrapping major L1 assets for Base (cbBTC, cbETH,
cbSOL, cbADA, cbLTC, cbXRP, cbDOGE). Polkadot (DOT) is a top-20 asset by market cap and a natural
next addition to the cb* series.

**Quality criteria to verify**:
- Aerodrome pool liquidity > $100K USD
- 24h volume > $50K USD
- Pool age > 3 days
- Address: verify on Aerodrome or Basescan

**Proposed registry config** (if confirmed):
```typescript
cbDOT: {
  address: "TBD — verify on Basescan before adding",
  symbol: "cbDOT", name: "Coinbase Wrapped DOT", coingeckoId: "polkadot",
  sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 10,
},
```

---

### Candidate 2: ZORA (already in registry — quality score update)

**Already tracked**: ZORA is in TOKEN_REGISTRY as AI_TOKENS/MEDIUM. No add needed.
However, Zora's ecosystem has been growing with its L2 chain launch. ZORA may warrant
reclassification to DEFI/MEDIUM at window close if on-chain metrics confirm sustained volume.

**Action**: Henry review ZORA's actual Aerodrome pool metrics at window close.

---

### Candidate 3: Any new Centrifuge/Backed RWA on Base

**Rationale**: NVR's TOKENIZED_STOCKS sector (5% target) has only 2 tokens (bCOIN, deSPXA) and
is likely chronically underweight. Centrifuge and Backed Finance have been expanding their
tokenized real-world asset product line on Base in 2026.

**Quality criteria to verify**:
- Confirmed Base L2 deployment
- Institutional-grade liquidity (>$500K)
- Not a synthetic derivative with counterparty risk beyond standard smart contract risk

**Action**: Henry check Centrifuge and Backed Finance for new Base deployments at window close.

---

## Auditor Context (No Trigger Conditions Confirmed)

Live bot metrics unavailable. Key findings from this run's research:

| Finding | Impact | Complexity | Risk | Action |
|---------|--------|------------|------|--------|
| Aerodrome→Aero merger router risk | 4 | 2 | Medium | Henry monitor; update router before July 2026 |
| Intent-based routing (CoW/1inch Fusion) | 3 | 5 | Medium | Watch list — off-limits execution changes |
| Dynamic Kelly fraction (vol-regime) | 3 | 3 | Low | Watch list — >10 lines, needs live trigger |
| MEV slippage tightening | 3 | 1 | Low | Henry verify current slippage tolerance in executeDirectDexSwap |

---

## Summary for Henry

1. **Window closes ~2026-06-15** — 9 days. At that point, run a full scout scan with GeckoTerminal
   access (needs network policy update or local execution) to verify candidates above.

2. **Aerodrome router migration (July 2026)** — Most urgent non-cohort item. Check Aerodrome docs
   for new "Aero" router contract addresses before the merge goes live.

3. **AERO position review** — At $0.33 with strong protocol metrics, may represent a quality
   accumulation opportunity if technical indicators align in next cycle.

4. **No TOKEN_REGISTRY or COHORT_QUALITY_7 edits made this run** — cohort lock honored per CLAUDE.md.
