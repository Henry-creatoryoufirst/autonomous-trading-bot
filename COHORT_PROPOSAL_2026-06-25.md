# COHORT PROPOSAL — 2026-06-25

**Filed by**: NVR Capital autonomous agent (Scout — Run #35)
**Status**: FOR HENRY'S REVIEW — requires human PR to act on any of this
**Context**: Per CLAUDE.md Rule 1, cohort changes (TOKEN_REGISTRY or COHORT_QUALITY_7) require explicit human PR after the Option B window. This proposal covers new Base ecosystem opportunities from the Beryl/B20 upgrade.

---

## Why This Proposal Exists

GeckoTerminal API was unreachable from the execution environment (network policy blocks railway.app and geckoterminal.com), so the standard quality filter (liquidity > $100K, 24h vol > $50K, age > 3 days) could not be applied to live pool data. Instead, this proposal documents the structural opportunity opened by the Base Beryl upgrade that activated today (June 25, 2026).

---

## Base Beryl Upgrade — What Changed Today

Sources: [Crowdfund Insider](https://www.crowdfundinsider.com/2026/06/286763-base-coinbases-ethereum-l2-network-prepares-for-beryl-upgrade-mainnet-launch-introducing-native-b20-token-standard/), [CryptoBriefing](https://cryptobriefing.com/base-to-launch-beryl-upgrade-with-b20-token-standard-on-june-25/), [ThirdWeb](https://blog.thirdweb.com/base-beryl-upgrade-explained-b20-token-standard-faster-withdrawals-and-reth-v2/)

1. **B20 Token Standard** — native Rust precompiles baked into Base node software (not ERC-20 contracts). Lower gas cost, built-in compliance (role-based permissions, supply caps, transfer-rule policy registry).
2. **Two B20 token types at launch**:
   - *Asset tokens* — configurable decimals, rebasing support
   - *Stablecoin tokens* — fixed 6 decimals, self-declared currency code
3. **Withdrawal time**: 7 days → 5 days (bridge efficiency)
4. **Reth V2**: node disk -50%, throughput +33% — auto-benefits execution
5. **Strategic focus**: RWAs, tokenized equities, stablecoins, long-tail assets

---

## Opportunity for NVR

### TOKENIZED_STOCKS Sector (currently 5% target, 2 tokens)
The B20 standard is designed for exactly what NVR's TOKENIZED_STOCKS sector targets. Current tokens:
- `bCOIN` (Backed Coinbase Stock) — address: 0xbbcb0356bb9e6b3faa5cbf9e5f36185d53403ac9
- `deSPXA` (Centrifuge S&P 500) — address: 0x9c5C365e764829876243d0b289733B9D2b729685 (DEX_SWAP only, thin liquidity)

**Expected B20 issuers** in the coming weeks:
- Backed Finance B20 tokenized equity versions (existing Backed tokens may migrate)
- Centrifuge B20 RWA tokens
- Coinbase-issued B20 stablecoins (likely cbUSD or similar)
- Potential tokenized T-bills and money market funds

**Quality filter to apply** when these launch (wait 30+ days for track record):
- Pool liquidity > $100K USD
- 24h volume > $50K USD
- Pool age > 30 days (new standard, higher bar appropriate)
- Verified issuer with audited B20 implementation

### DEFI Sector (15% target)
B20's policy registry and transfer rules may enable new DEX/lending protocol tokens with compliance features. Worth monitoring Aerodrome's B20 liquidity pools once they launch.

---

## Recommended Watch List (not yet actionable — too early)

| Candidate | Category | Watch For | Suggested riskLevel | Suggested minTradeUSD |
|-----------|----------|-----------|--------------------|-----------------------|
| B20 tokenized S&P 500 (issuer TBD) | TOKENIZED_STOCKS | 30+ day pool history, $100K+ liq | LOW | 25 |
| B20 tokenized BTC/ETH ETF (issuer TBD) | TOKENIZED_STOCKS | 30+ day pool, audited issuer | LOW | 25 |
| Backed B20 migration (if existing bCOIN migrates) | TOKENIZED_STOCKS | Announce migration → verify decimals | LOW | 25 |
| cbUSD or Base-native stablecoin (if launched) | BLUE_CHIP | Not tradeable for alpha | LOW | skip — stablecoin |

---

## Cohort Note

COHORT_QUALITY_7 should NOT receive B20 additions until:
1. An issuer has 6+ months of live track record on Base
2. Daily liquidity consistently exceeds $500K
3. Henry ratifies after Option B window analysis is complete

This is fundamentally a TOKEN_REGISTRY opportunity (new non-cohort tradeable tokens), not a COHORT_QUALITY_7 change.

---

## Action Required

Henry: When first B20 RWA tokens appear on Aerodrome with 30+ day track records (estimate: late July / August 2026), run a standard Scout evaluation and open a human PR to add qualifying candidates to TOKEN_REGISTRY (TOKENIZED_STOCKS sector). Do not rely on the automated Scout for B20 discovery until GeckoTerminal (or an equivalent) indexes B20 pools properly.
