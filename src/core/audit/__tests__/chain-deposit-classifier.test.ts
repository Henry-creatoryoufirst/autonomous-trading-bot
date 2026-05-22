/**
 * Unit tests for the chain-deposit classifier (May-22 rebuild).
 *
 * The pre-rebuild logic excluded ONE swap router (Aerodrome UR) and
 * misclassified every USDC inflow from 1inch / Uniswap V3 / KyberSwap /
 * internal pools / etc. as a user deposit. On master, this surfaced as
 * INV-11 firing SEVERE with $66,463 "UNDER-COUNTED" — a real signal
 * poisoned by a false-positive classification bug.
 *
 * The hybrid classifier:
 *   1) primary  — txHash match against bot's tradeHistory  → excluded-bot-trade
 *   2) fallback — `from` match against known DEX router list → excluded-known-router
 *   3) default  — count as deposit (safe-by-default per spec)
 *
 * These tests are independent of the RPC layer; they exercise the pure
 * `classifyInflow` function. The integration with `fetchChainDepositHistory`
 * is covered by the INV-11 reconciliation test consuming the same shapes.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyInflow,
  getKnownDexRouters,
  type DepositClassification,
} from '../sources/chain-deposit-history.js';

// Known router addresses on Base — see chain-deposit-history.ts for sourcing.
const AERODROME_UR = '0x7747f8d2a76bd6345cc29622a946a929647f2359';
const ONEINCH_V5 = '0x1111111254eeb25477b68fb85ed929f73a960582';
const ONEINCH_V6 = '0x111111125421ca6dc452d289314280a0f8842a65';
const UNISWAP_V3_SWAPROUTER_BASE = '0x2626664c2603336e57b271c5c0b26f421741e481';
const UNISWAP_UNIVERSAL_ROUTER_BASE = '0x6ff5693b99212da76ad316178a184ab56d299b43';
const KYBERSWAP = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';

// Synthetic non-router addresses used in tests.
const ZACK_EOA = '0x20fe51a9229ea7b1cd3f3f1de27e4f3e7e7e7e7e';
const UNKNOWN_POOL = '0xa1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const RANDOM_USER = '0xbeefcafebeefcafebeefcafebeefcafebeefcafe';

function botTradeTx(seed: number): string {
  return '0x' + seed.toString(16).padStart(64, 'a');
}

function inflowTx(seed: number): string {
  return '0x' + seed.toString(16).padStart(64, 'b');
}

describe('classifyInflow — Option C hybrid', () => {
  describe('safe-by-default — counted as deposit', () => {
    it('counts a clean EOA deposit with no tx match and no router match', () => {
      const result = classifyInflow({
        fromAddress: ZACK_EOA,
        txHash: inflowTx(1),
        usdValue: 1000,
        botTxHashes: new Set(),
      });
      expect(result).toBe<DepositClassification>('counted-as-deposit');
    });

    it('counts inflow from an unknown contract with no txHash match', () => {
      // The bug-fix bottleneck: a swap proceed from a NOT-on-our-list
      // contract should still be counted, because we can't safely rule it
      // out. Better a noisy deposit than a hidden drift.
      const result = classifyInflow({
        fromAddress: UNKNOWN_POOL,
        txHash: inflowTx(2),
        usdValue: 500,
        botTxHashes: new Set([botTradeTx(99)]), // unrelated bot trades
      });
      expect(result).toBe<DepositClassification>('counted-as-deposit');
    });
  });

  describe('primary path — bot tradeHistory cross-reference (Option B)', () => {
    it('excludes inflow whose tx hash matches a bot trade (even from an unknown contract)', () => {
      const tx = inflowTx(3);
      const result = classifyInflow({
        fromAddress: UNKNOWN_POOL, // not a known router
        txHash: tx,
        usdValue: 250,
        botTxHashes: new Set([tx, botTradeTx(1), botTradeTx(2)]),
      });
      expect(result).toBe<DepositClassification>('excluded-bot-trade');
    });

    it('cross-reference is case-insensitive (chain returns lowercase, bot may not)', () => {
      // The bot's stored tx hashes come from Coinbase SDK + viem and are
      // typically already lowercase, but we lowercase defensively. If a
      // single hash slipped in mixed-case, the cross-reference would
      // silently fail open — re-opening the $66K false-positive.
      const lowercaseTx = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const upperFromBot = '0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';
      const result = classifyInflow({
        fromAddress: UNKNOWN_POOL,
        txHash: lowercaseTx,
        usdValue: 999,
        botTxHashes: new Set([upperFromBot]),
      });
      expect(result).toBe<DepositClassification>('excluded-bot-trade');
    });

    it('cross-reference works on inflows from known routers too (belt + suspenders)', () => {
      // If both signals agree, the bot-trade tag wins because it's more
      // specific (we KNOW we did this), but the result is the same:
      // not a deposit. This test pins the order so a future refactor
      // can't accidentally swap the precedence and miss something.
      const tx = inflowTx(4);
      const result = classifyInflow({
        fromAddress: AERODROME_UR,
        txHash: tx,
        usdValue: 1234.56,
        botTxHashes: new Set([tx]),
      });
      expect(result).toBe<DepositClassification>('excluded-bot-trade');
    });
  });

  describe('fallback path — known DEX router list (Option A)', () => {
    it('excludes inflow from Aerodrome Universal Router (existing behavior)', () => {
      const result = classifyInflow({
        fromAddress: AERODROME_UR,
        txHash: inflowTx(5),
        usdValue: 200,
        botTxHashes: new Set(),
      });
      expect(result).toBe<DepositClassification>('excluded-known-router');
    });

    it('excludes inflow from 1inch Aggregation Router V5 (the bug fix)', () => {
      const result = classifyInflow({
        fromAddress: ONEINCH_V5,
        txHash: inflowTx(6),
        usdValue: 150,
        botTxHashes: new Set(),
      });
      expect(result).toBe<DepositClassification>('excluded-known-router');
    });

    it('excludes inflow from 1inch Aggregation Router V6', () => {
      const result = classifyInflow({
        fromAddress: ONEINCH_V6,
        txHash: inflowTx(7),
        usdValue: 100,
        botTxHashes: new Set(),
      });
      expect(result).toBe<DepositClassification>('excluded-known-router');
    });

    it('excludes inflow from Uniswap V3 SwapRouter02', () => {
      const result = classifyInflow({
        fromAddress: UNISWAP_V3_SWAPROUTER_BASE,
        txHash: inflowTx(8),
        usdValue: 333,
        botTxHashes: new Set(),
      });
      expect(result).toBe<DepositClassification>('excluded-known-router');
    });

    it('excludes inflow from Uniswap Universal Router (V2/V3/V4 unified)', () => {
      const result = classifyInflow({
        fromAddress: UNISWAP_UNIVERSAL_ROUTER_BASE,
        txHash: inflowTx(9),
        usdValue: 444,
        botTxHashes: new Set(),
      });
      expect(result).toBe<DepositClassification>('excluded-known-router');
    });

    it('excludes inflow from KyberSwap Aggregation Router', () => {
      const result = classifyInflow({
        fromAddress: KYBERSWAP,
        txHash: inflowTx(10),
        usdValue: 555,
        botTxHashes: new Set(),
      });
      expect(result).toBe<DepositClassification>('excluded-known-router');
    });

    it('address match is case-insensitive (chain returns mixed-case sometimes)', () => {
      // eth_getLogs returns topics as lowercase but `fromAddress` is
      // assembled from the topic slice — we lowercase explicitly in the
      // scanner. Belt-and-suspenders: test the classifier handles
      // mixed-case input too.
      const result = classifyInflow({
        fromAddress: AERODROME_UR.toUpperCase(),
        txHash: inflowTx(11),
        usdValue: 50,
        botTxHashes: new Set(),
      });
      expect(result).toBe<DepositClassification>('excluded-known-router');
    });
  });

  describe('dust exclusion', () => {
    it('excludes sub-$1 inflows even from EOAs (noise floor)', () => {
      const result = classifyInflow({
        fromAddress: RANDOM_USER,
        txHash: inflowTx(12),
        usdValue: 0.42,
        botTxHashes: new Set(),
      });
      expect(result).toBe<DepositClassification>('excluded-dust');
    });

    it('dust check fires BEFORE the router/tx checks (cheap path first)', () => {
      // If a known router happens to leak a dust-sized refund, we still
      // classify it as dust — it doesn't matter much, but the order is
      // pinned so future refactors don't change the diagnostic counters.
      const result = classifyInflow({
        fromAddress: AERODROME_UR,
        txHash: botTradeTx(1),
        usdValue: 0.01,
        botTxHashes: new Set([botTradeTx(1)]),
      });
      expect(result).toBe<DepositClassification>('excluded-dust');
    });
  });

  describe('router list sanity', () => {
    it('exports a non-trivial list of known routers (> 1)', () => {
      // The pre-rebuild bug was a list of length 1. If we ever regress
      // to a single-router exclusion, this test fails immediately.
      const routers = getKnownDexRouters();
      expect(routers.length).toBeGreaterThan(1);
    });

    it('every router address is lowercased hex of length 42', () => {
      for (const r of getKnownDexRouters()) {
        expect(r).toMatch(/^0x[0-9a-f]{40}$/);
      }
    });

    it('list has no duplicates (would skew the diagnostic counters)', () => {
      const routers = getKnownDexRouters();
      const unique = new Set(routers);
      expect(unique.size).toBe(routers.length);
    });

    it('Aerodrome UR is still in the list (the pre-rebuild canonical exclusion)', () => {
      expect(getKnownDexRouters()).toContain(AERODROME_UR);
    });

    it('1inch routers are in the list (the bug-fix coverage)', () => {
      const routers = getKnownDexRouters();
      expect(routers).toContain(ONEINCH_V5);
      expect(routers).toContain(ONEINCH_V6);
    });
  });
});

describe('classifyInflow — master state regression simulation', () => {
  // Reproduce the shape of master's actual state: bot has executed many
  // trades through Aerodrome + occasionally other routers. Each trade
  // produces a USDC inflow whose tx hash matches a tradeHistory entry.
  // Before the rebuild, only Aerodrome-routed proceeds were excluded;
  // every other router contributed to the $66K false-positive sum.
  //
  // This test simulates 100 swap-proceed inflows + 1 real Zack deposit,
  // and asserts the classifier correctly bucket them.

  it('master-shape: 100 router proceeds with matching tradeHistory all excluded, 1 EOA deposit counted', () => {
    const botTxHashes = new Set<string>();
    const inflows: Array<{ from: string; txHash: string; usd: number }> = [];

    // 60 Aerodrome trades, each yielding a USDC inflow (sell legs)
    for (let i = 0; i < 60; i++) {
      const tx = botTradeTx(1000 + i);
      botTxHashes.add(tx);
      inflows.push({ from: AERODROME_UR, txHash: tx, usd: 50 + i });
    }
    // 25 1inch trades — these were the LARGEST contributor to the $66K
    // false-positive (Aerodrome was excluded; 1inch wasn't)
    for (let i = 0; i < 25; i++) {
      const tx = botTradeTx(2000 + i);
      botTxHashes.add(tx);
      inflows.push({ from: ONEINCH_V5, txHash: tx, usd: 200 + i * 3 });
    }
    // 10 Uniswap V3 trades
    for (let i = 0; i < 10; i++) {
      const tx = botTradeTx(3000 + i);
      botTxHashes.add(tx);
      inflows.push({ from: UNISWAP_V3_SWAPROUTER_BASE, txHash: tx, usd: 75 });
    }
    // 5 unknown-pool trades that we DID record in tradeHistory (internal
    // hops, V4 pool managers, whatever) — the primary path saves these
    for (let i = 0; i < 5; i++) {
      const tx = botTradeTx(4000 + i);
      botTxHashes.add(tx);
      inflows.push({ from: UNKNOWN_POOL, txHash: tx, usd: 25 });
    }
    // 1 real Zack deposit from his EOA
    inflows.push({ from: ZACK_EOA, txHash: inflowTx(9999), usd: 1000 });

    let counted = 0;
    let excludedBotTrade = 0;
    let excludedRouter = 0;
    let countedUsd = 0;

    for (const inflow of inflows) {
      const c = classifyInflow({
        fromAddress: inflow.from,
        txHash: inflow.txHash,
        usdValue: inflow.usd,
        botTxHashes,
      });
      if (c === 'counted-as-deposit') {
        counted++;
        countedUsd += inflow.usd;
      } else if (c === 'excluded-bot-trade') {
        excludedBotTrade++;
      } else if (c === 'excluded-known-router') {
        excludedRouter++;
      }
    }

    // The only counted inflow is Zack's deposit
    expect(counted).toBe(1);
    expect(countedUsd).toBe(1000);
    // All 100 bot-tagged inflows excluded via the primary path
    expect(excludedBotTrade).toBe(100);
    expect(excludedRouter).toBe(0);
  });

  it('partial tradeHistory restore: router fallback covers what cross-reference cannot', () => {
    // Simulate the case where state was restored from backup but lost
    // some tradeHistory entries. The bot's tx hash set is incomplete.
    // The router-list fallback still rescues us from the $66K false-
    // positive on the 1inch / Uniswap inflows.
    const botTxHashes = new Set<string>([
      botTradeTx(1), // only ONE of the bot's many trades survived restore
    ]);
    const inflows = [
      { from: AERODROME_UR, txHash: botTradeTx(99), usd: 100 },        // unknown tx, known router → excluded
      { from: ONEINCH_V5, txHash: botTradeTx(98), usd: 200 },          // unknown tx, known router → excluded
      { from: UNISWAP_V3_SWAPROUTER_BASE, txHash: botTradeTx(97), usd: 300 }, // unknown tx, known router → excluded
      { from: UNKNOWN_POOL, txHash: botTradeTx(96), usd: 400 },        // unknown tx, unknown from → COUNTED (safe-by-default)
      { from: ZACK_EOA, txHash: inflowTx(8888), usd: 1000 },           // real deposit → counted
    ];

    const buckets: Record<string, number> = {
      counted: 0,
      excludedBotTrade: 0,
      excludedKnownRouter: 0,
      excludedDust: 0,
    };
    let countedUsd = 0;
    for (const inflow of inflows) {
      const c = classifyInflow({
        fromAddress: inflow.from,
        txHash: inflow.txHash,
        usdValue: inflow.usd,
        botTxHashes,
      });
      if (c === 'counted-as-deposit') { buckets.counted++; countedUsd += inflow.usd; }
      else if (c === 'excluded-bot-trade') buckets.excludedBotTrade++;
      else if (c === 'excluded-known-router') buckets.excludedKnownRouter++;
      else if (c === 'excluded-dust') buckets.excludedDust++;
    }

    // The 3 router-routed inflows excluded via fallback; the 1 unknown-
    // pool inflow counted because we can't rule it out (safe-by-default);
    // the 1 EOA deposit counted as deposit.
    expect(buckets.excludedKnownRouter).toBe(3);
    expect(buckets.counted).toBe(2);
    expect(countedUsd).toBe(400 + 1000); // unknown-pool + Zack
    // Pre-rebuild: only the Aerodrome inflow ($100) would've been
    // excluded — the other $1400 would've been treated as "deposits" =
    // the structural bug that produced the $66K master finding.
  });
});
