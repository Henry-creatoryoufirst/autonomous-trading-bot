/**
 * Strategy Version Registry
 *
 * Historical strategy configurations mapped by version number.
 * Enables replaying any version against price history for comparison.
 */

export interface StrategyVersionConfig {
  profitTakePercent: number;
  stopLossPercent: number;
  kellyFraction: number;
  maxPositionPercent: number;
  minPositionUSD: number;
  cashDeployThreshold: number;
  maxTradesPerCycle: number;
  confluenceBuyThreshold: number;
  confluenceSellThreshold: number;
  smartTrimEnabled?: boolean;
}

export interface StrategyVersion {
  version: string;
  name: string;
  description: string;
  config: StrategyVersionConfig;
}

// ============================================================================
// VERSION REGISTRY — evolution of the trading strategy
// ============================================================================

export const STRATEGY_VERSIONS: StrategyVersion[] = [
  {
    version: "v8.0",
    name: "Conservative",
    description: "Quarter-Kelly institutional risk management with wide stops",
    config: {
      profitTakePercent: 20,
      stopLossPercent: 25,
      kellyFraction: 0.25,
      maxPositionPercent: 10,
      minPositionUSD: 5,
      cashDeployThreshold: 50,
      maxTradesPerCycle: 8,
      confluenceBuyThreshold: 20,
      confluenceSellThreshold: -20,
    },
  },
  {
    version: "v10.0",
    name: "Market Intelligence",
    description: "Tighter stops, lower buy threshold for faster entries",
    config: {
      profitTakePercent: 20,
      stopLossPercent: 15,
      kellyFraction: 0.25,
      maxPositionPercent: 10,
      minPositionUSD: 5,
      cashDeployThreshold: 50,
      maxTradesPerCycle: 8,
      confluenceBuyThreshold: 15,
      confluenceSellThreshold: -25,
    },
  },
  {
    version: "v12.0",
    name: "On-Chain Pricing",
    description: "Reduced trade frequency, stronger sell conviction required",
    config: {
      profitTakePercent: 20,
      stopLossPercent: 15,
      kellyFraction: 0.25,
      maxPositionPercent: 10,
      minPositionUSD: 5,
      cashDeployThreshold: 50,
      maxTradesPerCycle: 5,
      confluenceBuyThreshold: 15,
      confluenceSellThreshold: -30,
    },
  },
  {
    version: "v13.0",
    name: "Momentum",
    description: "Half-Kelly sizing, larger positions, aggressive deployment",
    config: {
      profitTakePercent: 30,
      stopLossPercent: 15,
      kellyFraction: 0.5,
      maxPositionPercent: 18,
      minPositionUSD: 15,
      cashDeployThreshold: 25,
      maxTradesPerCycle: 5,
      confluenceBuyThreshold: 10,
      confluenceSellThreshold: -30,
    },
  },
  {
    version: "v14.0",
    name: "Market-Aware",
    description: "Higher cash reserve threshold, fewer but higher-conviction trades",
    config: {
      profitTakePercent: 30,
      stopLossPercent: 15,
      kellyFraction: 0.5,
      maxPositionPercent: 18,
      minPositionUSD: 15,
      cashDeployThreshold: 40,
      maxTradesPerCycle: 3,
      confluenceBuyThreshold: 15,
      confluenceSellThreshold: -30,
    },
  },
  {
    version: "v14.1",
    name: "Smart Trim",
    description: "v14.0 with deceleration-based position trimming enabled",
    config: {
      profitTakePercent: 30,
      stopLossPercent: 15,
      kellyFraction: 0.5,
      maxPositionPercent: 18,
      minPositionUSD: 15,
      cashDeployThreshold: 40,
      maxTradesPerCycle: 3,
      confluenceBuyThreshold: 15,
      confluenceSellThreshold: -30,
      smartTrimEnabled: true,
    },
  },
  {
    version: "aggressive",
    name: "Aggressive",
    description: "High Kelly fraction, tight stops, max concentration",
    config: {
      profitTakePercent: 40,
      stopLossPercent: 10,
      kellyFraction: 0.7,
      maxPositionPercent: 25,
      minPositionUSD: 20,
      cashDeployThreshold: 20,
      maxTradesPerCycle: 5,
      confluenceBuyThreshold: 10,
      confluenceSellThreshold: -25,
    },
  },
  {
    version: "conservative",
    name: "Ultra-Conservative",
    description: "Minimal risk, wide cash buffer, small positions",
    config: {
      profitTakePercent: 15,
      stopLossPercent: 8,
      kellyFraction: 0.2,
      maxPositionPercent: 10,
      minPositionUSD: 10,
      cashDeployThreshold: 60,
      maxTradesPerCycle: 2,
      confluenceBuyThreshold: 25,
      confluenceSellThreshold: -15,
    },
  },
];

// ============================================================================
// LOOKUP
// ============================================================================

/**
 * Get a strategy version by its version string.
 * Throws if not found.
 */
export function getVersion(id: string): StrategyVersion {
  const v = STRATEGY_VERSIONS.find(
    (sv) => sv.version === id || sv.version === `v${id}` || sv.name.toLowerCase() === id.toLowerCase()
  );
  if (!v) throw new Error(`Strategy version "${id}" not found. Available: ${STRATEGY_VERSIONS.map(s => s.version).join(", ")}`);
  return v;
}

/**
 * Convert a StrategyVersionConfig to the SimConfig format used by simulator.ts
 */
export function toSimConfig(config: StrategyVersionConfig, startingCapital = 500) {
  return {
    startingCapital,
    profitTakePercent: config.profitTakePercent,
    stopLossPercent: config.stopLossPercent,
    kellyFraction: config.kellyFraction,
    maxPositionPercent: config.maxPositionPercent,
    minPositionUSD: config.minPositionUSD,
    cashDeployThreshold: config.cashDeployThreshold,
  };
}
