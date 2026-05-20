/**
 * NVR-SPEC-035 Phase A.1 — Source D: live on-chain wallet poll.
 *
 * The fourth INV-1 source — direct eth_call to Base RPC for every token
 * the wallet could plausibly hold. Independent of every in-state cache
 * the bot maintains (state.costBasis, state.trading.balances,
 * state.trading.totalPortfolioValue), so it can DISAGREE with them when
 * they're wrong. This is the source that would have caught the May-20
 * aUSDC drift the moment it appeared (vs weeks-later when Henry asked).
 *
 * Design constraints:
 *   - Pure read function. No state mutations. Caller is responsible for
 *     cadence (don't call every cycle — RPC cost would be prohibitive).
 *   - Failure-tolerant. Per-token RPC failures don't crash the snapshot;
 *     they reduce coverage and surface via `complete=false`.
 *   - Includes yield-receipt tokens (aBasUSDC, Morpho vault shares) so
 *     PR #32's accounting is independently verifiable on-chain.
 *   - USD valuation uses the bot's existing lastKnownPrices map for
 *     market-priced tokens, special-cases the yield tokens (1:1 USDC
 *     for aUSDC, share-to-asset conversion for Morpho).
 */

import { getERC20Balance, getETHBalance } from '../../execution/rpc.js';

// ============================================================================
// TYPES
// ============================================================================

export interface LiveOnChainBalance {
  symbol: string;
  contractAddress: string;       // 'native' for ETH
  balance: number;               // human-readable units (decimals already applied)
  decimals: number;
  /** USD value computed from the supplied price/conversion. 0 if unresolved. */
  usdValueChainTruth: number;
  /** True iff we could compute usdValueChainTruth from a real price/conversion. */
  priceResolved: boolean;
}

export interface LiveOnChainSnapshot {
  walletAddress: string;
  capturedAt: string;
  balances: LiveOnChainBalance[];
  totalUsd: number;
  /** All non-zero positions had resolvable prices. */
  fullyPriced: boolean;
  /** Snapshot completed without per-token RPC errors. */
  complete: boolean;
  errors: string[];
}

export interface LiveOnChainTokenSpec {
  symbol: string;
  address: string;          // 'native' for ETH
  decimals: number;
}

export interface YieldReceiptSpec {
  symbol: string;
  address: string;
  decimals: number;
  /** How to convert raw balance to USD. For aUSDC: balance × 1. For Morpho: convertSharesToUSDC. */
  toUsd: (balance: number) => Promise<number>;
}

// ============================================================================
// SNAPSHOT CAPTURE
// ============================================================================

const NATIVE_ETH_SYMBOL = 'ETH';
const ETH_PRICE_FALLBACK_SYMBOL = 'WETH'; // ETH price is mirrored from WETH

/**
 * Pull live balances for every token the bot could hold + every yield-receipt
 * token registered. Returns a fully-typed snapshot for INV-10 to consume.
 *
 * Callers are responsible for cadence — this fires ~N+M+1 RPC calls
 * (one per TOKEN_REGISTRY entry, one per yield-receipt-token, one for
 * native ETH). At 25 tokens + 2 yield tokens + ETH, that's ~28 eth_call
 * round-trips. Call every 6-12 cycles, not every cycle.
 */
export async function captureLiveOnChainSnapshot(args: {
  walletAddress: string;
  tokens: LiveOnChainTokenSpec[];
  yieldReceiptTokens: YieldReceiptSpec[];
  prices: Record<string, { price: number }>;
}): Promise<LiveOnChainSnapshot> {
  const { walletAddress, tokens, yieldReceiptTokens, prices } = args;
  const errors: string[] = [];
  const balances: LiveOnChainBalance[] = [];

  // 1) Iterate every ERC-20 token spec (cohort + tracked tokens)
  for (const token of tokens) {
    try {
      let rawBalance: number;
      if (token.address === 'native') {
        rawBalance = await getETHBalance(walletAddress);
      } else {
        rawBalance = await getERC20Balance(token.address, walletAddress, token.decimals);
      }

      // Resolve USD price for valuation. USDC is 1:1. ETH/WETH share price.
      let priceUsd = 0;
      let priceResolved = false;
      if (token.symbol === 'USDC') {
        priceUsd = 1;
        priceResolved = true;
      } else if (rawBalance === 0) {
        // No need to price an empty balance. Mark resolved so it doesn't
        // poison the fullyPriced check.
        priceResolved = true;
      } else {
        const direct = prices[token.symbol]?.price;
        const ethFallback = token.symbol === NATIVE_ETH_SYMBOL
          ? prices[ETH_PRICE_FALLBACK_SYMBOL]?.price
          : undefined;
        priceUsd = direct ?? ethFallback ?? 0;
        priceResolved = priceUsd > 0;
      }

      balances.push({
        symbol: token.symbol,
        contractAddress: token.address,
        balance: rawBalance,
        decimals: token.decimals,
        usdValueChainTruth: rawBalance * priceUsd,
        priceResolved,
      });
    } catch (err: unknown) {
      const msg = (err as Error).message?.slice(0, 120) || String(err);
      errors.push(`${token.symbol}: ${msg}`);
    }
  }

  // 2) Yield-protocol receipt tokens use service-provided USD converters.
  //    These are the positions that drove the May-20 incident — aUSDC + mUSDC
  //    must be visible to the auditor's chain-truth source or they recur.
  for (const yieldToken of yieldReceiptTokens) {
    try {
      const rawBalance = await getERC20Balance(yieldToken.address, walletAddress, yieldToken.decimals);
      let usdValue = 0;
      try {
        usdValue = rawBalance > 0 ? await yieldToken.toUsd(rawBalance) : 0;
      } catch (err: unknown) {
        errors.push(`${yieldToken.symbol} toUsd: ${(err as Error).message?.slice(0, 80)}`);
      }
      balances.push({
        symbol: yieldToken.symbol,
        contractAddress: yieldToken.address,
        balance: rawBalance,
        decimals: yieldToken.decimals,
        usdValueChainTruth: usdValue,
        priceResolved: rawBalance === 0 || usdValue > 0,
      });
    } catch (err: unknown) {
      const msg = (err as Error).message?.slice(0, 120) || String(err);
      errors.push(`${yieldToken.symbol}: ${msg}`);
    }
  }

  const totalUsd = balances.reduce((sum, b) => sum + b.usdValueChainTruth, 0);
  const fullyPriced = balances.every(b => b.balance === 0 || b.priceResolved);

  return {
    walletAddress,
    capturedAt: new Date().toISOString(),
    balances,
    totalUsd,
    fullyPriced,
    complete: errors.length === 0,
    errors,
  };
}
