import { describe, it, expect, vi } from "vitest";
import { createAskAI } from "../ask-ai.js";
import type {
  ModelRequestOptions,
  ModelResponse,
} from "../../services/model-client.js";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeResponse(text: string, backend: ModelResponse["backend"] = "groq"): ModelResponse {
  return {
    text,
    model: "test-model",
    backend,
    usage: { inputTokens: 100, outputTokens: 20 },
    latencyMs: 250,
  };
}

const fakeAnthropicClient = {} as unknown as import("@anthropic-ai/sdk").default;

// ----------------------------------------------------------------------------
// Cheap tier (default) — Groq path
// ----------------------------------------------------------------------------

describe("createAskAI: cheap tier (Groq path)", () => {
  it("calls Groq when it's available and returns the response text", async () => {
    const callGroqImpl = vi.fn(async (_opts: ModelRequestOptions) =>
      makeResponse("75\nReasoning: macro is bullish"),
    );
    const askAI = createAskAI({
      callGroqImpl,
      isGroqAvailableImpl: async () => true,
    });

    const text = await askAI("score this trade", { tier: "cheap" });
    expect(text).toBe("75\nReasoning: macro is bullish");
    expect(callGroqImpl).toHaveBeenCalledOnce();

    const call = (callGroqImpl.mock.calls[0] as unknown as [ModelRequestOptions])[0];
    expect(call.maxTokens).toBe(200);
    expect(call.timeoutMs).toBe(1500);
    expect(call.messages).toEqual([
      { role: "user", content: "score this trade" },
    ]);
  });

  it("defaults to cheap tier when no opts are provided", async () => {
    const callGroqImpl = vi.fn(async () => makeResponse("50"));
    const askAI = createAskAI({
      callGroqImpl,
      isGroqAvailableImpl: async () => true,
    });
    await askAI("prompt");
    expect(callGroqImpl).toHaveBeenCalledOnce();
  });

  it("respects a custom maxTokens", async () => {
    const callGroqImpl = vi.fn(async () => makeResponse("ok"));
    const askAI = createAskAI({
      callGroqImpl,
      isGroqAvailableImpl: async () => true,
    });
    await askAI("prompt", { maxTokens: 50 });
    expect((callGroqImpl.mock.calls[0] as unknown as [ModelRequestOptions])[0].maxTokens).toBe(50);
  });
});

// ----------------------------------------------------------------------------
// Cheap tier fallback to Anthropic Haiku
// ----------------------------------------------------------------------------

describe("createAskAI: cheap-tier fallback to Haiku", () => {
  it("falls back to Anthropic Haiku when Groq is unavailable", async () => {
    const callGroqImpl = vi.fn();
    const callAnthropicImpl = vi.fn(async () =>
      makeResponse("60", "anthropic"),
    );
    const askAI = createAskAI({
      anthropic: fakeAnthropicClient,
      callGroqImpl,
      callAnthropicImpl,
      isGroqAvailableImpl: async () => false,
      log: () => {},
    });

    const text = await askAI("prompt", { tier: "cheap" });
    expect(text).toBe("60");
    expect(callGroqImpl).not.toHaveBeenCalled();
    expect(callAnthropicImpl).toHaveBeenCalledOnce();
    // Cheap tier should use the routine (Haiku) model
    expect((callAnthropicImpl.mock.calls[0] as unknown as [ModelRequestOptions, unknown, string])[2]).toMatch(/haiku/);
  });

  it("falls back to Haiku when Groq throws mid-call", async () => {
    const callGroqImpl = vi.fn(async () => {
      throw new Error("Groq 503");
    });
    const callAnthropicImpl = vi.fn(async () =>
      makeResponse("55", "anthropic"),
    );
    const askAI = createAskAI({
      anthropic: fakeAnthropicClient,
      callGroqImpl,
      callAnthropicImpl,
      isGroqAvailableImpl: async () => true,
      log: () => {},
    });
    const text = await askAI("prompt");
    expect(text).toBe("55");
    expect(callGroqImpl).toHaveBeenCalledOnce();
    expect(callAnthropicImpl).toHaveBeenCalledOnce();
  });

  it("throws when Groq is down AND no Anthropic client is configured", async () => {
    const askAI = createAskAI({
      callGroqImpl: vi.fn(),
      isGroqAvailableImpl: async () => false,
      log: () => {},
    });
    await expect(askAI("prompt")).rejects.toThrow(
      /Anthropic client not configured/,
    );
  });
});

// ----------------------------------------------------------------------------
// Heavy tier — Anthropic Sonnet
// ----------------------------------------------------------------------------

describe("createAskAI: heavy tier (Sonnet)", () => {
  it("routes directly to Anthropic Sonnet for heavy tier", async () => {
    const callGroqImpl = vi.fn();
    const callAnthropicImpl = vi.fn(async () =>
      makeResponse("85", "anthropic"),
    );
    const askAI = createAskAI({
      anthropic: fakeAnthropicClient,
      callGroqImpl,
      callAnthropicImpl,
      isGroqAvailableImpl: async () => true, // even if Groq is up
    });
    const text = await askAI("prompt", { tier: "heavy" });
    expect(text).toBe("85");
    expect(callGroqImpl).not.toHaveBeenCalled();
    expect(callAnthropicImpl).toHaveBeenCalledOnce();
    // Heavy tier uses the Sonnet model
    expect((callAnthropicImpl.mock.calls[0] as unknown as [ModelRequestOptions, unknown, string])[2]).toMatch(/sonnet/);
    // And the longer timeout
    expect((callAnthropicImpl.mock.calls[0] as unknown as [ModelRequestOptions, unknown, string])[0].timeoutMs).toBe(8000);
  });

  it("throws on heavy tier when no Anthropic client is configured", async () => {
    const askAI = createAskAI({
      callGroqImpl: vi.fn(),
      isGroqAvailableImpl: async () => true,
      log: () => {},
    });
    await expect(askAI("prompt", { tier: "heavy" })).rejects.toThrow(
      /Anthropic client not configured/,
    );
  });

  it("does NOT fall back to Groq if heavy-tier Anthropic call fails", async () => {
    // Heavy tier means we want quality, not speed. A failure should
    // propagate, not silently downgrade to cheap.
    const callAnthropicImpl = vi.fn(async () => {
      throw new Error("anthropic_overloaded");
    });
    const callGroqImpl = vi.fn();
    const askAI = createAskAI({
      anthropic: fakeAnthropicClient,
      callGroqImpl,
      callAnthropicImpl,
      isGroqAvailableImpl: async () => true,
    });
    await expect(askAI("prompt", { tier: "heavy" })).rejects.toThrow(
      /anthropic_overloaded/,
    );
    expect(callGroqImpl).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------------
// Custom timeouts
// ----------------------------------------------------------------------------

describe("createAskAI: custom timeouts", () => {
  it("respects a custom cheapTimeoutMs override", async () => {
    const callGroqImpl = vi.fn(async () => makeResponse("70"));
    const askAI = createAskAI({
      callGroqImpl,
      isGroqAvailableImpl: async () => true,
      cheapTimeoutMs: 800,
    });
    await askAI("prompt");
    expect((callGroqImpl.mock.calls[0] as unknown as [ModelRequestOptions])[0].timeoutMs).toBe(800);
  });

  it("respects a custom heavyTimeoutMs override", async () => {
    const callAnthropicImpl = vi.fn(async () =>
      makeResponse("80", "anthropic"),
    );
    const askAI = createAskAI({
      anthropic: fakeAnthropicClient,
      callAnthropicImpl,
      isGroqAvailableImpl: async () => true,
      heavyTimeoutMs: 12_000,
    });
    await askAI("prompt", { tier: "heavy" });
    expect((callAnthropicImpl.mock.calls[0] as unknown as [ModelRequestOptions, unknown, string])[0].timeoutMs).toBe(12_000);
  });
});

// ----------------------------------------------------------------------------
// Resilience — isGroqAvailable() throws shouldn't crash the askAI call
// ----------------------------------------------------------------------------

describe("createAskAI: resilience", () => {
  it("treats isGroqAvailable() throwing as 'unavailable' and falls back to Haiku", async () => {
    const callAnthropicImpl = vi.fn(async () =>
      makeResponse("50", "anthropic"),
    );
    const askAI = createAskAI({
      anthropic: fakeAnthropicClient,
      callGroqImpl: vi.fn(),
      callAnthropicImpl,
      isGroqAvailableImpl: async () => {
        throw new Error("DNS lookup failed");
      },
      log: () => {},
    });
    const text = await askAI("prompt");
    expect(text).toBe("50");
    expect(callAnthropicImpl).toHaveBeenCalledOnce();
  });
});
