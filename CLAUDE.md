# autonomous-trading-bot — NVR Capital Trading Engine

## Overview
Claude-powered AI trading bot running 24/7 on Base (L2). Executes 15-minute cycles analyzing market conditions via technical indicators, confluence scoring, and adversarial risk review.

## Current Version: v20.6

## Quick Reference
- **Main file:** `agent-v3.2.ts` (~850KB)
- **Bot wallet:** `0x55509AA76E2769eCCa5B4293359e3001dA16dd0F`
- **BaseScan:** basescan.org/address/0x55509AA76E2769eCCa5B4293359e3001dA16dd0F
- **Network:** Base Mainnet (Coinbase L2)

## Deployment — STAGING REQUIRED
- **NEVER push bot code changes directly to `main`** — always go through staging first
- **Production (main):** Railway auto-deploys from `main` branch
- **Staging (staging):** Railway auto-deploys from `staging` branch (paper-trade mode)
- **Workflow:** `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`
- **Rollback:** `./scripts/deploy/rollback.sh`
- **Project ID:** 44a17190-9c66-481d-bdaf-6ef93c3babe2
- **Service ID:** 80096f70-dc22-463f-87a2-77f6081d6781
- **URL:** autonomous-trading-bot-production.up.railway.app
- **GitHub:** Henry-creatoryoufirst/autonomous-trading-bot (private)
- **Docker:** Node 20 slim + Python

## Railway Fleet (all auto-deploy from same repo/main)
1. **efficient-peace** — Henry's main bot
2. **NVR - Signal Service** — Signal aggregation
3. **STC - Kathy&Howard** — Family bot ($500 capital)
4. **NVR - Zachary Closky** — Family bot ($1000 capital)

## Trading Architecture
- **Cycle:** Every 15 minutes, 24/7
- **AI Model:** Claude Sonnet 4 (routine cycles use Haiku for cost savings)
- **Sectors:** Blue Chip (40%), AI (20%), Meme (20%), DeFi (20%), Tokenized Stocks (new)
- **Indicators:** RSI, MACD, Bollinger Bands, SMA, Fear & Greed Index
- **Decision flow:** Technical analysis → Confluence scoring → AI review → Adversarial risk review → Execute
- **Router:** Aerodrome Slipstream (50%+ of Base volume)

## Key Services (services/)
| Service | Purpose |
|---------|---------|
| `gecko-terminal.ts` | Technical indicators + price data |
| `risk-reviewer.ts` | Adversarial risk management |
| `telegram.ts` | Alerts + hourly reports |
| `token-discovery.ts` | Token analysis + discovery |
| `yield-optimizer.ts` | Yield strategies |
| `aave-yield.ts` | Aave V3 yield farming |
| `alpaca-client.ts` | Stock trading integration |
| `polymarket.ts` | Prediction market arbitrage |

## Telegram Integration
- **Bot:** @Neverrestcapital_bot
- **Henry's chat ID:** 7267993651
- **Hourly reports:** Portfolio, positions, market regime, flags

## Revenue Model
- 2% of daily NET realized profits (asymmetric — collected on up days only)
- Break-even: ~$2,500 portfolio in normal volatility

## Cost Structure
- Claude API: ~$7-8/mo per bot
- Railway container: ~$7-8/mo per bot
- Target at scale: $2-4/bot/month (tiered models + shared infra)

## Version History (recent)
- v20.6: Phantom spike detection, tighter price sanity
- v20.5.x: Micro-trade sizing, state backup/restore, prompt compression, tiered model routing
- v20.5: Token pruning engine
- v20.4.x: Tiered cycles, self-healing, Aerodrome Slipstream router
- v20.4: Multi-asset convergence, Chainlink, CMC intelligence
- v20.3: P&L from on-chain deposits (blockchain = source of truth)
- v20.2: Graduated deployment, fear-aware trading
- v20.0: Walk-forward validation, adversarial risk reviewer

## Important Notes
- NEVER commit API keys or wallet private keys
- The bot's P&L uses on-chain deposit detection (Blockscout) as source of truth
- Capital deployment: LIGHT tier 20%, Kelly fallback 8%, floor $150/3.5%
- State backup/restore endpoints exist for Railway redeploy safety
