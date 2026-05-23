# Cohort Proposal — 2026-05-23

**Status:** PENDING HUMAN REVIEW — do not merge to TOKEN_REGISTRY until Option B window closes (~2026-06-15)

**Why this file exists:** CLAUDE.md Rule 1 locks all TOKEN_REGISTRY edits during the Option B benchmark window.
Scout ran (last commit 2026-05-16, >48h threshold met) but cannot auto-add. These are candidates for
Henry's review after the window closes.

**Data caveat:** GeckoTerminal API and DexScreener API were both unreachable from the scout's remote
execution environment (network policy allowlist). Liquidity/volume figures are from WebSearch surface-level
scrapes of DexScreener trending page and may lag real-time by hours. Pool ages could NOT be verified —
the >3 day pool age filter cannot be confirmed. All candidates require on-chain verification before addition.

---

## Candidates Evaluated

| # | Symbol | Name | 24h Volume | Liquidity | Pool Age | Registry | Scout Score |
|---|--------|------|-----------|-----------|----------|----------|-------------|
| 1 | GITLAWB | The Network Token | ~$2.0M | ~$5.1M | Unverified | Not in registry | **8/10** |
| 2 | SUPERGEMMA | Supergemma4-26b-multimodal | ~$4.2M | ~$570k | Unverified | Not in registry | **7/10** |
| 3 | Polsia | Polsia | ~$2.5M | ~$406k | Unverified | Not in registry | **5/10** |
| 4 | MNEME | Mneme | ~$1.2M | ~$373k | Unverified | Not in registry | **5/10** |
| — | VIRTUAL | Virtuals Protocol | ~$15.5M | ~$679k | Established | **Already in registry** | N/A |

---

## Candidate Detail

### 1. GITLAWB — Score 8/10 (HIGH INTEREST)

- **Pool:** Uniswap V4 on Base
- **Pool address:** `0xec33256bf1ded407a57fd3c1965e7556e42ac14db09bc4e6fef57d5e2eb0b0b9`
- **Token address:** Largest holder: `0x498581ff718922c3f8e6a244956af099b2652b2b` (needs verification)
- **Website:** gitlawb.com/token — references GitlawbStaking.sol on Base
- **Category fit:** Infrastructure/DeFi — staking contract indicates genuine utility
- **Liquidity:** ~$5.1M — very high for a new token; well above $100k threshold
- **Volume:** ~$2.0M 24h — strong, consistent turnover
- **Risk assessment:** MEDIUM — staking contract suggests project seriousness; however AI-named staking patterns warrant scrutiny
- **Suggested registry entry if approved:** sector=DEFI, riskLevel=MEDIUM, minTradeUSD=25, decimals=18
- **Action needed:** Verify pool age >3 days, confirm token contract address on Basescan, check team/audit status

### 2. SUPERGEMMA — Score 7/10

- **Pool:** Uniswap V4 on Base
- **Pool address:** `0x3beaf1613f6c44821935d4b0a546f3ea012413a85ddf073249e362019ed5d75c`
- **Token address:** Not extracted — needs Basescan lookup
- **Category fit:** AI_TOKENS — name references Gemma 26B multimodal model, fits NVR's AI sector thesis
- **Liquidity:** ~$570k — above $100k threshold
- **Volume:** ~$4.2M 24h — highest volume of the batch; strong momentum
- **Risk assessment:** HIGH — AI-themed meme/token; high volume may be concentrated or wash-traded
- **Suggested registry entry if approved:** sector=AI_TOKENS, riskLevel=HIGH, minTradeUSD=10, decimals=18
- **Action needed:** Verify contract address, pool age, check if volume is organic vs. bot-driven

### 3. Polsia — Score 5/10

- **Pool:** Base (DEX unknown from search data)
- **Token address:** Not found in search results
- **Category fit:** Unclear — name doesn't suggest clear sector
- **Liquidity:** ~$406k — passes $100k threshold
- **Volume:** ~$2.5M 24h — strong
- **Risk assessment:** HIGH — no clear utility signal; speculative
- **Suggested registry entry if approved:** sector=MEME_COINS, riskLevel=HIGH, minTradeUSD=10, decimals=18
- **Action needed:** Find contract address, confirm project identity, verify pool age

### 4. MNEME — Score 5/10

- **Pool:** Base (MNEME/WETH)
- **Token address:** Not found in search results
- **Category fit:** Unclear — possibly AI/philosophy-themed meme
- **Liquidity:** ~$373k — passes $100k threshold
- **Volume:** ~$1.2M 24h — adequate
- **Risk assessment:** HIGH — no project info surfaced; speculative
- **Suggested registry entry if approved:** sector=MEME_COINS, riskLevel=HIGH, minTradeUSD=10, decimals=18
- **Action needed:** Find contract address, project info, confirm legitimacy

---

## Quality Filter Summary

| Filter | GITLAWB | SUPERGEMMA | Polsia | MNEME |
|--------|---------|------------|--------|-------|
| Liquidity > $100k | ✅ ~$5.1M | ✅ ~$570k | ✅ ~$406k | ✅ ~$373k |
| 24h Volume > $50k | ✅ ~$2.0M | ✅ ~$4.2M | ✅ ~$2.5M | ✅ ~$1.2M |
| Pool age > 3 days | ❓ Unverified | ❓ Unverified | ❓ Unverified | ❓ Unverified |
| Not in registry | ✅ | ✅ | ✅ | ✅ |
| Contract address known | ⚠️ Partial | ⚠️ Pool only | ❌ | ❌ |

**Recommendation:** GITLAWB and SUPERGEMMA are strong candidates pending pool age verification and
contract address confirmation. Polsia and MNEME need more research before consideration.

---

## What Henry Should Do

After the Option B window closes (~2026-06-15):

1. Check Basescan for GITLAWB and SUPERGEMMA contract addresses
2. Confirm pool ages > 3 days (they almost certainly pass given observed volume)
3. Run a quick audit/rug-check on GITLAWB (staking contract = examine TVL lock vs. rug risk)
4. Open a PR adding GITLAWB and SUPERGEMMA to TOKEN_REGISTRY if they pass your review
5. Re-run the scout after window closes for fresh data

---

*Generated by automated scout run 2026-05-23. Data sourced from DexScreener trending page via WebSearch.*
*API note: GeckoTerminal and DexScreener APIs were unreachable from scout's remote execution environment.*
