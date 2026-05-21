import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkEscalation,
  resetOllamaCache,
  resolveModelRouting,
  getAgreementRate,
  callAnthropic,
} from '../model-client.js';
import type { GemmaMode } from '../model-client.js';
import type Anthropic from '@anthropic-ai/sdk';

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
    // Force the Ollama health check to fail regardless of whether Ollama is
    // actually running on the developer's machine. Without this stub the test
    // resolved to GEMMA on dev boxes with a live Ollama instance.
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    try {
      resetOllamaCache();
      const result = await resolveModelRouting({ needsSonnet: false }, 'production');
      expect(result.tier).toBe('HAIKU');
      expect(result.backend).toBe('anthropic');
      // Reason string was renamed to "No cheap backend available → Haiku fallback"
      // when the Cerebras/Groq paths were added (see model-client.ts:619).
      expect(result.reason).toContain('Haiku fallback');
    } finally {
      global.fetch = originalFetch;
    }
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

// ============================================================================
// ANTHROPIC PROMPT-CACHING REGRESSION TESTS
//
// These guard the heavy-cycle cost optimization (v21.29 SDK 0.97 upgrade).
// If `cache_control` blocks ever stop reaching the API, the cached input
// tokens stop reading and Sonnet input cost goes from ~$0.30/MTok back to
// $3.00/MTok per cycle. Fleet-wide that's the difference between ~$30/mo
// and ~$130/mo today (and scales linearly with bot count). These tests
// pin the request payload shape and the response telemetry surface.
// ============================================================================

describe('callAnthropic (prompt caching wiring)', () => {
  function makeMockClient(
    capture: { body?: unknown; headers?: Record<string, string> },
  ): Anthropic {
    return {
      messages: {
        create: vi.fn(async (body: unknown, options?: { headers?: Record<string, string> }) => {
          capture.body = body;
          capture.headers = options?.headers;
          return {
            content: [{ type: 'text', text: '[]' }],
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_creation_input_tokens: 4500,
              cache_read_input_tokens: 0,
            },
          };
        }),
      },
    } as unknown as Anthropic;
  }

  it('forwards content-block messages with cache_control on stable prefix', async () => {
    const capture: { body?: unknown; headers?: Record<string, string> } = {};
    const client = makeMockClient(capture);

    const cacheablePrefix = 'a'.repeat(8000); // simulate ~2k tokens of stable prefix
    const dynamicSuffix = 'live market data: BTC $103,500';

    await callAnthropic(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: cacheablePrefix, cache_control: { type: 'ephemeral', ttl: '1h' } },
              { type: 'text', text: dynamicSuffix },
            ],
          },
        ],
        maxTokens: 500,
      },
      client,
      'claude-sonnet-4-5',
    );

    const body = capture.body as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    };

    // Payload shape — content MUST be a content-block array, not a flat string.
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(Array.isArray(body.messages[0].content)).toBe(true);

    const blocks = body.messages[0].content as Array<{
      type: string;
      text: string;
      cache_control?: { type: string; ttl?: string };
    }>;

    // Two blocks: cacheable prefix + dynamic suffix.
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe(cacheablePrefix);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    // Critical invariant: the dynamic block has NO cache_control. If it ever
    // gains one, every call writes a fresh per-cycle cache entry that expires
    // before the next call reads it — billed 1.25× base, zero hits.
    expect(blocks[1].text).toBe(dynamicSuffix);
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it('sends extended-cache-ttl beta header so 1h TTL is honored', async () => {
    const capture: { body?: unknown; headers?: Record<string, string> } = {};
    const client = makeMockClient(capture);

    await callAnthropic(
      {
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      },
      client,
      'claude-haiku-4-5',
    );

    // The 1h TTL on cache_control requires this beta header; without it the
    // server silently falls back to 5m and our 15-min cycle cadence guarantees
    // cache expiry before the next read.
    expect(capture.headers?.['anthropic-beta']).toBe('extended-cache-ttl-2025-04-11');
  });

  it('surfaces cache_read_input_tokens and cache_creation_input_tokens in telemetry', async () => {
    // Mock returns 4500 create tokens + 0 read tokens (cache-miss / first call).
    const capture: { body?: unknown; headers?: Record<string, string> } = {};
    const client = makeMockClient(capture);

    const response = await callAnthropic(
      {
        messages: [{ role: 'user', content: 'first call' }],
        maxTokens: 100,
      },
      client,
      'claude-sonnet-4-5',
    );

    expect(response.usage.cacheCreationInputTokens).toBe(4500);
    expect(response.usage.cacheReadInputTokens).toBe(0);
    expect(response.usage.inputTokens).toBe(100);
    expect(response.usage.outputTokens).toBe(20);
  });

  it('lifts system-role messages into the top-level `system` parameter', async () => {
    const capture: { body?: unknown; headers?: Record<string, string> } = {};
    const client = makeMockClient(capture);

    await callAnthropic(
      {
        messages: [
          { role: 'system', content: 'you are a careful trader' },
          { role: 'user', content: 'what do you think?' },
        ],
        maxTokens: 100,
      },
      client,
      'claude-sonnet-4-5',
    );

    const body = capture.body as {
      system?: string | Array<{ type: string; text: string }>;
      messages: Array<{ role: string }>;
    };

    // System content MUST reach the top-level `system` param — the SDK rejects
    // (or silently drops) 'system' inside the messages array.
    expect(body.system).toBe('you are a careful trader');
    // Only the user message remains in `messages`.
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });

  it('preserves cache_control on system blocks when system content is structured', async () => {
    const capture: { body?: unknown; headers?: Record<string, string> } = {};
    const client = makeMockClient(capture);

    const systemPrefix = 'b'.repeat(8000);
    await callAnthropic(
      {
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: systemPrefix, cache_control: { type: 'ephemeral', ttl: '1h' } },
            ],
          },
          { role: 'user', content: 'go' },
        ],
        maxTokens: 100,
      },
      client,
      'claude-sonnet-4-5',
    );

    const body = capture.body as {
      system?: Array<{ type: string; text: string; cache_control?: { type: string; ttl?: string } }>;
    };

    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system?.[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});
