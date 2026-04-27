/**
 * Type re-export shim — patterns reference TradeDecision through this file
 * so the patterns module has a single, narrow surface to the rest of the
 * bot. When the cycle/decision types are reorganized for v22 cutover,
 * only this file changes; pattern modules don't need to know.
 */

export type { TradeDecision } from "../types/market-data.js";
