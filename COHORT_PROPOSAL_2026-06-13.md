# Cohort Proposal — 2026-06-13

**Filed by:** NVR Capital Autonomous Agent (Run #35)  
**Window status:** Option B 30-day benchmark window closes ~2026-06-15 (**~2 days from now**)  
**Rule applied:** CLAUDE.md Rule 1 — cohort locked; auto-adds prohibited; writing proposal instead

---

## Why This Proposal Exists

The Token Scout job ran today (30 days since the last non-reverted addition — MOLT on 2026-05-14, SYRUP on 2026-05-08). The 48-hour scout threshold is met. However, CLAUDE.md Rule 1 explicitly prohibits any `feat(scout): add <SYMBOL> to TOKEN_REGISTRY` commit during the Option B benchmark window. The three prior auto-adds that were reverted (MOLT 2026-05-14 pre-window, OPENX + VEIL 2026-05-16 post-window) are the canonical examples.

**Action required from Henry:** Once the window closes (~June 15), review the candidates below, verify liquidity/volume on GeckoTerminal, and open a human PR to add any that qualify.

---

## Data Availability This Run

| Source | Status | Note |
|--------|--------|------|
| GeckoTerminal API (`/trending_pools`, `/new_pools`) | ❌ BLOCKED | Host not in egress allowlist |
| DexScreener API | ❌ BLOCKED | Same constraint |
| Production bot API (`/api/errors`, `/api/balances`) | ❌ BLOCKED | 403 Forbidden + egress |
| Web search (general trends) | ✅ Available | Used for narrative/sector research |

**Consequence:** Cannot confirm pool liquidity > $100k, 24h volume > $50k, or pool age > 3 days for any specific candidate. All recommendations below are **narrative-sourced** and require Henry's manual GeckoTerminal verification before adding.

---

## Market Context (June 2026)

Based on web research:

- **Base L2 TVL:** ~$4.5B as of May 2026 (Aerodrome, Virtuals, Farcaster, Aave, Brett top 5)
- **Aerodrome TVL:** ~$453M, $12.4B 30-day volume, 55% DEX market share on Base
- **Aerodrome Slipstream V2** (March 2026): MEV-resistant pool migration underway; improved routing algorithm
- **Institutional flows:** Circle minted ~$2B USDC in 48h window (Base/ETH institutional accumulation signal)
- **Recovery signs:** AERO highlighted as "near accumulation zone" by analysts (June 7, 2026)
- **AI Agents:** Virtuals Protocol at $477M aGDP, 15,800+ AI projects, $13.2B monthly transaction volume
- **Bear → Recovery transition:** After 70+ day bear (as of Run #34), market recovery signals emerging

---

## Candidate Tokens for Post-Window Review

### Tier A — Highest Conviction (verify immediately after June 15)

| Symbol | What it is | Why it's a candidate | Category | Risk level | Action needed |
|--------|-----------|---------------------|----------|------------|---------------|
| **UNI** | Uniswap governance token | Present in ETH + ARB registries but **missing from Base TOKEN_REGISTRY**. Uniswap has deployed on Base with active pools. Strong brand, 5+ year track record, DEFI sector gap-fill. | DEFI | MEDIUM | Verify Base address + Aerodrome pool liquidity on GeckoTerminal |
| **HYPE** | Hyperliquid | Fastest-growing perp DEX in 2026, mentioned across all sources. Check if HYPE token exists on Base L2 specifically (primarily on its own chain). | DEFI | MEDIUM | Verify Base chain availability + liquidity |

### Tier B — Monitor (secondary priority)

| Symbol | What it is | Why it's a candidate | Category | Risk level | Action needed |
|--------|-----------|---------------------|----------|------------|---------------|
| Any new **Virtuals AI agents** launched May–June 2026 | AI agent tokens on Base via Virtuals Protocol | Virtuals ecosystem growing strongly; look for any new agents with 3+ days pool age, $100k+ liquidity, consistent volume | AI_TOKENS | HIGH | GeckoTerminal scan: filter `base` network, `created_at` after 2026-05-01, sort by volume |
| **RWA tokenized assets** | Tokenized equities / credit on Base | RWA tokenization accelerating in 2026. Current registry only has bCOIN + deSPXA. Check for new Backed/Centrifuge products | TOKENIZED_STOCKS | LOW–MEDIUM | Check Backed Finance and Centrifuge Base deployments |

### Not recommended (already in registry or redundant)

| Skipped | Reason |
|---------|--------|
| AERO | Already in registry |
| cbBTC, WETH, LINK | Cohort QUALITY_7 plus registry already has them |
| BRETT, TOSHI, MOG | Already in registry (MEME_COINS) |
| WELL, MORPHO, SEAM, AAVE | Already in registry (DEFI) |
| VIRTUAL, AIXBT, KAITO | Already in registry (AI_TOKENS) |

---

## Recommended Post-Window Scout Protocol (for Henry)

1. **Wait for June 15** — Option B window closes; alpha attribution is clean
2. **Run GeckoTerminal scan manually:**
   - `https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1`
   - Filter: liquidity > $100k, 24h vol > $50k, pool age > 3 days
3. **Check UNI on Base** — If Aerodrome USDC/UNI pool exists with $100k+ liquidity, add to TOKEN_REGISTRY as DEFI MEDIUM
4. **Open human PR** with full quality scores and rationale for each add
5. **Consider reducing TOKEN_REGISTRY bloat** — registry has 60+ tokens; some auto-discovered tokens (RAVE, OVPP, EDEL, ETHY, etc.) may have thin liquidity now vs. when added; a post-window audit could prune dead positions

---

## Option B Window Closeout Note

The 30-day Option B benchmark window (cbBTC/WETH 60/40 vs. NVR cohort) closes ~**June 15, 2026**. This scout proposal is intentionally held here so the benchmark attribution stays clean.

**Henry, when the window closes:**
- Compare NVR portfolio performance vs. cbBTC/WETH 60/40 from May 15 → June 15
- If +5% annualized target met → declare Option B success, resume normal operations
- If not met → strategy review before re-expanding cohort
- In either case: this proposal file has the next cohort additions queued

---

*Filed: 2026-06-13T UTC | Branch: claude/cool-sagan-2w89mz | Run #35*
