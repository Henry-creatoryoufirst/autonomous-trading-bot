/**
 * NVR-SPEC-011 Phase 1 tests.
 *
 * Covers the pure parts: classification, venue inference, ring buffer.
 * The RPC-dependent tick loop is exercised by a later integration test
 * against Base mainnet — not in this unit suite.
 */

import { describe, it, expect } from 'vitest';
import {
  TRANSFER_TOPIC,
  KNOWN_VENUES,
  topicToAddress,
  parseAmountHex,
  normalizeAddress,
  inferVenueFromTxLogs,
  classifyTransfer,
  type RawTransferLog,
} from '../src/core/services/rotation-classify.js';
import { EventBuffer } from '../src/core/services/rotation-indexer.js';

const WALLET = '0x0000000000000000000000000000000000000abc';
const WALLET_TOPIC = '0x000000000000000000000000' + WALLET.slice(2);
const COUNTERPARTY = '0x0000000000000000000000000000000000000def';
const COUNTERPARTY_TOPIC = '0x000000000000000000000000' + COUNTERPARTY.slice(2);
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const AERODROME_ROUTER = '0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5';

function mkLog(overrides: Partial<RawTransferLog>): RawTransferLog {
  return {
    address: USDC,
    topics: [TRANSFER_TOPIC, COUNTERPARTY_TOPIC, WALLET_TOPIC],
    data: '0x' + (1_000_000n).toString(16).padStart(64, '0'), // 1.0 USDC (6 decimals)
    transactionHash: '0xdeadbeef',
    blockNumber: 12345,
    blockTimestamp: 1_700_000_000,
    ...overrides,
  };
}

describe('normalizeAddress', () => {
  it('lowercases valid 20-byte hex', () => {
    expect(normalizeAddress('0xAbCDef0000000000000000000000000000001234'))
      .toBe('0xabcdef0000000000000000000000000000001234');
  });
  it('throws on malformed input', () => {
    expect(() => normalizeAddress('0x123')).toThrow();
    expect(() => normalizeAddress('nope')).toThrow();
  });
});

describe('topicToAddress', () => {
  it('extracts the trailing 20 bytes, lowercased', () => {
    const t = '0x000000000000000000000000AbCDef0000000000000000000000000000001234';
    expect(topicToAddress(t)).toBe('0xabcdef0000000000000000000000000000001234');
  });
  it('throws on wrong length', () => {
    expect(() => topicToAddress('0xabc')).toThrow();
  });
});

describe('parseAmountHex', () => {
  it('scales by decimals correctly (USDC 6 decimals)', () => {
    const hex = '0x' + (1_500_000n).toString(16).padStart(64, '0');
    expect(parseAmountHex(hex, 6)).toBeCloseTo(1.5, 10);
  });
  it('handles 18 decimals for WETH-style values', () => {
    const hex = '0x' + (2_000_000_000_000_000_000n).toString(16).padStart(64, '0');
    expect(parseAmountHex(hex, 18)).toBeCloseTo(2.0, 10);
  });
  it('rejects negative decimals', () => {
    expect(() => parseAmountHex('0x01', -1)).toThrow();
  });
  it('rejects missing 0x', () => {
    expect(() => parseAmountHex('abcd', 6)).toThrow();
  });
});

describe('inferVenueFromTxLogs', () => {
  it('returns unknown when no venue contracts appear', () => {
    const logs = [{ address: USDC, topics: [TRANSFER_TOPIC, WALLET_TOPIC, COUNTERPARTY_TOPIC] }];
    expect(inferVenueFromTxLogs(logs)).toBe('unknown');
  });
  it('detects Aerodrome router as log.address', () => {
    const logs = [{ address: AERODROME_ROUTER, topics: [] }];
    expect(inferVenueFromTxLogs(logs)).toBe('aerodrome');
  });
  it('detects 1inch router embedded in transfer topics', () => {
    const oneinch = '0x111111125421ca6dc452d289314280a0f8842a65';
    const oneinchTopic = '0x000000000000000000000000' + oneinch.slice(2);
    const logs = [{
      address: USDC,
      topics: [TRANSFER_TOPIC, oneinchTopic, COUNTERPARTY_TOPIC],
    }];
    expect(inferVenueFromTxLogs(logs)).toBe('1inch');
  });
});

describe('classifyTransfer', () => {
  it('classifies IN when tracked wallet is the recipient', () => {
    const ev = classifyTransfer(mkLog({}), WALLET, 6, 'USDC');
    expect(ev).not.toBeNull();
    expect(ev!.direction).toBe('IN');
    expect(ev!.amountToken).toBeCloseTo(1.0, 10);
    expect(ev!.tokenSymbol).toBe('USDC');
    expect(ev!.amountUSD).toBeNull();
  });

  it('classifies OUT when tracked wallet is the sender', () => {
    const ev = classifyTransfer(
      mkLog({ topics: [TRANSFER_TOPIC, WALLET_TOPIC, COUNTERPARTY_TOPIC] }),
      WALLET, 6, 'USDC',
    );
    expect(ev).not.toBeNull();
    expect(ev!.direction).toBe('OUT');
  });

  it('returns null if wallet is not involved', () => {
    const other1 = '0x000000000000000000000000' + '1111111111111111111111111111111111111111';
    const other2 = '0x000000000000000000000000' + '2222222222222222222222222222222222222222';
    const ev = classifyTransfer(
      mkLog({ topics: [TRANSFER_TOPIC, other1, other2] }),
      WALLET, 6, 'USDC',
    );
    expect(ev).toBeNull();
  });

  it('returns null on zero-value transfers', () => {
    const ev = classifyTransfer(
      mkLog({ data: '0x' + '0'.repeat(64) }),
      WALLET, 6, 'USDC',
    );
    expect(ev).toBeNull();
  });

  it('returns null on non-Transfer topic0', () => {
    const ev = classifyTransfer(
      mkLog({ topics: ['0xaaaa', COUNTERPARTY_TOPIC, WALLET_TOPIC] }),
      WALLET, 6, 'USDC',
    );
    expect(ev).toBeNull();
  });

  it('populates timestampMs from seconds * 1000', () => {
    const ev = classifyTransfer(mkLog({ blockTimestamp: 1_700_000_000 }), WALLET, 6, null);
    expect(ev!.timestampMs).toBe(1_700_000_000_000);
  });

  it('uses explicit venue override when provided', () => {
    const ev = classifyTransfer(mkLog({}), WALLET, 6, 'USDC', 'aerodrome');
    expect(ev!.venue).toBe('aerodrome');
  });

  it('falls back to inferVenueFromTxLogs when no override + txLogs provided', () => {
    const ev = classifyTransfer(
      mkLog({
        txLogs: [{ address: AERODROME_ROUTER, topics: [] }],
      }),
      WALLET, 6, 'USDC',
    );
    expect(ev!.venue).toBe('aerodrome');
  });

  it('stamps venue as unknown when no hints given', () => {
    const ev = classifyTransfer(mkLog({}), WALLET, 6, 'USDC');
    expect(ev!.venue).toBe('unknown');
  });
});

describe('KNOWN_VENUES sanity', () => {
  it('covers the core routers we care about', () => {
    expect(Object.values(KNOWN_VENUES)).toContain('aerodrome');
    expect(Object.values(KNOWN_VENUES)).toContain('uniswap-v3');
    expect(Object.values(KNOWN_VENUES)).toContain('1inch');
    expect(Object.values(KNOWN_VENUES)).toContain('lifi');
  });
  it('all keys are lowercase hex addresses', () => {
    for (const key of Object.keys(KNOWN_VENUES)) {
      expect(key).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });
});

describe('EventBuffer', () => {
  const mkEvent = (walletAddress = WALLET) => ({
    walletAddress,
    tokenAddress: USDC,
    tokenSymbol: 'USDC',
    direction: 'IN' as const,
    amountToken: 1,
    amountUSD: null,
    txHash: '0x' + Math.random().toString(16).slice(2),
    blockNumber: 1,
    timestampMs: Date.now(),
    venue: 'unknown' as const,
  });

  it('preserves insertion order in drain', () => {
    const b = new EventBuffer(10);
    const a = mkEvent(); const c = mkEvent();
    b.push(a); b.push(c);
    const out = b.drain();
    expect(out.length).toBe(2);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(c);
  });

  it('drops oldest events on overflow and tracks drop count', () => {
    const b = new EventBuffer(2);
    const a = mkEvent(); const c = mkEvent(); const d = mkEvent();
    b.push(a); b.push(c); b.push(d);
    expect(b.size()).toBe(2);
    expect(b.droppedTotal()).toBe(1);
    const out = b.drain();
    expect(out[0]).toBe(c); // 'a' was dropped
    expect(out[1]).toBe(d);
  });

  it('rejects non-positive capacity', () => {
    expect(() => new EventBuffer(0)).toThrow();
    expect(() => new EventBuffer(-1)).toThrow();
  });

  it('peek does not remove', () => {
    const b = new EventBuffer(5);
    b.push(mkEvent());
    expect(b.peek().length).toBe(1);
    expect(b.size()).toBe(1);
  });

  it('drain returns empty on empty buffer', () => {
    const b = new EventBuffer(5);
    expect(b.drain()).toEqual([]);
  });
});
