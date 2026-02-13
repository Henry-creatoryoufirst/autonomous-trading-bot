# Henry's Autonomous Trading Agent v3.0 🤖

**Multi-Strategy Trading Bot for Base Network + Polymarket**

Built Feb 2026 after analyzing X posts showing $134 → $56K profits on Polymarket's 5-minute crypto markets.

## What's New in v3.0

### 🔥 Polymarket Arbitrage (The $500K Strategy)
Based on analysis of successful traders making $40K-$500K:
- Scans 5-minute and 15-minute BTC/ETH prediction markets
- Detects when YES + NO prices sum to less than $1
- Risk-free profit by buying both sides
- Key insight: 29,256 trades → $500K (small gains compound)

### 🧠 Improved AI Trading
- Balance-aware decisions (fixes "insufficient balance" errors)
- Won't attempt trades larger than available funds
- Better risk management

### 📊 Multi-Strategy Architecture
```
┌─────────────────────────────────────────────────┐
│           TRADING AGENT v3.0                    │
├─────────────────────────────────────────────────┤
│  Strategy 1: Polymarket Arbitrage               │
│  • 5-min BTC/ETH markets                        │
│  • YES+NO < $1 detection                        │
│  • Sub-second execution target                  │
├─────────────────────────────────────────────────┤
│  Strategy 2: Base DEX Trading                   │
│  • AI-powered sentiment analysis                │
│  • ETH, cbBTC, AERO, DEGEN, BRETT               │
│  • Fear & Greed index signals                   │
└─────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install Dependencies
```bash
cd autonomous-agent
npm install
```

### 2. Configure Environment
```bash
# Already configured, but review settings:
cat .env
```

### 3. Run the Agent
```bash
# Start v3.0 (multi-strategy)
npm start

# Or run v2.0 (original)
npm run start:v2
```

### 4. Quick Arbitrage Scan
```bash
# One-off scan for Polymarket opportunities
npm run arb
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| **Base DEX** |||
| `TRADING_ENABLED` | `true` | Enable live trading |
| `MAX_TRADE_SIZE_USDC` | `10` | Max per trade |
| `TRADING_INTERVAL_MINUTES` | `15` | Check frequency |
| **Polymarket Arbitrage** |||
| `POLYMARKET_ARB_ENABLED` | `true` | Enable arb scanning |
| `POLYMARKET_MIN_SPREAD` | `0.02` | Min spread (2%) |
| `POLYMARKET_MAX_TRADE` | `50` | Max per arb trade |
| `POLYMARKET_TRADING_ENABLED` | `false` | Execute trades |

## File Structure

```
autonomous-agent/
├── agent-v3.ts              # Main agent (v3.0)
├── agent.ts                 # Original agent (v2.0)
├── services/
│   └── polymarket.ts        # Polymarket API client
├── strategies/
│   └── polymarket-arb.ts    # Arbitrage strategy
├── scripts/
│   └── scan-arbitrage.ts    # Quick arb scanner
├── logs/
│   ├── agent.log            # Activity logs
│   └── agent-error.log      # Error logs
└── UPGRADE_ANALYSIS.md      # Strategy research
```

## Your Wallet

- **Address:** `0x55509AA76E2769eCCa5B4293359e3001dA16dd0F`
- **Network:** Base (mainnet)
- **View:** [Basescan](https://basescan.org/address/0x55509AA76E2769eCCa5B4293359e3001dA16dd0F)

## How Polymarket Arbitrage Works

From the X posts that inspired this upgrade:

> "When temporary inefficiencies appear -- where YES + NO briefly price below $1 -- the system executes instantly. No prediction. No directional bias. Just structural arbitrage."
> - @0x_Discover

**Example:**
- BTC 5-min market: "Will BTC be higher in 5 minutes?"
- YES price: $0.48
- NO price: $0.49
- Total: $0.97 (3% below $1.00)
- **Action:** Buy $50 YES + $50 NO = $100 spent
- **Outcome:** One side pays $100, guaranteed $3 profit

## Safety Features

- ✅ Balance checking before trades
- ✅ Max trade size limits
- ✅ Dry-run mode for testing
- ✅ Detailed logging
- ✅ Error recovery

## Next Steps (Roadmap)

1. **Polymarket API Integration** - Get API keys for actual trading
2. **Speed Optimization** - WebSocket connections, faster execution
3. **Dashboard** - Real-time monitoring web UI
4. **Telegram Alerts** - Trade notifications

---

## Philosophy

> "I consider the money in that wallet gone - all profit is a bonus."

This agent is designed to run autonomously with money you're comfortable losing. The strategies are based on real success stories, but past performance doesn't guarantee future results.

---

**Built on Coinbase Agentic Wallets + Polymarket | Feb 2026** 🚀
