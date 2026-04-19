#!/usr/bin/env npx tsx
/**
 * Dry-run harness for the RPC-based USDC deposit detector.
 *
 * Usage:
 *   npx tsx scripts/test-rpc-deposits.ts <0xWalletAddress> [fromBlock]
 *
 * Example (K&H's bot CDP wallet):
 *   npx tsx scripts/test-rpc-deposits.ts 0x3E675ffD5eEBF8613ee93ee491bd9cea67313436
 *
 * Prints every inbound USDC Transfer the wallet has received, the total, and
 * the first-deposit (P&L baseline) figure. No writes. No state mutation.
 */
import { detectDepositsViaRpc } from '../src/core/chain/rpc-deposits.js';

function isHexAddress(s: string): s is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

async function main() {
  const walletArg = process.argv[2];
  const fromBlockArg = process.argv[3];

  if (!walletArg || !isHexAddress(walletArg)) {
    console.error('Usage: npx tsx scripts/test-rpc-deposits.ts <0xWalletAddress> [fromBlock]');
    process.exit(1);
  }

  const wallet = walletArg as `0x${string}`;
  const fromBlock = fromBlockArg ? BigInt(fromBlockArg) : undefined;

  console.log(`\n🔍 Scanning USDC deposits for ${wallet} on Base...`);
  if (fromBlock !== undefined) console.log(`   fromBlock override: ${fromBlock}`);

  const start = Date.now();
  const result = await detectDepositsViaRpc(wallet, { fromBlock, verbose: true });
  const elapsed = Date.now() - start;

  console.log(`\n✅ Scan complete in ${(elapsed / 1000).toFixed(1)}s via ${result.rpcEndpoint}`);
  console.log(
    `   Scanned blocks ${result.scanFromBlock}..${result.scanToBlock} in ${result.chunkCount} chunks`
  );

  console.log(`\n📊 Results:`);
  console.log(`   Total deposited:      $${result.totalDeposited.toFixed(2)}  (${result.deposits.length} txs)`);
  console.log(`   Total withdrawn:      $${result.totalWithdrawn.toFixed(2)}  (${result.withdrawals.length} txs)`);
  console.log(`   Net capital in:       $${(result.totalDeposited - result.totalWithdrawn).toFixed(2)}`);
  console.log(
    `   First deposit:        $${result.firstDepositUSD.toFixed(2)}` +
      (result.firstDepositBlock ? ` (block ${result.firstDepositBlock})` : ' (none)')
  );
  console.log(
    `   Filtered:             ${result.swapReturnsFiltered} swap-ins ($${result.swapReturnsUsdValue.toFixed(2)}) + ${result.buysFiltered} buys ($${result.buysUsdValue.toFixed(2)})`
  );

  if (result.deposits.length > 0) {
    console.log(`\n📝 Deposit log (oldest → newest):`);
    for (const d of result.deposits) {
      console.log(
        `   $${d.amountUSD.toFixed(2).padStart(10)}  from ${d.from}  block ${d.blockNumber}  tx ${d.txHash.slice(0, 12)}…`
      );
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
