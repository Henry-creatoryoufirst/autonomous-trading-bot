/**
 * Unit tests for onchain-flow.ts (Stream S).
 *
 * Covers the pure decode/classify/aggregate primitives — no RPC mocking.
 * The async getOnChainFlow() path is exercised indirectly on staging.
 */

import { describe, it, expect } from 'vitest';
import {
  decodeV2SwapLog,
  decodeV3SwapLog,
  classifySwap,
  aggregateSwaps,
  filterSwapsByMinBlock,
  v3SwapPriceUSD,
  v2SwapPriceUSD,
  type RawSwapLog,
  type PoolDescriptor,
  type ClassifiedSwap,
} from '../onchain-flow.js';

// ---------------------------------------------------------------------------
// Fixtures: encode int256 / uint256 helpers
// ---------------------------------------------------------------------------

function int256Hex(n: bigint): string {
  const MOD = 1n << 256n;
  const v = n < 0n ? MOD + n : n;
  return v.toString(16).padStart(64, '0');
}
function uint256Hex(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

function makeV3Log(opts: {
  blockNumber: number;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity?: bigint;
  tick?: bigint;
}): RawSwapLog {
  const data =
    '0x' +
    int256Hex(opts.amount0) +
    int256Hex(opts.amount1) +
    uint256Hex(opts.sqrtPriceX96) +
    uint256Hex(opts.liquidity ?? 0n) +
    int256Hex(opts.tick ?? 0n);
  return {
    blockNumber: '0x' + opts.blockNumber.toString(16),
    transactionHash: '0x' + 'a'.repeat(64),
    logIndex: '0x0',
    data,
    topics: [],
  };
}

function makeV2Log(opts: {
  blockNumber: number;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
}): RawSwapLog {
  const data =
    '0x' +
    uint256Hex(opts.amount0In) +
    uint256Hex(opts.amount1In) +
    uint256Hex(opts.amount0Out) +
    uint256Hex(opts.amount1Out);
  return {
    blockNumber: '0x' + opts.blockNumber.toString(16),
    transactionHash: '0x' + 'b'.repeat(64),
    logIndex: '0x0',
    data,
    topics: [],
  };
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

describe('decodeV3SwapLog', () => {
  it('decodes positive and negative amounts (signed int256)', () => {
    const log = makeV3Log({
      blockNumber: 1000,
      amount0: -123456789n,
      amount1: 987654321n,
      sqrtPriceX96: 79228162514264337593543950336n, // 2^96 → price = 1
    });
    const decoded = decodeV3SwapLog(log);
    expect(decoded).not.toBeNull();
    expect(decoded!.amount0).toBe(-123456789n);
    expect(decoded!.amount1).toBe(987654321n);
    expect(decoded!.sqrtPriceX96).toBe(79228162514264337593543950336n);
    expect(decoded!.blockNumber).toBe(1000);
  });

  it('returns null for malformed (too-short) data', () => {
    const log: RawSwapLog = {
      blockNumber: '0x1',
      transactionHash: '0x',
      logIndex: '0x0',
      data: '0xdeadbeef',
      topics: [],
    };
    expect(decodeV3SwapLog(log)).toBeNull();
  });
});

describe('decodeV2SwapLog', () => {
  it('decodes the four unsigned amounts', () => {
    const log = makeV2Log({
      blockNumber: 500,
      amount0In: 1000n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 2000n,
    });
    const decoded = decodeV2SwapLog(log);
    expect(decoded).not.toBeNull();
    expect(decoded!.amount0In).toBe(1000n);
    expect(decoded!.amount1Out).toBe(2000n);
    expect(decoded!.blockNumber).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// classifySwap — V3
// ---------------------------------------------------------------------------

const V3_POOL_TOKEN0_BASE: PoolDescriptor = {
  poolAddress: '0xpool',
  poolType: 'uniswapV3',
  token0IsBase: true,
  token0Decimals: 18, // base token = 18 dec (e.g. AERO)
  token1Decimals: 18, // quote = WETH
  quoteToken: 'WETH',
};

const V3_POOL_TOKEN1_BASE: PoolDescriptor = {
  ...V3_POOL_TOKEN0_BASE,
  token0IsBase: false,
};

describe('classifySwap — V3', () => {
  it('BUY when token0 is base and amount0 < 0 (token0 leaves pool)', () => {
    const swap = decodeV3SwapLog(
      makeV3Log({
        blockNumber: 1,
        amount0: -1_000_000_000_000_000_000n, // -1 token0
        amount1: 2_000_000_000_000_000_000n, // +2 token1
        sqrtPriceX96: 79228162514264337593543950336n, // price = 1
      }),
    )!;
    const c = classifySwap(swap, V3_POOL_TOKEN0_BASE, 100, 100);
    expect(c).not.toBeNull();
    expect(c!.isBuy).toBe(true);
    expect(c!.swapValueUSD).toBeCloseTo(100, 5); // |amount0|/1e18 * $100
  });

  it('SELL when token0 is base and amount0 > 0', () => {
    const swap = decodeV3SwapLog(
      makeV3Log({
        blockNumber: 2,
        amount0: 3_000_000_000_000_000_000n,
        amount1: -1_000_000_000_000_000_000n,
        sqrtPriceX96: 79228162514264337593543950336n,
      }),
    )!;
    const c = classifySwap(swap, V3_POOL_TOKEN0_BASE, 50, 100);
    expect(c).not.toBeNull();
    expect(c!.isBuy).toBe(false);
    expect(c!.swapValueUSD).toBeCloseTo(150, 5); // 3 * $50
  });

  it('BUY when token0 is quote and amount1 < 0 (base = token1, leaves pool)', () => {
    const swap = decodeV3SwapLog(
      makeV3Log({
        blockNumber: 3,
        amount0: 5_000_000_000_000_000_000n,
        amount1: -2_000_000_000_000_000_000n,
        sqrtPriceX96: 79228162514264337593543950336n,
      }),
    )!;
    const c = classifySwap(swap, V3_POOL_TOKEN1_BASE, 25, 100);
    expect(c).not.toBeNull();
    expect(c!.isBuy).toBe(true);
    expect(c!.swapValueUSD).toBeCloseTo(50, 5); // 2 * $25
  });

  it('SELL when token0 is quote and amount1 > 0', () => {
    const swap = decodeV3SwapLog(
      makeV3Log({
        blockNumber: 4,
        amount0: -2_000_000_000_000_000_000n,
        amount1: 4_000_000_000_000_000_000n,
        sqrtPriceX96: 79228162514264337593543950336n,
      }),
    )!;
    const c = classifySwap(swap, V3_POOL_TOKEN1_BASE, 10, 100);
    expect(c).not.toBeNull();
    expect(c!.isBuy).toBe(false);
    expect(c!.swapValueUSD).toBeCloseTo(40, 5);
  });

  it('returns null when current price is zero', () => {
    const swap = decodeV3SwapLog(
      makeV3Log({
        blockNumber: 5,
        amount0: -1n,
        amount1: 1n,
        sqrtPriceX96: 79228162514264337593543950336n,
      }),
    )!;
    expect(classifySwap(swap, V3_POOL_TOKEN0_BASE, 0, 100)).toBeNull();
  });

  it('rejects implausibly large swap values (decode-glitch guard)', () => {
    const swap = decodeV3SwapLog(
      makeV3Log({
        blockNumber: 6,
        // 1e50 base-token raw, at 18 dec → 1e32 tokens. Times $1 → $1e32. > $10M cap.
        amount0: -(10n ** 50n),
        amount1: 1n,
        sqrtPriceX96: 79228162514264337593543950336n,
      }),
    )!;
    expect(classifySwap(swap, V3_POOL_TOKEN0_BASE, 1, 100)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifySwap — V2
// ---------------------------------------------------------------------------

const V2_POOL_TOKEN0_BASE: PoolDescriptor = {
  poolAddress: '0xpool2',
  poolType: 'aerodrome',
  token0IsBase: true,
  token0Decimals: 18,
  token1Decimals: 6, // USDC
  quoteToken: 'USDC',
};

// When token1 is the base, the decimals layout flips too: token0 = USDC (6),
// token1 = base (18).
const V2_POOL_TOKEN1_BASE: PoolDescriptor = {
  ...V2_POOL_TOKEN0_BASE,
  token0IsBase: false,
  token0Decimals: 6,
  token1Decimals: 18,
};

describe('classifySwap — V2', () => {
  it('BUY when token0 is base and amount0Out > 0', () => {
    const swap = decodeV2SwapLog(
      makeV2Log({
        blockNumber: 10,
        amount0In: 0n,
        amount1In: 100_000_000n, // 100 USDC in (6 dec)
        amount0Out: 1_000_000_000_000_000_000n, // 1 base out (18 dec)
        amount1Out: 0n,
      }),
    )!;
    const c = classifySwap(swap, V2_POOL_TOKEN0_BASE, 100, 1);
    expect(c).not.toBeNull();
    expect(c!.isBuy).toBe(true);
    expect(c!.swapValueUSD).toBeCloseTo(100, 3);
  });

  it('SELL when token0 is base and amount0In > 0', () => {
    const swap = decodeV2SwapLog(
      makeV2Log({
        blockNumber: 11,
        amount0In: 2_000_000_000_000_000_000n, // 2 base in
        amount1In: 0n,
        amount0Out: 0n,
        amount1Out: 200_000_000n, // 200 USDC out
      }),
    )!;
    const c = classifySwap(swap, V2_POOL_TOKEN0_BASE, 100, 1);
    expect(c).not.toBeNull();
    expect(c!.isBuy).toBe(false);
    expect(c!.swapValueUSD).toBeCloseTo(200, 3);
  });

  it('BUY when token1 is base and amount1Out > 0', () => {
    const swap = decodeV2SwapLog(
      makeV2Log({
        blockNumber: 12,
        amount0In: 50_000_000n, // 50 USDC in (6 dec)
        amount1In: 0n,
        amount0Out: 0n,
        amount1Out: 500_000_000_000_000_000n, // 0.5 base out (18 dec)
      }),
    )!;
    const c = classifySwap(swap, V2_POOL_TOKEN1_BASE, 100, 1);
    expect(c).not.toBeNull();
    expect(c!.isBuy).toBe(true);
    expect(c!.swapValueUSD).toBeCloseTo(50, 3);
  });

  it('SELL when token1 is base and amount1In > 0', () => {
    const swap = decodeV2SwapLog(
      makeV2Log({
        blockNumber: 13,
        amount0In: 0n,
        amount1In: 1_000_000_000_000_000_000n, // 1 base in
        amount0Out: 99_000_000n,
        amount1Out: 0n,
      }),
    )!;
    const c = classifySwap(swap, V2_POOL_TOKEN1_BASE, 99, 1);
    expect(c).not.toBeNull();
    expect(c!.isBuy).toBe(false);
    expect(c!.swapValueUSD).toBeCloseTo(99, 3);
  });

  it('returns null when both In and Out sides are empty (malformed)', () => {
    const swap = decodeV2SwapLog(
      makeV2Log({
        blockNumber: 14,
        amount0In: 0n,
        amount1In: 0n,
        amount0Out: 0n,
        amount1Out: 0n,
      }),
    )!;
    expect(classifySwap(swap, V2_POOL_TOKEN0_BASE, 100, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Price extractors
// ---------------------------------------------------------------------------

describe('v3SwapPriceUSD', () => {
  it('returns base * quote price when token0IsBase and sqrtPriceX96 = 2^96', () => {
    // sqrtPriceX96 = 2^96 → raw token1/token0 ratio = 1
    const swap = decodeV3SwapLog(
      makeV3Log({
        blockNumber: 0,
        amount0: -1n,
        amount1: 1n,
        sqrtPriceX96: 79228162514264337593543950336n,
      }),
    )!;
    // Equal decimals → adjustedPrice = 1 → base price in quote = 1 → USD = 1 * 2000
    const price = v3SwapPriceUSD(swap, V3_POOL_TOKEN0_BASE, 2000);
    expect(price).toBeCloseTo(2000, 2);
  });

  it('inverts ratio when token0 is quote', () => {
    const swap = decodeV3SwapLog(
      makeV3Log({
        blockNumber: 0,
        amount0: -1n,
        amount1: 1n,
        sqrtPriceX96: 79228162514264337593543950336n,
      }),
    )!;
    // token1 is base → base price in quote = 1/1 = 1 → USD = 1 * 2000
    const price = v3SwapPriceUSD(swap, V3_POOL_TOKEN1_BASE, 2000);
    expect(price).toBeCloseTo(2000, 2);
  });
});

describe('v2SwapPriceUSD', () => {
  it('computes execution price from amount ratio', () => {
    const swap = decodeV2SwapLog(
      makeV2Log({
        blockNumber: 0,
        amount0In: 0n,
        amount1In: 100_000_000n, // 100 USDC in
        amount0Out: 1_000_000_000_000_000_000n, // 1 base out
        amount1Out: 0n,
      }),
    )!;
    // token0 = base (18 dec), token1 = USDC (6 dec)
    // token1Amt/token0Amt = 100/1 = 100 USDC per base → base price = 100 USD
    const price = v2SwapPriceUSD(swap, V2_POOL_TOKEN0_BASE, 1);
    expect(price).toBeCloseTo(100, 3);
  });
});

// ---------------------------------------------------------------------------
// aggregateSwaps + filterSwapsByMinBlock
// ---------------------------------------------------------------------------

describe('aggregateSwaps', () => {
  it('returns zeros for empty input', () => {
    const a = aggregateSwaps([]);
    expect(a.buys).toBe(0);
    expect(a.sells).toBe(0);
    expect(a.buyVolumeUSD).toBe(0);
    expect(a.sellVolumeUSD).toBe(0);
    expect(a.volumeUSD).toBe(0);
    expect(a.avgTradeUSD).toBe(0);
    expect(a.firstPriceUSD).toBeNull();
    expect(a.lastPriceUSD).toBeNull();
  });

  it('counts a single buy correctly', () => {
    const swaps: ClassifiedSwap[] = [
      { blockNumber: 1, isBuy: true, swapValueUSD: 100, executionPriceUSD: 50 },
    ];
    const a = aggregateSwaps(swaps);
    expect(a.buys).toBe(1);
    expect(a.sells).toBe(0);
    expect(a.buyVolumeUSD).toBe(100);
    expect(a.volumeUSD).toBe(100);
    expect(a.avgTradeUSD).toBe(100);
    expect(a.firstPriceUSD).toBe(50);
    expect(a.lastPriceUSD).toBe(50);
  });

  it('sums buys + sells and picks first/last price by block order', () => {
    const swaps: ClassifiedSwap[] = [
      { blockNumber: 5, isBuy: true, swapValueUSD: 200, executionPriceUSD: 102 },
      { blockNumber: 2, isBuy: false, swapValueUSD: 50, executionPriceUSD: 100 },
      { blockNumber: 8, isBuy: true, swapValueUSD: 150, executionPriceUSD: 105 },
      { blockNumber: 1, isBuy: true, swapValueUSD: 100, executionPriceUSD: 99 },
    ];
    const a = aggregateSwaps(swaps);
    expect(a.buys).toBe(3);
    expect(a.sells).toBe(1);
    expect(a.buyVolumeUSD).toBe(450);
    expect(a.sellVolumeUSD).toBe(50);
    expect(a.volumeUSD).toBe(500);
    expect(a.avgTradeUSD).toBe(125);
    expect(a.firstPriceUSD).toBe(99); // block 1
    expect(a.lastPriceUSD).toBe(105); // block 8
  });

  it('ignores swaps with zero execution price when picking first/last', () => {
    const swaps: ClassifiedSwap[] = [
      { blockNumber: 1, isBuy: true, swapValueUSD: 100, executionPriceUSD: 0 },
      { blockNumber: 2, isBuy: true, swapValueUSD: 100, executionPriceUSD: 50 },
      { blockNumber: 3, isBuy: true, swapValueUSD: 100, executionPriceUSD: 0 },
    ];
    const a = aggregateSwaps(swaps);
    expect(a.buys).toBe(3);
    expect(a.firstPriceUSD).toBe(50);
    expect(a.lastPriceUSD).toBe(50);
  });
});

describe('filterSwapsByMinBlock', () => {
  it('keeps swaps at or above the threshold', () => {
    const swaps: ClassifiedSwap[] = [
      { blockNumber: 1, isBuy: true, swapValueUSD: 1, executionPriceUSD: 1 },
      { blockNumber: 5, isBuy: true, swapValueUSD: 1, executionPriceUSD: 1 },
      { blockNumber: 10, isBuy: true, swapValueUSD: 1, executionPriceUSD: 1 },
    ];
    expect(filterSwapsByMinBlock(swaps, 5)).toHaveLength(2);
    expect(filterSwapsByMinBlock(swaps, 11)).toHaveLength(0);
    expect(filterSwapsByMinBlock(swaps, 0)).toHaveLength(3);
  });
});
