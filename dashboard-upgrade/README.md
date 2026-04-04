# Dashboard Upgrade — Three-Tab Layout

Step 7 from the NVR Capital handoff: Wallet, Fleet Command, and Simulations tabs.

## Files

- `index.html` — Complete standalone dashboard (HTML + CSS + JS, no external frameworks)

## Integration into `embedded-html.ts`

The file `src/dashboard/embedded-html.ts` exports a constant `EMBEDDED_DASHBOARD` containing the full HTML string. To integrate this upgrade:

1. **Replace the embedded HTML constant.** Open `src/dashboard/embedded-html.ts` and replace the entire template literal assigned to `EMBEDDED_DASHBOARD` with the contents of `dashboard-upgrade/index.html`. The structure is the same pattern — a single exported string containing the full HTML document.

2. **Or serve from disk.** The function `getDashboardHTML()` in `src/dashboard/api.ts` (line ~925) checks several file paths before falling back to `EMBEDDED_DASHBOARD`. Place `index.html` at any of these locations and it will be served automatically:
   - `<cwd>/dashboard/index.html`
   - `<dirname>/dashboard/index.html`
   - `/app/dashboard/index.html`
   - `<cwd>/index.html`

   For Railway deployment, the simplest approach is to copy `dashboard-upgrade/index.html` to `dashboard/index.html` at the project root.

## API Endpoints Used

The dashboard fetches from these existing endpoints (all already defined in `src/dashboard/api.ts` and `src/server/routes.ts`):

### Tab 1: Wallet
| Endpoint | Data |
|----------|------|
| `/api/portfolio` | Portfolio value, P&L, deposited, harvested, uptime, cycles, version |
| `/api/balances` | Token positions with cost basis, prices, unrealized P&L, ATR stops |
| `/api/sectors` | Sector allocation breakdown |
| `/api/trades?limit=30` | Recent trade log |
| `/api/equity` | Equity curve data points |

### Tab 2: Fleet Command
| Endpoint | Data |
|----------|------|
| `/api/portfolio` | Self bot status (primary) |
| `/api/family` | Multi-bot family data (all 4 bots) |
| `/api/swarm-status` | Swarm coordination status |
| `/api/signal-dashboard` | Signal data and alert history |
| `/api/trades?limit=10` | Fallback alert data from trade log |
| `POST /api/resume` | Resume a paused bot |
| `POST /api/kill` | Pause a bot |

### Tab 3: Simulations
| Endpoint | Data |
|----------|------|
| `/api/strategy-versions` | Available strategy versions and backtest results |
| `/api/paper-portfolios` | Paper trading portfolio list |
| `/api/patterns` | Strategy pattern confidence scores |
| `/api/intelligence` | Market regime and intelligence data |
| `/api/version-backtest?version=X&days=N` | Run a specific backtest |

## Design Decisions

- **No external CSS frameworks** — All styling is vanilla CSS with CSS variables for theming.
- **No charting libraries** — Charts are generated as inline SVG (equity curve, sector donut, market condition bars).
- **Tab switching is JS-only** — No page reloads. Tabs show/hide via `display: none/block`.
- **Auto-refresh** — Data refreshes every 30 seconds for the active tab only (avoids unnecessary API calls).
- **Responsive** — CSS grid with mobile breakpoints; columns collapse on small screens, some table columns hide on mobile.
- **Dark theme** — Matches existing NVR Capital aesthetic from the current `embedded-html.ts` (surface colors, glass morphism, JetBrains Mono for data).

## Fleet Bot Configuration

The four bots are defined in a `FLEET_BOTS` array in the JS. If the fleet changes, update this array:

```js
const FLEET_BOTS = [
  { id: 'henry', name: "Henry's Bot", service: 'efficient-peace', color: 'var(--accent-blue)' },
  { id: 'signal', name: 'Signal Service', service: 'nvr-signal-service', color: 'var(--accent-sky)' },
  { id: 'kathy', name: 'Kathy & Howard', service: 'stc-kathy-howard', color: 'var(--accent-purple)' },
  { id: 'zack', name: 'Zachary Closky', service: 'nvr-zachary-closky', color: 'var(--accent-gold)' },
];
```

## What's Not Yet Wired

These features render placeholder or derived data and will need backend work to fully populate:

- **Fleet Command pause/resume** — Currently calls `POST /api/resume` and `POST /api/kill` on the self-bot. For per-bot control across Railway services, the fleet management API needs to proxy commands to individual service URLs.
- **Alert history** — Falls back to showing recent trades if `/api/signal-dashboard` does not return `recentSignals`. A dedicated alerts endpoint would improve this.
- **Market condition breakdown** — Currently derives percentages from the `marketRegime` string. A `/api/market-conditions` endpoint with historical regime distribution would give real data.
- **Parameter sweep visualization** — The strategy lab runs single backtests. Sweep functionality would need a batch endpoint or WebSocket for progress updates.
