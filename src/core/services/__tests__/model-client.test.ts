import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkEscalation,
  resetOllamaCache,
  resolveModelRouting,
  getAgreementRate,
} from '../model-client.js';
import type { GemmaMode } from '../model-client.js';

// ============================================================================
// ESCALATION TESTS (pure function, no I/O)
// ============================================================================

describe('checkEscalation', () => {
  const portfolioValue = 4000;

  it('does not escalate for HOLD responses', () => {
    const text = JSON.stringify([{ action: 'HOLD', fromToken: 'NONE', toToken: 'NONE', amountUSD: 0, reasoning: 'no action' }]);
    const result = checkEscalation(text, portfolioValue, 'production');
    expect(result.shouldEscalate).toBe(false);
  });

  it('escalates on malformed JSON', () => {
    const result = checkEscalation('this is not json', portfolioValue, 'production');
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain('Malformed JSON');
  });

  it('escalates when trade exceeds USD threshold ($200)', () => {
    const text = JSON.stringify([{ action: 'BUY', fromToken: 'USDC', toToken: 'ETH', amountUSD: 250, reasoning: 'buy ETH' }]);
    const result = checkEscalation(text, portfolioValue, 'production');
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain('$250');
  });

  it('escalates when trade exceeds portfolio % threshold (5%)', () => {
    const text = JSON.stringify([{ action: 'BUY', fromToken: 'USDC', toToken: 'ETH', amountUSD: 250, reasoning: 'buy ETH' }]);
    const result = checkEscalation(text, portfolioValue, 'production');
    expect(result.shouldEscalate).toBe(true);
  });

  it('does not escalate for small trades in production mode', () => {
    const text = JSON.stringify([{ action: 'BUY', fromToken: 'USDC', toToken: 'ETH', amountUSD: 50, reasoning: 'small buy' }]);
    const result = checkEscalation(text, portfolioValue, 'production');
    expect(result.shouldEscalate).toBe(false);
  });

  it('escalates ALL trades in supervised mode', () => {
    const text = JSON.stringify([{ action: 'BUY', fromToken: 'USDC', toToken: 'ETH', amountUSD: 10, reasoning: 'tiny buy' }]);
    const result = checkEscalation(text, portfolioValue, 'supervised');
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain('Supervised mode');
  });

  it('escalates SELLs in graduated mode', () => {
    const text = JSON.stringify([{ action: 'SELL', fromToken: 'ETH', toToken: 'USDC', amountUSD: 30, reasoning: 'sell ETH' }]);
    const result = checkEscalation(text, portfolioValue, 'graduated');
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain('SELL');
  });

  it('does not escalate small BUYs in graduated mode', () => {
    const text = JSON.stringify([{ action: 'BUY', fromToken: 'USDC', toToken: 'ETH', amountUSD: 30, reasoning: 'small buy' }]);
    const result = checkEscalation(text, portfolioValue, 'graduated');
    expect(result.shouldEscalate).toBe(false);
  });

  it('escalates on uncertainty keywords', () => {
    const text = JSON.stringify([{ action: 'BUY', fromToken: 'USDC', toToken: 'ETH', amountUSD: 30, reasoning: 'uncertain about this trade' }]);
    const result = checkEscalation(text, portfolioValue, 'production');
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain('uncertain');
  });

  it('escalates on too many concurrent trades', () => {
    const text = JSON.stringify([
      { action: 'BUY', fromToken: 'USDC', toToken: 'ETH', amountUSD: 30, reasoning: 'buy' },
      { action: 'BUY', fromToken: 'USDC', toToken: 'AAVE', amountUSD: 30, reasoning: 'buy' },
      { action: 'SELL', fromToken: 'BRETT', toToken: 'USDC', amountUSD: 20, reasoning: 'sell' },
    ]);
    const result = checkEscalation(text, portfolioValue, 'production');
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain('concurrent');
  });

  it('handles markdown-wrapped JSON', () => {
    const text = '```json\n[{"action":"HOLD","fromToken":"NONE","toToken":"NONE","amountUSD":0,"reasoning":"hold"}]\n```';
    const result = checkEscalation(text, portfolioValue, 'production');
    expect(result.shouldEscalate).toBe(false);
  });
});

// ============================================================================
// ROUTING TESTS
// ============================================================================

describe('resolveModelRouting', () => {
  beforeEach(() => {
    resetOllamaCache();
  });

  it('returns Sonnet/Haiku when gemmaMode is disabled', async () => {
    const heavy = await resolveModelRouting({ needsSonnet: true }, 'disabled');
    expect(heavy.tier).toBe('SONNET');
    expect(heavy.backend).toBe('anthropic');

    const routine = await resolveModelRouting({ needsSonnet: false }, 'disabled');
    expect(routine.tier).toBe('HAIKU');
    expect(routine.backend).toBe('anthropic');
  });

  it('always returns SONNET for difficult markets regardless of mode', async () => {
    const result = await resolveModelRouting({ needsSonnet: true }, 'production');
    expect(result.tier).toBe('SONNET');
    expect(result.backend).toBe('anthropic');
  });

  it('falls back to HAIKU when Ollama is unreachable', async () => {
    // Ollama is not running in test env, so it should fall back
    const result = await resolveModelRouting({ needsSonnet: false }, 'production');
    expect(result.tier).toBe('HAIKU');
    expect(result.backend).toBe('anthropic');
    expect(result.reason).toContain('unreachable');
  });
});

// ============================================================================
// TELEMETRY TESTS
// ============================================================================

describe('getAgreementRate', () => {
  it('returns zero rate when no shadow comparisons exist', () => {
    const rate = getAgreementRate();
    expect(rate.total).toBe(0);
    expect(rate.rate).toBe(0);
  });
});
