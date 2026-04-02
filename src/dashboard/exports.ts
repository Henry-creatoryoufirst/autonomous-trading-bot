/**
 * Never Rest Capital — Export HTML Generators
 * Extracted from agent-v3.2.ts (Phase 7 refactor)
 * Pure functions for generating marketing/backtest/paper export HTML.
 */

export function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmtExport(n: number, dec: number = 1): string {
  return n.toFixed(dec);
}

export function generateEquityCurveSVG(curve: number[], width: number = 900, height: number = 200): string {
  if (!curve || curve.length < 2) return "";
  const min = Math.min(...curve) * 0.98;
  const max = Math.max(...curve) * 1.02;
  const range = max - min || 1;
  const positive = curve[curve.length - 1] >= curve[0];

  const points = curve.map((v, i) => {
    const x = 40 + (i / (curve.length - 1)) * (width - 60);
    const y = 10 + (1 - (v - min) / range) * (height - 30);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const firstX = 40;
  const lastX = 40 + (width - 60);
  const bottomY = height - 20;
  const fillPoints = `${firstX},${bottomY} ${points} ${lastX},${bottomY}`;
  const lineColor = positive ? "#22C55E" : "#EF4444";
  const fillColor = positive ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)";

  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(frac => {
    const val = max - frac * range;
    const y = 10 + frac * (height - 30);
    return `<text x="36" y="${y + 3}" text-anchor="end" fill="#94A3B8" font-size="10" font-family="Nunito,sans-serif">$${val.toFixed(0)}</text>
    <line x1="40" y1="${y}" x2="${width - 20}" y2="${y}" stroke="#334155" stroke-width="0.5" stroke-dasharray="3,3"/>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="width:100%;height:auto">
    ${yLabels}
    <polygon points="${fillPoints}" fill="${fillColor}"/>
    <polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

export function nvrExportBaseStyles(size: "square" | "portrait" = "square"): string {
  const h = size === "portrait" ? 1350 : 1080;
  return `
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1080px; height: ${h}px; overflow: hidden;
      background: linear-gradient(160deg, #0F172A 0%, #1E3A5F 40%, #1E3A5F 60%, #0F172A 100%);
      font-family: 'Nunito', sans-serif; color: #FFFFFF;
      display: flex; flex-direction: column;
    }
    .export-header {
      padding: 48px 56px 0 56px; display: flex; align-items: center; justify-content: space-between;
    }
    .logo-group { display: flex; align-items: center; gap: 16px; }
    .logo-text {
      font-size: 42px; font-weight: 900; letter-spacing: 4px;
      background: linear-gradient(135deg, #60A5FA, #93C5FD);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .lab-badge-export {
      background: rgba(96,165,250,0.15); border: 1px solid rgba(96,165,250,0.3);
      padding: 4px 14px; border-radius: 20px; font-size: 13px; font-weight: 700;
      color: #60A5FA; letter-spacing: 1.5px; text-transform: uppercase;
    }
    .header-date { color: #94A3B8; font-size: 14px; font-weight: 600; }
    .export-title {
      padding: 20px 56px 0 56px; font-size: 26px; font-weight: 800; color: #E2E8F0;
    }
    .export-body { flex: 1; padding: 28px 56px; display: flex; flex-direction: column; gap: 20px; }
    .export-footer {
      padding: 0 56px 40px 56px; display: flex; flex-direction: column; gap: 8px;
    }
    .footer-line { font-size: 12px; color: #64748B; letter-spacing: 0.5px; }
    .footer-tagline {
      font-size: 16px; font-weight: 700; color: #60A5FA;
      font-style: italic; letter-spacing: 0.5px;
    }
    .footer-handle { font-size: 13px; color: #94A3B8; font-weight: 600; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .kpi-box {
      background: rgba(255,255,255,0.05); border: 1px solid rgba(96,165,250,0.15);
      border-radius: 16px; padding: 20px; text-align: center;
    }
    .kpi-label { font-size: 12px; color: #94A3B8; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .kpi-value { font-size: 32px; font-weight: 900; }
    .kpi-sub { font-size: 11px; color: #64748B; margin-top: 4px; }
    .positive { color: #22C55E; }
    .negative { color: #EF4444; }
    .version-table { width: 100%; border-collapse: collapse; }
    .version-table th {
      font-size: 11px; color: #94A3B8; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1px; padding: 10px 12px; text-align: left;
      border-bottom: 1px solid rgba(96,165,250,0.2);
    }
    .version-table td {
      font-size: 15px; padding: 12px 12px; border-bottom: 1px solid rgba(255,255,255,0.04);
      font-weight: 600;
    }
    .version-table tr.best-row td { background: rgba(96,165,250,0.08); }
    .rank-badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 50%; font-size: 13px; font-weight: 900;
    }
    .rank-1 { background: linear-gradient(135deg, #F59E0B, #EAB308); color: #1E3A5F; }
    .rank-2 { background: linear-gradient(135deg, #94A3B8, #CBD5E1); color: #1E3A5F; }
    .rank-3 { background: linear-gradient(135deg, #B45309, #D97706); color: #1E3A5F; }
    .rank-other { background: rgba(255,255,255,0.08); color: #94A3B8; }
    .best-callout {
      background: linear-gradient(135deg, rgba(96,165,250,0.12), rgba(96,165,250,0.05));
      border: 1px solid rgba(96,165,250,0.3); border-radius: 16px; padding: 20px 28px;
      display: flex; align-items: center; gap: 20px;
    }
    .best-callout-icon { font-size: 36px; }
    .best-callout-text { flex: 1; }
    .best-callout-label { font-size: 12px; color: #60A5FA; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; }
    .best-callout-value { font-size: 22px; font-weight: 900; margin-top: 2px; }
    .best-callout-sub { font-size: 13px; color: #94A3B8; margin-top: 2px; }
    .vs-hold-bar {
      background: rgba(255,255,255,0.05); border: 1px solid rgba(96,165,250,0.15);
      border-radius: 12px; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between;
    }
    .vs-hold-label { font-size: 14px; color: #94A3B8; font-weight: 600; }
    .vs-hold-value { font-size: 22px; font-weight: 900; }
    .equity-section {
      background: rgba(255,255,255,0.03); border: 1px solid rgba(96,165,250,0.1);
      border-radius: 16px; padding: 20px;
    }
    .equity-label { font-size: 12px; color: #94A3B8; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
  `;
}

export function generateBacktestMultiExportHTML(results: any[]): string {
  const best = results[0];
  const runDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const tableRows = results.slice(0, 6).map((r: any, i: number) => {
    const rankClass = i < 3 ? `rank-${i + 1}` : "rank-other";
    const retClass = r.returnPct >= 0 ? "positive" : "negative";
    const vsHoldClass = (r.vsHold || 0) >= 0 ? "positive" : "negative";
    const isBest = i === 0 ? ' class="best-row"' : "";
    return `<tr${isBest}>
      <td style="width:36px"><span class="rank-badge ${rankClass}">${i + 1}</span></td>
      <td style="font-weight:800;color:#E2E8F0">${escapeHtml(r.version)}</td>
      <td style="color:#94A3B8">${escapeHtml(r.name)}</td>
      <td class="${retClass}">${r.returnPct >= 0 ? "+" : ""}${fmtExport(r.returnPct)}%</td>
      <td class="negative">-${fmtExport(Math.abs(r.maxDrawdownPct))}%</td>
      <td>${fmtExport((r.winRate || 0) * 100, 0)}%</td>
      <td>${fmtExport(r.profitFactor || 0, 2)}</td>
      <td class="${vsHoldClass}">${(r.vsHold || 0) >= 0 ? "+" : ""}${fmtExport(r.vsHold || 0)}%</td>
    </tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">
<title>NVR Strategy Lab - Version Comparison</title>
<style>${nvrExportBaseStyles("square")}</style>
</head><body>

<div class="export-header">
  <div class="logo-group">
    <div class="logo-text">NVR</div>
    <div class="lab-badge-export">Strategy Lab</div>
  </div>
  <div class="header-date">${runDate}</div>
</div>

<div class="export-title">Version Comparison &middot; Last 30 days</div>

<div class="export-body">
  <div style="overflow:hidden;border-radius:16px;border:1px solid rgba(96,165,250,0.12)">
    <table class="version-table">
      <thead><tr>
        <th></th><th>Version</th><th>Name</th><th>Return</th><th>Max DD</th><th>Win Rate</th><th>P.Factor</th><th>vs HOLD</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <div class="best-callout">
    <div class="best-callout-icon">&#x1F3C6;</div>
    <div class="best-callout-text">
      <div class="best-callout-label">Best Strategy</div>
      <div class="best-callout-value">${escapeHtml(best.version)} &mdash; ${escapeHtml(best.name)}</div>
      <div class="best-callout-sub">${best.returnPct >= 0 ? "+" : ""}${fmtExport(best.returnPct)}% return &middot; ${fmtExport((best.winRate || 0) * 100, 0)}% win rate &middot; ${fmtExport(best.profitFactor || 0, 2)} profit factor</div>
    </div>
  </div>
</div>

<div class="export-footer">
  <div class="footer-line">Backtested on 30 days of live price data</div>
  <div class="footer-tagline">&ldquo;Your money should never rest.&rdquo;</div>
  <div class="footer-handle">@neverrestcapital</div>
</div>

</body></html>`;
}

export function generateBacktestSingleExportHTML(r: any): string {
  const retClass = r.returnPct >= 0 ? "positive" : "negative";
  const vsHold = r.vsHold || 0;
  const vsHoldAbs = Math.abs(vsHold);
  const vsHoldText = vsHold >= 0
    ? `Beat buy-and-hold by +${fmtExport(vsHoldAbs)}%`
    : `Underperformed buy-and-hold by -${fmtExport(vsHoldAbs)}%`;
  const vsHoldClass = vsHold >= 0 ? "positive" : "negative";
  const equitySVG = generateEquityCurveSVG(r.equityCurve || [], 960, 220);
  const desc = r.description || "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">
<title>NVR Strategy Lab - ${escapeHtml(r.version)}</title>
<style>${nvrExportBaseStyles("square")}</style>
</head><body>

<div class="export-header">
  <div class="logo-group">
    <div class="logo-text">NVR</div>
    <div class="lab-badge-export">Strategy Lab</div>
  </div>
  <div class="header-date">${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
</div>

<div class="export-title">${escapeHtml(r.version)} &mdash; ${escapeHtml(r.name)}</div>
<div style="padding:0 56px;font-size:13px;color:#64748B;margin-top:4px">${escapeHtml(desc)}</div>

<div class="export-body">
  <div class="kpi-grid">
    <div class="kpi-box">
      <div class="kpi-label">Total Return</div>
      <div class="kpi-value ${retClass}">${r.returnPct >= 0 ? "+" : ""}${fmtExport(r.returnPct)}%</div>
      <div class="kpi-sub">30-day backtest</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Max Drawdown</div>
      <div class="kpi-value negative">-${fmtExport(Math.abs(r.maxDrawdownPct))}%</div>
      <div class="kpi-sub">Peak to trough</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Win Rate</div>
      <div class="kpi-value" style="color:#E2E8F0">${fmtExport((r.winRate || 0) * 100, 0)}%</div>
      <div class="kpi-sub">${r.totalTrades || 0} total trades</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Profit Factor</div>
      <div class="kpi-value" style="color:#E2E8F0">${fmtExport(r.profitFactor || 0, 2)}</div>
      <div class="kpi-sub">Sharpe: ${fmtExport(r.sharpeRatio || 0, 2)}</div>
    </div>
  </div>

  ${equitySVG ? `<div class="equity-section">
    <div class="equity-label">Equity Curve</div>
    ${equitySVG}
  </div>` : ""}

  <div class="vs-hold-bar">
    <div class="vs-hold-label">vs Buy &amp; Hold</div>
    <div class="vs-hold-value ${vsHoldClass}">${vsHoldText}</div>
  </div>
</div>

<div class="export-footer">
  <div class="footer-line">Backtested on 30 days of live price data</div>
  <div class="footer-tagline">&ldquo;Your money should never rest.&rdquo;</div>
  <div class="footer-handle">@neverrestcapital</div>
</div>

</body></html>`;
}

export function generatePaperExportHTML(portfolio: any, detail: any, liveReturnPct: number = 0): string {
  const metrics = portfolio.metrics || {};
  const retClass = (metrics.totalReturnPct || 0) >= 0 ? "positive" : "negative";
  const startDate = portfolio.startTime
    ? new Date(portfolio.startTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : portfolio.startedAt
      ? new Date(portfolio.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "Unknown";

  const equityCurve = detail?.equityCurve
    ? (Array.isArray(detail.equityCurve) ? detail.equityCurve.map((p: any) => typeof p === 'number' ? p : p.value) : [])
    : [];
  const equitySVG = generateEquityCurveSVG(equityCurve, 960, 200);

  // liveReturnPct passed as parameter (was: state.trading computed inline)
  const vsLive = (metrics.totalReturnPct || 0) - liveReturnPct;
  const vsLiveClass = vsLive >= 0 ? "positive" : "negative";
  const vsLiveText = vsLive >= 0 ? `+${fmtExport(vsLive)}% vs live bot` : `${fmtExport(vsLive)}% vs live bot`;

  const displayId = portfolio.id || "Paper Portfolio";
  const displayVersion = portfolio.strategyVersion || "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">
<title>NVR Paper Trading - ${escapeHtml(displayId)}</title>
<style>${nvrExportBaseStyles("square")}</style>
</head><body>

<div class="export-header">
  <div class="logo-group">
    <div class="logo-text">NVR</div>
    <div class="lab-badge-export">Paper Trading</div>
  </div>
  <div class="header-date">${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
</div>

<div class="export-title">${escapeHtml(displayId)}</div>
<div style="padding:0 56px;font-size:14px;color:#60A5FA;font-weight:600;margin-top:4px">Strategy ${escapeHtml(displayVersion)}</div>

<div class="export-body">
  <div class="kpi-grid">
    <div class="kpi-box">
      <div class="kpi-label">Current Value</div>
      <div class="kpi-value" style="color:#E2E8F0">$${fmtExport(metrics.totalValue || 0, 2)}</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Return</div>
      <div class="kpi-value ${retClass}">${(metrics.totalReturnPct || 0) >= 0 ? "+" : ""}${fmtExport(metrics.totalReturnPct || 0)}%</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Win Rate</div>
      <div class="kpi-value" style="color:#E2E8F0">${fmtExport(metrics.winRate || 0, 0)}%</div>
      <div class="kpi-sub">${metrics.totalTrades || portfolio.tradeCount || 0} trades</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Max Drawdown</div>
      <div class="kpi-value negative">-${fmtExport(Math.abs(metrics.maxDrawdown || 0))}%</div>
    </div>
  </div>

  ${equitySVG ? `<div class="equity-section">
    <div class="equity-label">Portfolio Equity Curve</div>
    ${equitySVG}
  </div>` : ""}

  <div class="vs-hold-bar">
    <div class="vs-hold-label">vs Live Bot</div>
    <div class="vs-hold-value ${vsLiveClass}">${vsLiveText}</div>
  </div>

  <div style="font-size:13px;color:#64748B;margin-top:4px">Running live since ${startDate}</div>
</div>

<div class="export-footer">
  <div class="footer-line">Paper trading with simulated execution</div>
  <div class="footer-tagline">&ldquo;Your money should never rest.&rdquo;</div>
  <div class="footer-handle">@neverrestcapital</div>
</div>

</body></html>`;
}
