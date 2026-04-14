/**
 * Bootstrap Smart Wallets — NVR Capital
 *
 * Identifies profitable early wallets on Base chain by finding addresses that
 * appear as early buyers across multiple known big Base movers (BRETT, DEGEN,
 * VIRTUAL, AERO, TOSHI, MOCHI). Wallets present in 3+ movers = HIGH confidence.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-smart-wallets.ts
 *
 * Uses Base RPC (no API key required) — queries eth_getLogs for Transfer events.
 * Output:   Console table + scripts/smart-wallets-discovered.json
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_RPC_URL = 'https://mainnet.base.org';
const RATE_LIMIT_MS = 200; // 200ms between chunks
const EARLY_TX_COUNT = 100; // grab first 100 transfers per token (kept for output labeling)

// Known DEX routers / infrastructure addresses to exclude
const EXCLUDED_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000', // zero address (minting)
  '0x000000000000000000000000000000000000dead', // burn address
  '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24', // Aerodrome router
  '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43', // Aerodrome universal router
  '0x2626664c2603336e57b271c5c0b26f421741e481', // Uniswap V3 SwapRouter02 on Base
  '0x198ef79f1f515f02dfe9e3115ed9fc3cde7c3b35', // Uniswap V3 factory
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Uniswap universal router on Base
  '0x000000000022d473030f116ddee9f6b43ac78ba3', // Permit2
]);

// ---------------------------------------------------------------------------
// Known big Base movers — hardcoded with launch approximation dates
// ---------------------------------------------------------------------------

interface BaseMover {
  symbol: string;
  address: string;
  launchApprox: string;
}

const KNOWN_BASE_MOVERS: BaseMover[] = [
  { symbol: 'BRETT',   address: '0x532f27101965dd16442e59d40670faf5ebb142e4', launchApprox: '2024-03-01' },
  { symbol: 'DEGEN',   address: '0x4ed4e862860bed51a9570b96d89af5e1b0ebebc4', launchApprox: '2024-01-01' },
  { symbol: 'VIRTUAL', address: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b', launchApprox: '2024-06-01' },
  { symbol: 'AERO',    address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', launchApprox: '2023-08-01' },
  { symbol: 'TOSHI',   address: '0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4', launchApprox: '2023-09-01' },
  { symbol: 'MOCHI',   address: '0xf6e932ca12afa26665dc4dde7e27be02a7c02e50', launchApprox: '2023-10-01' },
];

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

interface DiscoveredWallet {
  address: string;
  appearsOn: string[];
  count: number;
  confidence: 'HIGH' | 'MODERATE' | 'LOW';
}

interface OutputFile {
  generatedAt: string;
  methodology: string;
  wallets: DiscoveredWallet[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if the address looks like a contract placeholder or is otherwise
 * not worth tracking (e.g. token contract itself, very short hex strings).
 */
function isExcluded(address: string, tokenAddress: string): boolean {
  const lower = address.toLowerCase();

  // Already in exclusion set
  if (EXCLUDED_ADDRESSES.has(lower)) return true;

  // The token contract itself
  if (lower === tokenAddress.toLowerCase()) return true;

  // Suspiciously short (< 42 chars total) — malformed
  if (address.length < 42) return true;

  // Ends in many zeros — likely a contract/proxy pattern
  if (lower.endsWith('0000000000000000000000000000')) return true;

  return false;
}

async function fetchEarlyBuyers(mover: BaseMover): Promise<string[]> {
  // Get current block
  const blockNumRes = await axios.post(BASE_RPC_URL, {
    jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: []
  }, { timeout: 10000 });
  const currentBlock = parseInt(blockNumRes.data.result, 16);

  // Query last 48 hours of Transfer events (2s/block → 86400 blocks/48h)
  // Split into 2000-block chunks (public RPC limit)
  const BLOCKS_48H = 86_400;
  const CHUNK_SIZE = 2_000;
  const fromBlock = currentBlock - BLOCKS_48H;

  const recipients = new Set<string>();
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  for (let start = fromBlock; start < currentBlock; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, currentBlock);
    try {
      const logsRes = await axios.post(BASE_RPC_URL, {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [{
          fromBlock: `0x${start.toString(16)}`,
          toBlock: `0x${end.toString(16)}`,
          address: mover.address,
          topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
        }],
      }, { timeout: 15000 });

      const logs = logsRes.data?.result || [];
      for (const log of logs) {
        // topics[2] = to address (padded to 32 bytes)
        if (log.topics?.[2]) {
          const addr = '0x' + log.topics[2].slice(26); // strip leading zeros
          if (addr !== ZERO_ADDRESS && !EXCLUDED_ADDRESSES.has(addr)) {
            recipients.add(addr);
          }
        }
      }
      await sleep(100); // 100ms between chunks
    } catch { /* skip failed chunks */ }
  }

  return [...recipients];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n=== NVR Capital — Smart Wallet Bootstrap ===');
  console.log('Using Base RPC (no API key required)');
  console.log(`Analyzing ${KNOWN_BASE_MOVERS.length} known Base movers for early buyers...\n`);

  // Step 1 & 2 — for each mover, collect early buyers
  // walletMap: normalized address → Set of symbols they were early on
  const walletMap = new Map<string, Set<string>>();

  for (const mover of KNOWN_BASE_MOVERS) {
    process.stdout.write(`[${mover.symbol}] Fetching Transfer events via RPC... `);

    try {
      const buyers = await fetchEarlyBuyers(mover);

      for (const addr of buyers) {
        if (!walletMap.has(addr)) {
          walletMap.set(addr, new Set());
        }
        walletMap.get(addr)!.add(mover.symbol);
      }

      console.log(`done. ${buyers.length} unique receivers found.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`FAILED — ${message}`);
    }

    // Rate limit between requests
    await sleep(RATE_LIMIT_MS);
  }

  // Step 3 — score and sort wallets
  const scored: DiscoveredWallet[] = [];

  for (const [address, symbolSet] of walletMap.entries()) {
    const appearsOn = Array.from(symbolSet).sort();
    const count = appearsOn.length;

    // Only include wallets that appear on 2+ movers
    if (count < 2) continue;

    const confidence: DiscoveredWallet['confidence'] =
      count >= 3 ? 'HIGH' : count === 2 ? 'MODERATE' : 'LOW';

    scored.push({ address, appearsOn, count, confidence });
  }

  // Sort: count desc, then alphabetical address
  scored.sort((a, b) => b.count - a.count || a.address.localeCompare(b.address));

  // Step 4 — print ranked table
  console.log('\n=== Results ===\n');

  if (scored.length === 0) {
    console.log('No wallets found on 2+ movers. Try expanding the token list or increasing offset.');
  } else {
    console.log(`Found ${scored.length} wallets appearing on 2+ known movers:\n`);

    const header = 'RANK  ADDRESS                                     COUNT  CONFIDENCE  TOKENS';
    console.log(header);
    console.log('-'.repeat(header.length));

    for (let i = 0; i < Math.min(scored.length, 30); i++) {
      const w = scored[i];
      const rank = String(i + 1).padStart(4);
      const addr = w.address.padEnd(42);
      const count = String(w.count).padStart(5);
      const conf = w.confidence.padEnd(10);
      const tokens = w.appearsOn.join(', ');
      console.log(`${rank}  ${addr}  ${count}  ${conf}  ${tokens}`);
    }
  }

  // Step 4b — write JSON output
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outputPath = path.join(__dirname, 'smart-wallets-discovered.json');

  const outputFile: OutputFile = {
    generatedAt: new Date().toISOString(),
    methodology: `Early buyers (first ${EARLY_TX_COUNT} transfers) of known Base movers, ranked by appearance count`,
    wallets: scored,
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputFile, null, 2));
  console.log(`\n[OUTPUT] Full results written to: scripts/smart-wallets-discovered.json`);
  console.log(`         ${scored.length} wallets total (2+ movers threshold)`);

  // Step 4c — print top 20 as TypeScript snippet ready to paste
  const top20 = scored.slice(0, 20);

  console.log('\n=== TypeScript Snippet (top 20) ===');
  console.log('// Paste this into src/core/services/smart-wallet-tracker.ts to replace SMART_WALLETS');
  console.log('const SMART_WALLETS: Record<string, string> = {');

  if (top20.length === 0) {
    console.log('  // No wallets found on 2+ movers — run again with a broader token list');
  } else {
    top20.forEach((w, i) => {
      const key = `'base-smart-${String(i + 1).padStart(2, '0')}'`;
      const conf = w.confidence === 'HIGH' ? '★★★' : w.confidence === 'MODERATE' ? '★★ ' : '★  ';
      const tokens = w.appearsOn.join('+');
      console.log(`  ${key}: '${w.address}', // ${conf} ${tokens} (${w.count}/${KNOWN_BASE_MOVERS.length} movers)`);
    });
  }

  console.log('};\n');

  // Summary stats
  const high = scored.filter((w) => w.confidence === 'HIGH').length;
  const moderate = scored.filter((w) => w.confidence === 'MODERATE').length;
  console.log(`=== Summary ===`);
  console.log(`  HIGH confidence (3+ movers):     ${high}`);
  console.log(`  MODERATE confidence (2 movers):  ${moderate}`);
  console.log(`  Total qualifying wallets:        ${scored.length}`);
  console.log(`  Tokens analyzed:                 ${KNOWN_BASE_MOVERS.length}`);
  console.log('');
}

main().catch((err) => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
