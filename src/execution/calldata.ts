/**
 * Never Rest Capital — DEX Swap Calldata Builders
 * Extracted from agent-v3.2.ts (Phase 4 refactor)
 *
 * Pure functions for building Uniswap V3 / Aerodrome swap calldata.
 * No state dependencies — these are pure byte-level encoding functions.
 */

import type { Address } from 'viem';

// ============================================================================
// FUNCTION SELECTORS
// ============================================================================

// exactInputSingle(ExactInputSingleParams) selector: 0x04e45aaf
// struct ExactInputSingleParams {
//   address tokenIn, address tokenOut, uint24 fee,
//   address recipient, uint256 amountIn,
//   uint256 amountOutMinimum, uint160 sqrtPriceLimitX96
// }
const EXACT_INPUT_SINGLE_SELECTOR = "0x04e45aaf";

// exactInput(ExactInputParams) selector: 0xb858183f
// struct ExactInputParams {
//   bytes path, address recipient, uint256 amountIn,
//   uint256 amountOutMinimum
// }
const EXACT_INPUT_SELECTOR = "0xb858183f";

// v20.4.2: Aerodrome Slipstream selectors — different struct layout (has deadline, uses int24 tickSpacing)
const AERO_EXACT_INPUT_SINGLE_SELECTOR = "0xa026383e";
// struct ExactInputSingleParams { address tokenIn, address tokenOut, int24 tickSpacing,
//   address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96 }

// ============================================================================
// CALLDATA BUILDERS
// ============================================================================

/**
 * v20.4.2: Build Aerodrome Slipstream exactInputSingle calldata.
 * Same concept as Uniswap V3 but with tickSpacing instead of fee, and includes deadline.
 */
export function buildAerodromeExactInputSingleCalldata(
  tokenIn: Address,
  tokenOut: Address,
  tickSpacing: number,
  recipient: Address,
  amountIn: bigint,
  amountOutMin: bigint,
): `0x${string}` {
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const params = [
    tokenIn.slice(2).toLowerCase().padStart(64, "0"),
    tokenOut.slice(2).toLowerCase().padStart(64, "0"),
    (tickSpacing < 0 ? (0x1000000 + tickSpacing) : tickSpacing).toString(16).padStart(64, "0"),
    recipient.slice(2).toLowerCase().padStart(64, "0"),
    deadline.toString(16).padStart(64, "0"),
    amountIn.toString(16).padStart(64, "0"),
    amountOutMin.toString(16).padStart(64, "0"),
    "0".padStart(64, "0"),
  ].join("");
  return `${AERO_EXACT_INPUT_SINGLE_SELECTOR}${params}` as `0x${string}`;
}

/**
 * Build Uniswap V3 exactInputSingle calldata.
 */
export function buildExactInputSingleCalldata(
  tokenIn: Address,
  tokenOut: Address,
  fee: number,
  recipient: Address,
  amountIn: bigint,
  amountOutMin: bigint,
): `0x${string}` {
  const params = [
    tokenIn.slice(2).toLowerCase().padStart(64, "0"),
    tokenOut.slice(2).toLowerCase().padStart(64, "0"),
    fee.toString(16).padStart(64, "0"),
    recipient.slice(2).toLowerCase().padStart(64, "0"),
    amountIn.toString(16).padStart(64, "0"),
    amountOutMin.toString(16).padStart(64, "0"),
    "0".padStart(64, "0"),
  ].join("");
  return `${EXACT_INPUT_SINGLE_SELECTOR}${params}` as `0x${string}`;
}

/**
 * Build Uniswap V3 exactInput calldata for multi-hop swaps.
 */
export function buildExactInputMultihopCalldata(
  path: `0x${string}`,
  recipient: Address,
  amountIn: bigint,
  amountOutMin: bigint,
): `0x${string}` {
  const offsetToPath = "0000000000000000000000000000000000000000000000000000000000000080";
  const recipientEncoded = recipient.slice(2).toLowerCase().padStart(64, "0");
  const amountInEncoded = amountIn.toString(16).padStart(64, "0");
  const amountOutMinEncoded = amountOutMin.toString(16).padStart(64, "0");

  const pathHex = path.startsWith("0x") ? path.slice(2) : path;
  const pathByteLength = pathHex.length / 2;
  const pathLengthEncoded = pathByteLength.toString(16).padStart(64, "0");
  const pathPadded = pathHex.padEnd(Math.ceil(pathHex.length / 64) * 64, "0");

  return `${EXACT_INPUT_SELECTOR}${offsetToPath}${recipientEncoded}${amountInEncoded}${amountOutMinEncoded}${pathLengthEncoded}${pathPadded}` as `0x${string}`;
}

/**
 * Encode a multi-hop path for Uniswap V3: tokenIn + fee + intermediary + fee + tokenOut
 */
export function encodeV3Path(tokens: Address[], fees: number[]): `0x${string}` {
  let path = tokens[0].slice(2).toLowerCase();
  for (let i = 0; i < fees.length; i++) {
    path += fees[i].toString(16).padStart(6, "0");
    path += tokens[i + 1].slice(2).toLowerCase();
  }
  return `0x${path}` as `0x${string}`;
}
