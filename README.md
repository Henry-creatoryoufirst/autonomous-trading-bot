# Henry's Autonomous Trading Agent v3.4 🤖📐

**AI-Powered Technical Trading Bot on Base Network — Live & Running 24/7 on Railway**

Built Feb 2026. Currently managing ~$495 across 4 sectors with 15-minute trading cycles.

## Current Status

| Component | Status |
|-----------|--------|
| **Bot** | ✅ Live on Railway (v3.4) |
| **Wallet** | `0xB7c51b1A8F967eF6BF906Fe4B484817Fe784a7C1` (EOA) |
| **Portfolio** | ~$483 USDC + ~$10 ETH + gas |
| **Strategy** | Technical indicators + AI confluence scoring |
| **Cycles** | Every 15 minutes, 24/7 |
| **Network** | Base Mainnet |
| **First Trade** | ✅ Feb 15, 2026 — $10 USDC → ETH |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              TRADING AGENT v3.4                               │
├──────────────────────────────────────────────────────────────┤
│  📐 Technical Indicators Engine                               │
│  • RSI (14-period, Wilder's smoothing)                        │
│  • MACD (12/26/9 EMA crossover detection)                     │
│  • Bollinger Bands (20-period, 2 std dev, %B, bandwidth)      │
│  • SMA (20, 50)                                               │
│  • Trend detection (STRONG_UP → STRONG_DOWN)                  │
│  • Volume analysis (24h vs 7-day average)                     │
│  • Confluence scoring (-100 to +100)                          │
├──────────────────────────────────────────────────────────────┤
│  🧠 AI Decision Engine (Claude claude-sonnet-4-20250514)                       │
│  • Indicator-driven entry/exit rules                          │
│  • Sector rebalancing across 4 sectors                        │
│  • Trade history memory (last 10 trades)                      │
│  • Fear & Greed sentiment overlay                             │
│  • Risk rules (position limits, pump protection)              │
├──────────────────────────────────────────────────────────────┤
│  ⚡ Execution Layer                                           │
│  • Coinbase CDP SDK (account.swap)                            │
│  • Permit2 ERC-20 approvals                                   │
│  • Retry logic for approval propagation delays                │
│  • On-chain balance reading via Base RPC                      │
├──────────────────────────────────────────────────────────────┤
│  📊 Data Sources                                              │
│  • CoinGecko (prices + 30-day hourly history, cached 2hr)     │
│  • Alternative.me (Fear & Greed Index)                        │
│  • Base RPC (on-chain balances)                               │
└──────────────────────────────────────────────────────────────┘
```

## Sectors & Tokens (18 tracked)

| Sector | Target | Tokens |
|--------|--------|--------|
| **Blue Chip** | 40% | ETH, cbBTC, cbETH |
| **AI Tokens** | 20% | VIRTUAL, AIXBT, GAME, HIGHER |
| **Meme Coins** | 20% | BRETT, DEGEN, TOSHI, MOCHI, NORMIE |
| **DeFi** | 20% | AERO, WELL, SEAM, EXTRA, BAL |

## Trading Strategy (v3.4)

**Entry Rules (BUY):**
1. Confluence: 2+ indicators must agree (RSI oversold + MACD bullish, etc.)
2. Extreme fear (<25): Lower the bar to 1 indicator signal
3. Sector priority: Buy into most underweight sector first
4. Volume confirmation: Prefer tokens with above-average volume
5. Trend alignment: Prefer UP or STRONG_UP trends

**Exit Rules (SELL):**
1. Take profit: Sell 25-50% if token up >15% in 24h AND RSI > 65
2. Overbought: Sell if RSI > 75 AND BB %B > 0.95 AND MACD bearish
3. Stop loss: Sell if down >20% in 7d with STRONG_DOWN trend
4. Sector trim: Sell from overweight sectors (>10% drift)

**Risk Rules:**
- No single token > 25% of portfolio
- HOLD if confluence between -15 and +15
- Never chase pumps (>20% in 24h with RSI >75)
- Tighten sells in extreme greed (>75)

## Quick Start

```bash
npm install
npm start        # Run v3.4 (current)
npm run dev      # Dev mode with hot reload
```

## Environment Variables (Railway)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key for AI decisions |
| `CDP_API_KEY_NAME` | Coinbase CDP API key name |
| `CDP_API_KEY_PRIVATE_KEY` | CDP API private key (PKCS#8 PEM) |
| `CDP_WALLET_SECRET` | CDP wallet encryption secret |
| `WALLET_ADDRESS` | EOA wallet address for balance reading |

## Configuration Defaults

| Setting | Value |
|---------|-------|
| Max buy per trade | $10.00 |
| Max sell per trade | 25% of position |
| Slippage tolerance | 1% (100 bps) |
| Trading interval | 15 minutes |
| Indicator cache TTL | 2 hours |
| CoinGecko history | 30 days (hourly) |

## File Structure

```
autonomous-trading-bot/
├── agent-v3.2.ts           # Main bot (v3.4 — this is the active file)
├── package.json            # Dependencies & scripts
├── railway.toml            # Railway deployment config
├── Dockerfile              # Container build
├── agent-v3.1.ts           # Previous version (sector allocation)
├── agent-v3.ts             # v3.0 (Polymarket experiment)
├── agent.ts                # v2.0 (original)
├── scripts/
│   ├── scan-arbitrage.ts   # Polymarket scanner (deprecated)
│   └── status.ts           # Wallet status checker
├── services/               # Service modules
├── strategies/             # Strategy modules
└── logs/                   # Trade history JSON
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| **v3.4** | Feb 15, 2026 | Technical indicators engine, confluence scoring, upgraded AI prompt, trade history memory |
| **v3.3.1** | Feb 15, 2026 | Cron fix, swap retry logic, Permit2 race condition fix |
| **v3.3** | Feb 14, 2026 | Permit2 approvals, CDP SDK swap execution, live trading |
| **v3.2** | Feb 14, 2026 | EOA wallet, on-chain balance reading, gas management |
| **v3.1** | Feb 13, 2026 | Sector allocation (4 sectors, 18 tokens) |
| **v3.0** | Feb 12, 2026 | Polymarket arbitrage experiment |
| **v2.0** | Feb 11, 2026 | Original AI trading bot |

## Links

- **Railway Dashboard:** [railway.com/project/44a17190...](https://railway.com/project/44a17190-9c66-481d-bdaf-6ef93c3babe2)
- **Wallet on BaseScan:** [basescan.org/address/0xB7c51b...](https://basescan.org/address/0xB7c51b1A8F967eF6BF906Fe4B484817Fe784a7C1)
- **First Trade TX:** [basescan.org/tx/0xd9cc79fc...](https://basescan.org/tx/0xd9cc79fc01d50a3ed5946e4fb0b730d4bc44019a7cdda10145269fb5a512ffff)

---

> "I consider the money in that wallet gone — all profit is a bonus."

**Built with Claude + Coinbase CDP SDK | Feb 2026** 🚀
