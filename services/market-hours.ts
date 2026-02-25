/**
 * Schertzinger Trading Command — Market Session Awareness (v6.0)
 *
 * Tracks US equity market sessions and adjusts strategy accordingly.
 * Pre-market, regular, after-hours, extended, weekend, holiday.
 */

// ============================================================================
// TYPES
// ============================================================================

export type MarketSession =
  | 'PRE_MARKET'     // 4:00 AM - 9:30 AM ET
  | 'REGULAR'        // 9:30 AM - 4:00 PM ET
  | 'AFTER_HOURS'    // 4:00 PM - 8:00 PM ET
  | 'CLOSED'         // 8:00 PM - 4:00 AM ET
  | 'WEEKEND'        // Saturday & Sunday
  | 'HOLIDAY';       // Market holidays

export interface SessionInfo {
  session: MarketSession;
  positionSizeMultiplier: number;  // 0.0 to 1.0
  canTrade: boolean;
  description: string;
  minutesToNextSession: number;
  nextSession: MarketSession;
}

// ============================================================================
// US MARKET HOLIDAYS 2026
// ============================================================================

const US_MARKET_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
];

// ============================================================================
// SESSION DETECTION
// ============================================================================

export class MarketHoursEngine {
  /**
   * Get the current market session and its parameters.
   */
  getCurrentSession(): SessionInfo {
    const now = new Date();
    const etNow = this.toEasternTime(now);

    // Check weekend
    const dayOfWeek = etNow.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        session: 'WEEKEND',
        positionSizeMultiplier: 0,
        canTrade: false,
        description: 'Market closed — weekend',
        minutesToNextSession: this.minutesUntilNextOpen(etNow),
        nextSession: 'PRE_MARKET',
      };
    }

    // Check holidays
    const dateStr = etNow.toISOString().slice(0, 10);
    if (US_MARKET_HOLIDAYS_2026.includes(dateStr)) {
      return {
        session: 'HOLIDAY',
        positionSizeMultiplier: 0,
        canTrade: false,
        description: `Market closed — US holiday (${dateStr})`,
        minutesToNextSession: this.minutesUntilNextOpen(etNow),
        nextSession: 'PRE_MARKET',
      };
    }

    // Determine session by time
    const hours = etNow.getHours();
    const minutes = etNow.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // Pre-market: 4:00 AM - 9:30 AM ET
    if (totalMinutes >= 240 && totalMinutes < 570) {
      return {
        session: 'PRE_MARKET',
        positionSizeMultiplier: 0.5,
        canTrade: true,
        description: 'Pre-market session — reduced liquidity, half position sizes',
        minutesToNextSession: 570 - totalMinutes,
        nextSession: 'REGULAR',
      };
    }

    // Regular: 9:30 AM - 4:00 PM ET
    if (totalMinutes >= 570 && totalMinutes < 960) {
      return {
        session: 'REGULAR',
        positionSizeMultiplier: 1.0,
        canTrade: true,
        description: 'Regular market hours — full liquidity',
        minutesToNextSession: 960 - totalMinutes,
        nextSession: 'AFTER_HOURS',
      };
    }

    // After-hours: 4:00 PM - 8:00 PM ET
    if (totalMinutes >= 960 && totalMinutes < 1200) {
      return {
        session: 'AFTER_HOURS',
        positionSizeMultiplier: 0.3,
        canTrade: true,
        description: 'After-hours session — thin liquidity, small positions only',
        minutesToNextSession: 1200 - totalMinutes,
        nextSession: 'CLOSED',
      };
    }

    // Closed: 8:00 PM - 4:00 AM ET
    return {
      session: 'CLOSED',
      positionSizeMultiplier: 0,
      canTrade: false,
      description: 'Market closed — overnight',
      minutesToNextSession: totalMinutes < 240 ? 240 - totalMinutes : (24 * 60 - totalMinutes + 240),
      nextSession: 'PRE_MARKET',
    };
  }

  /**
   * Check if the market is currently open for trading (any session).
   */
  isMarketOpen(): boolean {
    const session = this.getCurrentSession();
    return session.canTrade;
  }

  /**
   * Get position size multiplier for current session.
   */
  getPositionMultiplier(): number {
    return this.getCurrentSession().positionSizeMultiplier;
  }

  /**
   * Format session info for logging or dashboard.
   */
  getSessionSummary(): string {
    const info = this.getCurrentSession();
    if (!info.canTrade) {
      return `${info.session} (${info.description}) | Opens in ${info.minutesToNextSession}m`;
    }
    return `${info.session} | Size: ${(info.positionSizeMultiplier * 100).toFixed(0)}% | Ends in ${info.minutesToNextSession}m`;
  }

  // ---- Private helpers ----

  private toEasternTime(date: Date): Date {
    // Convert to Eastern Time using locale string trick
    const etString = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(etString);
  }

  private minutesUntilNextOpen(etNow: Date): number {
    const dayOfWeek = etNow.getDay();
    let daysUntilMonday = 0;

    if (dayOfWeek === 6) daysUntilMonday = 2; // Saturday → Monday
    else if (dayOfWeek === 0) daysUntilMonday = 1; // Sunday → Monday
    else daysUntilMonday = 1; // Next trading day

    const hours = etNow.getHours();
    const minutes = etNow.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // Pre-market opens at 4:00 AM ET
    const minutesLeftToday = (24 * 60) - totalMinutes;
    return minutesLeftToday + ((daysUntilMonday - 1) * 24 * 60) + 240; // 4:00 AM = 240 minutes
  }
}

// Singleton
export const marketHours = new MarketHoursEngine();
