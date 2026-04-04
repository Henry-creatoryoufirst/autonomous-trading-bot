/**
 * Never Rest Capital — Execution Module
 * Barrel re-exports for execution engine extracted from agent-v3.2.ts
 */

export { initRpc, getCurrentRpc, rotateRpc, rpcCall, getETHBalance, getERC20Balance } from './rpc.js';
export { buildAerodromeExactInputSingleCalldata, buildExactInputSingleCalldata, buildExactInputMultihopCalldata, encodeV3Path } from './calldata.js';
export { initExecutionHelpers, getTokenAddress, getTokenDecimals } from './helpers.js';
