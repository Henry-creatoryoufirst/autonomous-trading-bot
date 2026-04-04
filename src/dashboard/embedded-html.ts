/**
 * Never Rest Capital — Embedded Dashboard HTML
 * Extracted from agent-v3.2.ts (Phase 7 refactor)
 * This is the fallback dashboard when dashboard/index.html is not found on disk.
 */

export 
const EMBEDDED_DASHBOARD = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Never Rest Capital</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script>
tailwind.config = { theme: { extend: {
  fontFamily: { sans: ['Inter', 'system-ui'], mono: ['JetBrains Mono', 'monospace'] },
  colors: {
    surface: { 900: '#0a0e1a', 800: '#0f1629', 700: '#151d35', 600: '#1c2541' },
    accent: { gold: '#f0b429', emerald: '#10b981', crimson: '#ef4444', sky: '#38bdf8' }
  }
}}}
</script>
<style>
body { font-family: 'Inter', system-ui; background: #060a14; color: #e2e8f0; }
.mono { font-family: 'JetBrains Mono', monospace; }
.glass { background: rgba(15,22,41,0.6); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06); }
.glow-green { box-shadow: 0 0 20px rgba(16,185,129,0.15); }
.glow-red { box-shadow: 0 0 20px rgba(239,68,68,0.15); }
.mesh-bg {
  background:
    radial-gradient(ellipse 80% 50% at 20% 40%, rgba(76,110,245,0.08) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 20%, rgba(16,185,129,0.06) 0%, transparent 50%),
    linear-gradient(180deg, #060a14 0%, #0a0e1a 100%);
}
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
</style>
</head>
<body class="mesh-bg min-h-screen">

<!-- Header -->
<div class="border-b border-white/5 px-4 sm:px-6 py-2">
  <div class="max-w-7xl mx-auto flex items-center justify-between">
    <div>
      <h1 class="text-sm font-bold text-white">Never Rest Capital</h1>
      <p class="text-[10px] text-slate-500">Autonomous Trading Agent v12.2</p>
    </div>
    <div class="flex items-center gap-3">
      <span class="pulse-dot inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
      <span class="text-xs text-emerald-400 font-medium" id="bot-status">Online</span>
      <span class="text-xs text-slate-600 mono" id="last-update"></span>
    </div>
  </div>
</div>

<!-- Hero Metrics -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 py-3">
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
    <div class="glass rounded-lg p-2.5">
      <p class="text-[9px] uppercase tracking-widest text-slate-500">Portfolio</p>
      <p class="text-lg font-bold text-white mono" id="portfolio-value">--</p>
    </div>
    <div class="glass rounded-lg p-2.5">
      <p class="text-[9px] uppercase tracking-widest text-slate-500">Total P&L</p>
      <p class="text-lg font-bold mono" id="total-pnl">--</p>
    </div>
    <div class="glass rounded-lg p-2.5">
      <p class="text-[9px] uppercase tracking-widest text-slate-500">Realized</p>
      <p class="text-sm font-semibold mono" id="realized-pnl">--</p>
    </div>
    <div class="glass rounded-lg p-2.5">
      <p class="text-[9px] uppercase tracking-widest text-slate-500">Harvested</p>
      <p class="text-sm font-semibold mono text-amber-400" id="harvested-pnl">--</p>
      <p class="text-[8px] text-slate-600" id="harvest-count"></p>
    </div>
  </div>

  <!-- Sub metrics -->
  <div class="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-2">
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Trades</p>
      <p class="text-xs font-semibold text-white mono" id="trade-count">--</p>
    </div>
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Win Rate</p>
      <p class="text-xs font-semibold text-emerald-400 mono" id="success-rate">--</p>
    </div>
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Cycles</p>
      <p class="text-xs font-semibold text-white mono" id="cycle-count">--</p>
    </div>
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Uptime</p>
      <p class="text-xs font-semibold text-white mono" id="uptime">--</p>
    </div>
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Peak</p>
      <p class="text-xs font-semibold text-accent-gold mono" id="peak-value">--</p>
    </div>
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Drawdown</p>
      <p class="text-xs font-semibold text-slate-400 mono" id="drawdown">--</p>
    </div>
  </div>
</div>

<!-- Holdings + Sectors Grid -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-3">
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-2">

    <!-- Holdings -->
    <div class="lg:col-span-2 glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-2">Holdings & P&L</h2>
      <div class="overflow-x-auto max-h-[200px] overflow-y-auto">
        <table class="w-full text-[11px]">
          <thead class="sticky top-0 bg-surface-800">
            <tr class="text-[9px] uppercase tracking-wider text-slate-500 border-b border-white/5">
              <th class="pb-1 text-left">Token</th>
              <th class="pb-1 text-right">Value</th>
              <th class="pb-1 text-right hidden sm:table-cell">Avg Cost</th>
              <th class="pb-1 text-right">P&L</th>
              <th class="pb-1 text-right hidden sm:table-cell">Sector</th>
            </tr>
          </thead>
          <tbody id="holdings-table"></tbody>
        </table>
      </div>
    </div>

    <!-- Sector Allocation -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-2">Sector Allocation</h2>
      <div class="flex justify-center mb-2" style="height: 130px;">
        <canvas id="sector-chart"></canvas>
      </div>
      <div id="sector-list" class="space-y-1"></div>
    </div>
  </div>
</div>

<!-- Trade Log -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-3">
  <div class="glass rounded-lg p-3">
    <h2 class="text-xs font-semibold text-white mb-2">Recent Trades</h2>
    <div class="overflow-x-auto max-h-[160px] overflow-y-auto">
      <table class="w-full text-[11px]">
        <thead class="sticky top-0 bg-surface-800">
          <tr class="text-[9px] uppercase tracking-wider text-slate-500 border-b border-white/5">
            <th class="pb-1 text-left">Time</th>
            <th class="pb-1 text-left">Action</th>
            <th class="pb-1 text-left">Pair</th>
            <th class="pb-1 text-right">Amount</th>
            <th class="pb-1 text-center">Status</th>
            <th class="pb-1 text-left hidden sm:table-cell">Reasoning</th>
          </tr>
        </thead>
        <tbody id="trades-table"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- Phase 3: Self-Improvement Intelligence -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-3">
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-2">
    <!-- Top Patterns -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Top Patterns</h2>
      <p class="text-[9px] text-slate-500 mb-2">Winning strategies by return</p>
      <div id="top-patterns" class="space-y-1 max-h-[120px] overflow-y-auto">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Adaptive Thresholds -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Adaptive Thresholds</h2>
      <p class="text-[9px] text-slate-500 mb-2">Self-tuning parameters</p>
      <div id="thresholds-display" class="space-y-1 max-h-[120px] overflow-y-auto">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Latest Insights -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Latest Insights</h2>
      <p class="text-[9px] text-slate-500 mb-2">Self-improvement engine</p>
      <div id="latest-insights" class="space-y-1 max-h-[120px] overflow-y-auto">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
  </div>
</div>

<!-- v5.1: Market Intelligence Dashboard -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-3">
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-2">
    <!-- Derivatives Positioning -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Derivatives Positioning</h2>
      <p class="text-[9px] text-slate-500 mb-2">Smart money vs retail</p>
      <div id="derivatives-intel" class="space-y-1">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Cross-Asset Correlation -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Cross-Asset Intelligence</h2>
      <p class="text-[9px] text-slate-500 mb-2">Gold, Oil, VIX, S&P 500</p>
      <div id="cross-asset-intel" class="space-y-1">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Shadow Model Proposals -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Shadow Model Validation</h2>
      <p class="text-[9px] text-slate-500 mb-2">Pending threshold changes</p>
      <div id="shadow-proposals" class="space-y-1 max-h-[120px] overflow-y-auto">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
  </div>
</div>

<!-- Footer -->
<div class="border-t border-white/5 px-4 sm:px-6 py-2 text-center">
  <p class="text-[9px] text-slate-600">Schertzinger Company Limited — Auto-refreshes every 30s</p>
</div>

<script>
let sectorChart = null;
const $ = id => document.getElementById(id);

function fmt(n, d=2) { return n != null ? '$' + Number(n).toFixed(d) : '--'; }
function pnlColor(n) { return n >= 0 ? 'text-emerald-400' : 'text-red-400'; }
function pnlSign(n) { return n >= 0 ? '+' : ''; }
function pnlBg(n) { return n >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'; }

async function fetchData() {
  try {
    const [pRes, bRes, sRes, tRes, patRes, thrRes, revRes, intRes] = await Promise.allSettled([
      fetch('/api/portfolio').then(r => r.json()),
      fetch('/api/balances').then(r => r.json()),
      fetch('/api/sectors').then(r => r.json()),
      fetch('/api/trades?limit=30').then(r => r.json()),
      fetch('/api/patterns').then(r => r.json()),
      fetch('/api/thresholds').then(r => r.json()),
      fetch('/api/reviews').then(r => r.json()),
      fetch('/api/intelligence').then(r => r.json()),
    ]);
    const p = pRes.status === 'fulfilled' ? pRes.value : null;
    const b = bRes.status === 'fulfilled' ? bRes.value : null;
    const s = sRes.status === 'fulfilled' ? sRes.value : null;
    const t = tRes.status === 'fulfilled' ? tRes.value : null;
    const pat = patRes.status === 'fulfilled' ? patRes.value : null;
    const thr = thrRes.status === 'fulfilled' ? thrRes.value : null;
    const rev = revRes.status === 'fulfilled' ? revRes.value : null;
    const intel = intRes.status === 'fulfilled' ? intRes.value : null;

    if (p) renderPortfolio(p);
    if (b) renderHoldings(b);
    if (s) renderSectors(s);
    if (t) renderTrades(t);
    if (pat) renderPatterns(pat);
    if (thr) renderThresholds(thr);
    if (rev) renderInsights(rev);
    if (intel) renderIntelligence(intel);
    $('last-update').textContent = new Date().toLocaleTimeString();
  } catch (e) {
    console.error('Fetch error:', e);
    $('bot-status').textContent = 'Connection Error';
    $('bot-status').className = 'text-xs text-red-400 font-medium';
  }
}

function renderPortfolio(p) {
  $('portfolio-value').textContent = fmt(p.totalValue);
  const pnlEl = $('total-pnl');
  pnlEl.textContent = 'Today: ' + pnlSign(p.pnl) + fmt(p.pnl) + ' (' + pnlSign(p.pnlPercent) + p.pnlPercent.toFixed(2) + '%)';
  pnlEl.className = 'text-lg font-bold mono ' + pnlColor(p.pnl);

  const rEl = $('realized-pnl');
  rEl.textContent = pnlSign(p.realizedPnL) + fmt(p.realizedPnL);
  rEl.className = 'text-sm font-semibold mono ' + pnlColor(p.realizedPnL);

  // v5.1.1: Harvested profits display
  const hEl = $('harvested-pnl');
  const harv = p.harvestedProfits || 0;
  hEl.textContent = harv > 0 ? pnlSign(harv) + fmt(harv) : '$0.00';
  hEl.className = 'text-sm font-semibold mono ' + (harv > 0 ? 'text-amber-400' : 'text-slate-500');
  const hcEl = $('harvest-count');
  if (hcEl) hcEl.textContent = (p.harvestCount || 0) > 0 ? p.harvestCount + ' harvests' : 'no harvests yet';

  // Show recent harvests as mini-feed if available
  if (p.recentHarvests && p.recentHarvests.length > 0) {
    const lastH = p.recentHarvests[p.recentHarvests.length - 1];
    if (hcEl) hcEl.textContent = p.harvestCount + ' harvests | last: ' + lastH.symbol + ' +' + lastH.gainPercent + '%';
  }

  $('trade-count').textContent = p.totalTrades;
  $('success-rate').textContent = p.winRate !== undefined ? p.winRate.toFixed(0) + '%' : '--';
  $('cycle-count').textContent = p.totalCycles;
  $('uptime').textContent = p.uptime;
  $('peak-value').textContent = fmt(p.peakValue);
  $('drawdown').textContent = p.drawdown.toFixed(1) + '%';
  $('bot-status').textContent = 'Online';
  $('bot-status').className = 'text-xs text-emerald-400 font-medium';
}

function renderHoldings(b) {
  const rows = b.balances
    .filter(h => h.usdValue > 0.01)
    .sort((a, b) => b.usdValue - a.usdValue)
    .map(h => {
      const pnl = h.unrealizedPnL || 0;
      const pnlPct = h.totalInvested > 0 ? (pnl / h.totalInvested * 100) : 0;
      const costStr = h.costBasis ? '$' + (h.costBasis < 0.01 ? h.costBasis.toFixed(6) : h.costBasis.toFixed(4)) : '-';
      return '<tr class="border-b border-white/5 hover:bg-white/[0.02]">' +
        '<td class="py-1 font-semibold text-white">' + h.symbol + '</td>' +
        '<td class="py-1 text-right mono text-slate-300">' + fmt(h.usdValue) + '</td>' +
        '<td class="py-1 text-right mono text-slate-500 hidden sm:table-cell">' + costStr + '</td>' +
        '<td class="py-1 text-right"><span class="px-1 py-0.5 rounded ' + pnlBg(pnl) + ' ' + pnlColor(pnl) + ' mono text-[10px]">' +
          pnlSign(pnl) + '$' + Math.abs(pnl).toFixed(2) + (h.totalInvested > 0 ? ' (' + pnlSign(pnlPct) + pnlPct.toFixed(1) + '%)' : '') +
        '</span></td>' +
        '<td class="py-1 text-right text-slate-600 hidden sm:table-cell">' + (h.sector || '-') + '</td>' +
      '</tr>';
    }).join('');
  $('holdings-table').innerHTML = rows || '<tr><td colspan="5" class="py-6 text-center text-slate-600">No holdings yet</td></tr>';
}

function renderSectors(s) {
  if (!s.allocations || s.allocations.length === 0) return;
  const colors = ['#4c6ef5', '#10b981', '#f0b429', '#ef4444', '#38bdf8', '#a78bfa'];
  const labels = s.allocations.map(a => a.name);
  const data = s.allocations.map(a => a.currentUSD);

  if (sectorChart) sectorChart.destroy();
  sectorChart = new Chart($('sector-chart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      cutout: '65%',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    }
  });

  $('sector-list').innerHTML = s.allocations.map((a, i) => {
    const drift = a.drift;
    const driftColor = Math.abs(drift) > 5 ? (drift > 0 ? 'text-amber-400' : 'text-sky-400') : 'text-slate-400';
    return '<div class="flex items-center justify-between text-xs">' +
      '<div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full" style="background:' + colors[i] + '"></span>' +
      '<span class="text-slate-300">' + a.name + '</span></div>' +
      '<div class="mono"><span class="text-white">' + a.currentPercent.toFixed(0) + '%</span>' +
      '<span class="text-slate-600 mx-1">/</span><span class="text-slate-500">' + a.targetPercent + '%</span>' +
      '<span class="ml-2 ' + driftColor + '">' + (drift >= 0 ? '+' : '') + drift.toFixed(1) + '</span></div></div>';
  }).join('');
}

function renderTrades(t) {
  if (!t.trades || t.trades.length === 0) {
    $('trades-table').innerHTML = '<tr><td colspan="6" class="py-6 text-center text-slate-600">No trades yet</td></tr>';
    return;
  }
  $('trades-table').innerHTML = t.trades.map(tr => {
    const time = new Date(tr.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const actionColor = tr.action === 'BUY' ? 'text-emerald-400 bg-emerald-500/10' : tr.action === 'SELL' ? 'text-red-400 bg-red-500/10' : 'text-slate-400 bg-slate-500/10';
    const pair = tr.fromToken + ' → ' + tr.toToken;
    const statusIcon = tr.success ? '<span class="text-emerald-400">✓</span>' : '<span class="text-red-400">✗</span>';
    const reason = (tr.reasoning || '').substring(0, 60);
    return '<tr class="border-b border-white/5 hover:bg-white/[0.02]">' +
      '<td class="py-1 text-slate-400 mono">' + time + '</td>' +
      '<td class="py-1"><span class="px-1 py-0.5 rounded text-[9px] font-semibold ' + actionColor + '">' + tr.action + '</span></td>' +
      '<td class="py-1 text-slate-300 mono">' + pair + '</td>' +
      '<td class="py-1 text-right mono text-white">$' + (tr.amountUSD || 0).toFixed(2) + '</td>' +
      '<td class="py-1 text-center">' + statusIcon + '</td>' +
      '<td class="py-1 text-slate-500 truncate max-w-[200px] hidden sm:table-cell">' + reason + '</td></tr>';
  }).join('');
}

function renderPatterns(pat) {
  const el = $('top-patterns');
  if (!pat.topPerformers || pat.topPerformers.length === 0) {
    el.innerHTML = '<p class="text-xs text-slate-600">No patterns with enough data yet (' + pat.totalPatterns + ' tracked)</p>';
    return;
  }
  el.innerHTML = pat.topPerformers.map(p => {
    const winRate = p.stats.sampleSize > 0 ? ((p.stats.wins / p.stats.sampleSize) * 100).toFixed(0) : '0';
    const retColor = p.stats.avgReturnPercent >= 0 ? 'text-emerald-400' : 'text-red-400';
    const confColor = p.confidence >= 0.7 ? 'text-emerald-400' : p.confidence >= 0.4 ? 'text-amber-400' : 'text-red-400';
    return '<div class="flex items-center justify-between py-1.5 border-b border-white/5">' +
      '<div class="flex-1 min-w-0"><p class="text-[11px] text-slate-300 truncate">' + p.description + '</p>' +
      '<p class="text-[10px] text-slate-500">' + p.stats.sampleSize + ' trades | ' + winRate + '% win</p></div>' +
      '<div class="text-right ml-2"><span class="text-xs mono font-semibold ' + retColor + '">' + (p.stats.avgReturnPercent >= 0 ? '+' : '') + p.stats.avgReturnPercent.toFixed(1) + '%</span>' +
      '<p class="text-[10px] ' + confColor + '">' + (p.confidence * 100).toFixed(0) + '% conf</p></div></div>';
  }).join('');
}

function renderThresholds(thr) {
  const el = $('thresholds-display');
  const t = thr.currentThresholds;
  const d = thr.defaults;
  const rows = [
    ['RSI Oversold', t.rsiOversold, d.rsiOversold],
    ['RSI Overbought', t.rsiOverbought, d.rsiOverbought],
    ['Buy Signal', t.confluenceBuy, d.confluenceBuy],
    ['Sell Signal', t.confluenceSell, d.confluenceSell],
    ['Profit Take', t.profitTakeTarget + '%', d.profitTakeTarget + '%'],
    ['Stop Loss', t.stopLossPercent + '%', d.stopLossPercent + '%'],
  ];
  const changed = rows.filter(r => String(r[1]) !== String(r[2])).length;
  el.innerHTML = '<p class="text-[10px] text-slate-500 mb-2">' + thr.adaptationCount + ' adaptations | ' + changed + ' modified</p>' +
    rows.map(r => {
      const isModified = String(r[1]) !== String(r[2]);
      const valColor = isModified ? 'text-amber-400' : 'text-slate-300';
      return '<div class="flex justify-between py-1 border-b border-white/5">' +
        '<span class="text-[11px] text-slate-400">' + r[0] + '</span>' +
        '<span class="text-[11px] mono font-medium ' + valColor + '">' + r[1] + (isModified ? ' (was ' + r[2] + ')' : '') + '</span></div>';
    }).join('');
  if (thr.explorationState) {
    el.innerHTML += '<div class="mt-2 pt-2 border-t border-white/5"><p class="text-[10px] text-slate-500">Exploration: ' +
      thr.explorationState.totalExplorationTrades + ' trades | ' + thr.explorationState.consecutiveHolds + ' consecutive holds</p></div>';
  }
}

function renderInsights(rev) {
  const el = $('latest-insights');
  if (!rev.latestReview) {
    const remaining = Math.max(0, 10 - rev.tradesSinceLastReview);
    el.innerHTML = '<p class="text-xs text-slate-600">No reviews yet (' + remaining + ' trades until first review)</p>';
    return;
  }
  const r = rev.latestReview;
  const sevIcon = { INFO: '💡', WARNING: '⚠️', ACTION: '🎯' };
  el.innerHTML = '<p class="text-[10px] text-slate-500 mb-2">Review ' + rev.totalReviews + ' | ' + new Date(r.timestamp).toLocaleDateString() + ' | Win rate: ' + (r.periodStats.winRate * 100).toFixed(0) + '%</p>' +
    r.insights.slice(0, 5).map(i => {
      const icon = sevIcon[i.severity] || '📊';
      return '<div class="py-1.5 border-b border-white/5"><p class="text-[11px] text-slate-300">' + icon + ' ' + i.message + '</p></div>';
    }).join('') +
    (r.recommendations.length > 0 ? '<div class="mt-2 pt-1"><p class="text-[10px] text-slate-500 mb-1">Recommendations:</p>' +
      r.recommendations.slice(0, 3).map(rec => '<p class="text-[10px] text-amber-400/80 py-0.5">→ ' + rec.description + '</p>').join('') + '</div>' : '');
}

// v5.1: Render derivatives positioning + cross-asset intelligence
function renderIntelligence(intel) {
  // Derivatives positioning
  const derivEl = $('derivatives-intel');
  const d = intel.derivatives;
  if (d) {
    const posColor = (sig) => {
      if (sig === 'SMART_MONEY_LONG') return 'text-emerald-400';
      if (sig === 'SMART_MONEY_SHORT' || sig === 'OVERLEVERAGED_LONG') return 'text-red-400';
      if (sig === 'OVERLEVERAGED_SHORT') return 'text-amber-400';
      return 'text-slate-400';
    };
    const posIcon = (sig) => {
      if (sig === 'SMART_MONEY_LONG') return '🟢';
      if (sig === 'SMART_MONEY_SHORT') return '🔴';
      if (sig === 'OVERLEVERAGED_LONG') return '⚠️';
      if (sig === 'OVERLEVERAGED_SHORT') return '⚠️';
      return '⚪';
    };
    derivEl.innerHTML =
      '<div class="grid grid-cols-2 gap-3">' +
      '<div><p class="text-[10px] text-slate-500 mb-1">BTC Positioning</p>' +
      '<p class="text-xs font-medium ' + posColor(d.btcPositioningSignal) + '">' + posIcon(d.btcPositioningSignal) + ' ' + (d.btcPositioningSignal || 'N/A').replace(/_/g, ' ') + '</p>' +
      '<p class="text-[10px] text-slate-500 mt-1">L/S: ' + (d.btcLongShortRatio != null ? d.btcLongShortRatio.toFixed(2) : 'N/A') + ' | Top: ' + (d.btcTopTraderLSRatio != null ? d.btcTopTraderLSRatio.toFixed(2) : 'N/A') + '</p>' +
      '<p class="text-[10px] text-slate-500">Funding: ' + (d.btcFundingRate >= 0 ? '+' : '') + d.btcFundingRate.toFixed(4) + '%</p></div>' +
      '<div><p class="text-[10px] text-slate-500 mb-1">ETH Positioning</p>' +
      '<p class="text-xs font-medium ' + posColor(d.ethPositioningSignal) + '">' + posIcon(d.ethPositioningSignal) + ' ' + (d.ethPositioningSignal || 'N/A').replace(/_/g, ' ') + '</p>' +
      '<p class="text-[10px] text-slate-500 mt-1">L/S: ' + (d.ethLongShortRatio != null ? d.ethLongShortRatio.toFixed(2) : 'N/A') + ' | Top: ' + (d.ethTopTraderLSRatio != null ? d.ethTopTraderLSRatio.toFixed(2) : 'N/A') + '</p>' +
      '<p class="text-[10px] text-slate-500">Funding: ' + (d.ethFundingRate >= 0 ? '+' : '') + d.ethFundingRate.toFixed(4) + '%</p></div>' +
      '</div>';
    // OI-Price Divergence
    if (d.btcOIPriceDivergence && d.btcOIPriceDivergence !== 'NEUTRAL' && d.btcOIPriceDivergence !== 'ALIGNED') {
      derivEl.innerHTML += '<div class="mt-2 pt-2 border-t border-white/5"><p class="text-[10px] text-amber-400">⚡ BTC: ' + d.btcOIPriceDivergence.replace(/_/g, ' ') + '</p></div>';
    }
    if (d.ethOIPriceDivergence && d.ethOIPriceDivergence !== 'NEUTRAL' && d.ethOIPriceDivergence !== 'ALIGNED') {
      derivEl.innerHTML += '<p class="text-[10px] text-amber-400">⚡ ETH: ' + d.ethOIPriceDivergence.replace(/_/g, ' ') + '</p>';
    }
  } else {
    derivEl.innerHTML = '<p class="text-xs text-slate-600">Derivatives data not yet available</p>';
  }

  // Cross-asset intelligence
  const caEl = $('cross-asset-intel');
  const m = intel.macroData;
  if (m && m.crossAssets) {
    const ca = m.crossAssets;
    const sigColor = ca.crossAssetSignal === 'RISK_ON' ? 'text-emerald-400' : ca.crossAssetSignal === 'RISK_OFF' ? 'text-red-400' : ca.crossAssetSignal === 'FLIGHT_TO_SAFETY' ? 'text-red-500' : 'text-slate-400';
    const sigIcon = ca.crossAssetSignal === 'RISK_ON' ? '🟢' : ca.crossAssetSignal === 'RISK_OFF' ? '🔴' : ca.crossAssetSignal === 'FLIGHT_TO_SAFETY' ? '🚨' : '⚪';
    const pctFmt = (n) => n != null ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : 'N/A';
    caEl.innerHTML =
      '<div class="grid grid-cols-2 gap-x-4 gap-y-2">' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">Gold</span><span class="text-[11px] mono ' + (ca.goldChange24h >= 0 ? 'text-emerald-400' : 'text-red-400') + '">$' + (ca.goldPrice != null ? ca.goldPrice.toFixed(0) : 'N/A') + ' ' + pctFmt(ca.goldChange24h) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">Oil (WTI)</span><span class="text-[11px] mono text-slate-300">$' + (ca.oilPrice != null ? ca.oilPrice.toFixed(1) : 'N/A') + ' ' + pctFmt(ca.oilChange24h) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">VIX</span><span class="text-[11px] mono ' + (ca.vixLevel > 25 ? 'text-red-400' : ca.vixLevel < 15 ? 'text-emerald-400' : 'text-slate-300') + '">' + (ca.vixLevel != null ? ca.vixLevel.toFixed(1) : 'N/A') + '</span></div>' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">S&P 500</span><span class="text-[11px] mono ' + ((ca.sp500Change || 0) >= 0 ? 'text-emerald-400' : 'text-red-400') + '">' + pctFmt(ca.sp500Change) + '</span></div>' +
      '</div>' +
      '<div class="mt-2 pt-2 border-t border-white/5"><p class="text-xs font-medium ' + sigColor + '">' + sigIcon + ' ' + ca.crossAssetSignal.replace(/_/g, ' ') + '</p></div>';
  } else {
    caEl.innerHTML = '<p class="text-xs text-slate-600">Cross-asset data not yet available</p>';
  }

  // Shadow Model Proposals
  const shadowEl = $('shadow-proposals');
  if (intel.shadowProposals && intel.shadowProposals.length > 0) {
    const pending = intel.shadowProposals.filter(p => p.status === 'PENDING');
    const recent = intel.shadowProposals.filter(p => p.status !== 'PENDING').slice(-3);
    shadowEl.innerHTML = '<p class="text-[10px] text-slate-500 mb-2">' + pending.length + ' pending proposals</p>' +
      pending.map(p => {
        const pct = p.confirmingReviews + '/' + 3;
        const barWidth = Math.min(100, (p.confirmingReviews / 3) * 100);
        return '<div class="py-1.5 border-b border-white/5">' +
          '<div class="flex justify-between"><span class="text-[11px] text-slate-300">' + p.field + ' ' + (p.proposedDelta > 0 ? '↑' : '↓') + Math.abs(p.proposedDelta) + '</span>' +
          '<span class="text-[10px] text-slate-500">' + pct + ' confirmations</span></div>' +
          '<div class="w-full bg-white/5 rounded-full h-1 mt-1"><div class="bg-amber-500/60 h-1 rounded-full" style="width:' + barWidth + '%"></div></div>' +
          '<p class="text-[10px] text-slate-600 mt-0.5">' + p.reason + '</p></div>';
      }).join('') +
      (recent.length > 0 ? '<div class="mt-2 pt-1">' + recent.map(p => {
        const icon = p.status === 'PROMOTED' ? '✅' : '❌';
        return '<p class="text-[10px] ' + (p.status === 'PROMOTED' ? 'text-emerald-400/70' : 'text-red-400/70') + '">' + icon + ' ' + p.field + ' — ' + p.status + '</p>';
      }).join('') + '</div>' : '');
  } else {
    shadowEl.innerHTML = '<p class="text-xs text-slate-600">No active proposals — thresholds at defaults</p>';
  }
}

// Initial load + auto-refresh every 30s
fetchData();
setInterval(fetchData, 30000);
</script>
</body>
</html>`;
