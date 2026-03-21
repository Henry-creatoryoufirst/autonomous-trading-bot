/**
 * v19.0: Signal Quality Tracker
 *
 * Records every signal generated vs executed vs filtered, with filter reasons.
 * Powers the /api/signals endpoint for visibility into the risk management layer.
 */

export interface SignalEvent {
  timestamp: string;
  token: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  tier: string;           // SCOUT, SCALE_UP, FLOW_REVERSAL, AI, MOMENTUM_EXIT, etc.
  outcome: 'executed' | 'filtered';
  filterReason?: string;  // Why it was blocked (dedup, surge cap, dust guard, VWS, etc.)
  amountUSD?: number;
  confluence?: number;
}

export interface SignalStats {
  totalGenerated: number;
  totalExecuted: number;
  totalFiltered: number;
  executionRate: string;
  filterReasons: Record<string, number>;
  byTier: Record<string, { generated: number; executed: number; filtered: number }>;
  recentSignals: SignalEvent[];
}

const MAX_SIGNAL_LOG = 200;
let signalLog: SignalEvent[] = [];

export function recordSignal(event: SignalEvent): void {
  signalLog.push(event);
  if (signalLog.length > MAX_SIGNAL_LOG) {
    signalLog = signalLog.slice(-MAX_SIGNAL_LOG);
  }
}

export function recordExecuted(token: string, action: string, tier: string, amountUSD?: number): void {
  recordSignal({
    timestamp: new Date().toISOString(),
    token,
    action: action as 'BUY' | 'SELL',
    tier,
    outcome: 'executed',
    amountUSD,
  });
}

export function recordFiltered(token: string, action: string, tier: string, reason: string, amountUSD?: number): void {
  recordSignal({
    timestamp: new Date().toISOString(),
    token,
    action: action as 'BUY' | 'SELL',
    tier,
    outcome: 'filtered',
    filterReason: reason,
    amountUSD,
  });
}

export function getSignalStats(): SignalStats {
  const totalGenerated = signalLog.length;
  const totalExecuted = signalLog.filter(s => s.outcome === 'executed').length;
  const totalFiltered = signalLog.filter(s => s.outcome === 'filtered').length;

  // Filter reason breakdown
  const filterReasons: Record<string, number> = {};
  for (const s of signalLog) {
    if (s.outcome === 'filtered' && s.filterReason) {
      const key = s.filterReason.split(':')[0].trim(); // Normalize to category
      filterReasons[key] = (filterReasons[key] || 0) + 1;
    }
  }

  // By tier
  const byTier: Record<string, { generated: number; executed: number; filtered: number }> = {};
  for (const s of signalLog) {
    if (!byTier[s.tier]) byTier[s.tier] = { generated: 0, executed: 0, filtered: 0 };
    byTier[s.tier].generated++;
    if (s.outcome === 'executed') byTier[s.tier].executed++;
    else byTier[s.tier].filtered++;
  }

  return {
    totalGenerated,
    totalExecuted,
    totalFiltered,
    executionRate: totalGenerated > 0 ? `${((totalExecuted / totalGenerated) * 100).toFixed(1)}%` : '0%',
    filterReasons,
    byTier,
    recentSignals: signalLog.slice(-50).reverse(),
  };
}

export function getSignalLog(): SignalEvent[] {
  return signalLog;
}
