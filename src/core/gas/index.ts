/**
 * Never Rest Capital — Gas & Liquidity Module
 * Extracted from agent-v3.2.ts (Phase 13 refactor)
 *
 * Pre-trade gas checks, pool liquidity validation, and trade sizing.
 */

export { fetchPoolLiquidity, checkLiquidity, fetchGasPrice, checkGasCost } from './gas-liquidity.js';
export {
  initGasManager,
  checkAndRefuelGas,
  bootstrapGas,
  rescueGasFromNvrTrading,
  getLastKnownETHBalance,
  isGasBootstrapAttempted,
} from './gas-manager.js';
