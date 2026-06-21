# Token Registry Proposal — 2026-06-21

> **Note**: NVR-HQ Cathedral vault is not present in this repo checkout.
> This proposal would normally go to `NVR-HQ/COHORT_PROPOSAL_2026-06-21.md`.
> Filed here on `claude/cool-sagan-5z1odo` for Henry's review before any merge.

## Scout Run Context

- Run #35 (first post Option-B window, window closed ~2026-06-15)
- Last scout commit: 2026-05-25 (27 days ago)
- GeckoTerminal API: blocked (sandbox egress constraint)
- Data source: Web search synthesis

---

## Candidate: cbMEGA — Coinbase Wrapped MEGA

| Field | Value |
|-------|-------|
| Symbol | cbMEGA |
| Name | Coinbase Wrapped MEGA |
| Underlying | MEGA (MegaETH native token) |
| Contract (Base) | `0xcb111e6a2a3bde90856d299d61341ac302167d23` |
| Verified on | BaseScan: basescan.org/token/0xcb111e6a2a3bde90856d299d61341ac302167d23 |
| Market Cap (Apr 2026) | ~$1.79M USD |
| 24h Volume | ~$791,901 USD |
| Pool Age | 2+ months (launched ~April 2026) |
| Coinbase Backed | Yes — 1:1 backed, same program as cbBTC / cbSOL / cbXRP / cbADA |

### Quality Filter Results

| Criterion | Threshold | Status | Notes |
|-----------|-----------|--------|-------|
| Pool liquidity > $100k | Yes | ⚠️ UNCONFIRMED | GeckoTerminal API blocked; inferred from $792K daily vol but not confirmed |
| 24h volume > $50k | Yes | ✅ PASS | $791,901 — well above threshold |
| Pool age > 3 days | Yes | ✅ PASS | 2+ months since launch |
| Not in TOKEN_REGISTRY | Yes | ✅ PASS | Absent from current registry |

### Scoring (1–10)

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Volume consistency | 7 | $792K/day is strong absolute volume |
| Liquidity depth | 5 | Market cap ~$1.79M is thin — slippage risk on larger trades |
| Momentum | 6 | Coinbase institutional backing; MegaETH ecosystem growing |
| Category fit | 7 | Natural fit alongside other cb* assets in BLUE_CHIP |
| **Overall** | **6.25** | Marginally passes 6/10 threshold |

### Proposed Registry Entry (if approved)

```typescript
cbMEGA: {
  address: "0xcb111e6a2a3bde90856d299d61341ac302167d23",
  symbol: "cbMEGA", name: "Coinbase Wrapped MEGA", coingeckoId: "coinbase-wrapped-mega",
  sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

### Risks & Concerns

1. **Thin market cap**: At ~$1.79M, cbMEGA is far smaller than peer cb* assets (cbBTC at $billions, cbSOL at $100M+). A $25-50 trade could have meaningful price impact.
2. **Underlying asset uncertainty**: MegaETH is a newer L2 competing in a crowded market (Arbitrum, Base, Optimism dominate). The MEGA token's long-run survival is less certain than cbBTC/cbETH/cbSOL.
3. **Liquidity unconfirmed**: The 44% volume/mcap ratio is unusually high and could reflect very thin pools with high churn rather than genuine depth.
4. **NOT for COHORT_QUALITY_7**: This is a TOKEN_REGISTRY addition only. COHORT_QUALITY_7 remains cbBTC + WETH + cbXRP + cbLTC + LINK + cbADA + cbSOL per the Option B cohort lock.

### Recommendation

**HOLD for human review.** The $792K daily volume is genuinely compelling for a Coinbase-backed wrapped asset. However, the thin market cap and unconfirmed pool liquidity warrant Henry manually checking Aerodrome pool depth (aerodrome.finance/liquidity — search cbMEGA/USDC or cbMEGA/WETH) before adding to TOKEN_REGISTRY.

If pool depth is confirmed > $100K, add with `minTradeUSD: 25` and `riskLevel: MEDIUM`.
If pool depth is < $100K, defer — a ≥$25 trade from the bot could move price significantly.

---

## Infrastructure Alert: Base Beryl Upgrade — June 25, 2026

Base mainnet hard fork scheduled for **June 25, 2026 at 18:00 UTC** (4 days from now).

Key changes:
- **B20 token standard**: New chain-native token format via Rust precompiles, preserving ERC-20 parity. First-party support for stablecoins, RWAs, and long-tail issuers. Transfer costs cut ~50%.
- **5-day withdrawal finalization**: Improved L1 settlement timeline.
- **Reth V2**: Node disk usage drops up to 50%.

**Bot impact**: Low. The bot uses ERC-20 interfaces which are preserved by B20's ABI parity. No code changes required for the Beryl upgrade itself. However, watch for any slippage anomalies on June 25 as nodes upgrade — the bot's slippage tolerance and Aerodrome routing should self-handle.

**AERO note**: Aerodrome is also planning "Predictive Allocation" in July 2026 (real-time liquidity incentive allocation replacing weekly gauge voting). This is bullish for AERO token and could increase pool depth for smaller-cap tokens if incentives are redirected dynamically.

---

## Candidates Evaluated (Full Table)

| Token | 24h Vol | Liq | Age | In Registry | Score | Decision |
|-------|---------|-----|-----|-------------|-------|----------|
| cbMEGA | $792K | ⚠️ Unconfirmed | 2mo | No | 6.25/10 | Propose (Henry confirm liq) |
| HYPE | $476M | N/A | N/A | No | N/A | **Not on Base** — Hyperliquid L1 only |
| RE token | High | N/A | <1wk | No | N/A | Primarily CEX; no confirmed Base L2 pool |
| BASE token | N/A | N/A | N/A | No | N/A | Not yet launched (33% odds by year-end) |

*GeckoTerminal trending/new pools API blocked — full universe scan not possible this run.*
