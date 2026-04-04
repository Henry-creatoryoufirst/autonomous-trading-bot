/**
 * Never Rest Capital — Portfolio Cost Basis Module
 * Extracted from agent-v3.2.ts (Phase 10 refactor)
 *
 * Tracks average cost basis, realized/unrealized P&L, and position peaks.
 */

export { getOrCreateCostBasis, updateCostBasisAfterBuy, updateCostBasisAfterSell, updateUnrealizedPnL, rebuildCostBasisFromTrades } from './cost-basis.js';
