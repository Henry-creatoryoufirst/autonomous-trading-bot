/**
 * Never Rest Capital — Balance Reader
 * Extracted from agent-v3.2.ts (Phase 2 refactor)
 *
 * Reads on-chain ERC-20 token balances with retry logic
 * and sector allocation calculation.
 */

// ============================================================================
// MODULE STATE
// ============================================================================

let _getETHBalance: (address: string) => Promise<number>;
let _getERC20Balance: (address: string, wallet: string, decimals: number) => Promise<number>;
let _tokenRegistry: Record<string, any>;
let _getLastKnownBalances: () => Array<{ symbol: string; balance: number }> | undefined;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initBalanceReader(deps: {
  getETHBalance: (address: string) => Promise<number>;
  getERC20Balance: (address: string, wallet: string, decimals: number) => Promise<number>;
  tokenRegistry: Record<string, any>;
  getLastKnownBalances: () => Array<{ symbol: string; balance: number }> | undefined;
}): void {
  _getETHBalance = deps.getETHBalance;
  _getERC20Balance = deps.getERC20Balance;
  _tokenRegistry = deps.tokenRegistry;
  _getLastKnownBalances = deps.getLastKnownBalances;
}

// ============================================================================
// BALANCE READING
// ============================================================================

export async function readBalances(
  walletAddress: string,
): Promise<Array<{ symbol: string; balance: number; usdValue: number; price?: number; sector?: string }>> {
  const balances: Array<{ symbol: string; balance: number; usdValue: number; price?: number; sector?: string }> = [];

  console.log(`  📡 Reading on-chain balances for ${walletAddress.slice(0, 8)}...`);

  const tokenEntries = Object.entries(_tokenRegistry);
  const results: Array<{ symbol: string; balance: number }> = [];
  const failedTokens: string[] = [];

  // Read balances one at a time with delay — public RPC rate-limits batch calls
  for (let i = 0; i < tokenEntries.length; i++) {
    const [symbol, token] = tokenEntries[i];
    let balance = 0;
    let success = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        balance = token.address === "native"
          ? await _getETHBalance(walletAddress)
          : await _getERC20Balance(token.address, walletAddress, token.decimals);
        success = true;
        break;
      } catch (err: any) {
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        } else {
          console.warn(`  ⚠️ Failed to read ${symbol} after 3 attempts: ${err?.message || err}`);
          failedTokens.push(symbol);
        }
      }
    }

    if (success) results.push({ symbol, balance });
    if (i < tokenEntries.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // Retry failed tokens after cooldown
  if (failedTokens.length > 0) {
    console.log(`  🔄 Retrying ${failedTokens.length} failed tokens after cooldown...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    for (const symbol of failedTokens) {
      const token = _tokenRegistry[symbol];
      try {
        const balance = token.address === "native"
          ? await _getETHBalance(walletAddress)
          : await _getERC20Balance(token.address, walletAddress, token.decimals);
        results.push({ symbol, balance });
        console.log(`  ✅ Retry succeeded for ${symbol}: ${balance}`);
      } catch (err: any) {
        console.warn(`  ❌ Final retry failed for ${symbol}: ${err?.message || err}`);
        // Fall back to last known balance from state
        const lastKnown = _getLastKnownBalances()?.find(b => b.symbol === symbol);
        if (lastKnown && lastKnown.balance > 0) {
          results.push({ symbol, balance: lastKnown.balance });
          console.log(`  📎 Using last known balance for ${symbol}: ${lastKnown.balance}`);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  for (const { symbol, balance } of results) {
    const token = _tokenRegistry[symbol];
    if (balance > 0 || ["USDC", "ETH", "WETH"].includes(symbol)) {
      balances.push({
        symbol, balance,
        usdValue: symbol === "USDC" ? balance : 0,
        sector: token?.sector,
      });
    }
  }

  const nonZero = balances.filter(b => b.balance > 0);
  console.log(`  ✅ Found ${nonZero.length} tokens with balances`);
  for (const b of nonZero) {
    console.log(`     ${b.symbol}: ${b.balance < 0.001 ? b.balance.toFixed(8) : b.balance.toFixed(4)} (${b.symbol === "USDC" ? `$${b.usdValue.toFixed(2)}` : "pending price"})`);
  }
  return balances;
}
