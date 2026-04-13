/**
 * NVR Gas Manager — Cost Ledger
 *
 * Tracks all top-up events in memory.
 * Exposes per-bot summaries for the /status endpoint.
 * v2: persist to Railway volume or Vercel KV for cross-restart history.
 */

export interface TopUpEvent {
  botLabel: string;
  botAddress: string;
  ethSent: number;
  ethBefore: number;
  reserveAfter: number;
  timestamp: number;
  txHash: string;
}

const events: TopUpEvent[] = [];

export function recordTopUp(event: TopUpEvent): void {
  events.push(event);
}

export interface BotSummary {
  label: string;
  address: string;
  totalTopUps: number;
  totalEthReceived: number;
  lastTopUpAt: number | null;
}

export function getSummaries(): BotSummary[] {
  const byBot = new Map<string, BotSummary>();

  for (const e of events) {
    const key = e.botAddress;
    if (!byBot.has(key)) {
      byBot.set(key, {
        label: e.botLabel,
        address: e.botAddress,
        totalTopUps: 0,
        totalEthReceived: 0,
        lastTopUpAt: null,
      });
    }
    const s = byBot.get(key)!;
    s.totalTopUps++;
    s.totalEthReceived += e.ethSent;
    s.lastTopUpAt = Math.max(s.lastTopUpAt ?? 0, e.timestamp);
  }

  return Array.from(byBot.values());
}

export function getAllEvents(): TopUpEvent[] {
  return [...events];
}

export function getTotalEthSpent(): number {
  return events.reduce((sum, e) => sum + e.ethSent, 0);
}
