/**
 * NVR-SPEC-022 — Pattern Runtime barrel
 *
 * Single import surface for the rest of the bot:
 *   import { PatternRegistry, stablecoinDepegPattern } from './core/patterns';
 */

export type {
  Pattern,
  PatternRecord,
  PatternState,
  PatternStatus,
  Trigger,
  Conviction,
  ExitDecision,
  Position,
  MarketSnapshot,
  ConfirmContext,
  AskAIOptions,
} from "./types.js";

export { PatternRegistry } from "./registry.js";
export { stablecoinDepegPattern } from "./stablecoin-depeg.js";
export { liquidationCounterTradePattern } from "./liquidation-counter-trade.js";
