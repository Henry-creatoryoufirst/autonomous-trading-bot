/**
 * Never Rest Capital — Execution Helpers
 * Extracted from agent-v3.2.ts (Phase 4 refactor)
 *
 * Token address/decimals lookup with discovery engine fallback.
 */

// Module-level deps
let TOKEN_REGISTRY: Record<string, any>;
let tokenDiscoveryEngine: any;

export function initExecutionHelpers(deps: { TOKEN_REGISTRY: Record<string, any>; tokenDiscoveryEngine: any }) {
  TOKEN_REGISTRY = deps.TOKEN_REGISTRY;
  tokenDiscoveryEngine = deps.tokenDiscoveryEngine;
}

export function getTokenAddress(symbol: string): string {
  const token = TOKEN_REGISTRY[symbol];
  if (token) {
    if (token.address === "native") {
      return TOKEN_REGISTRY["WETH"].address;
    }
    return token.address;
  }
  if (tokenDiscoveryEngine) {
    const discovered = tokenDiscoveryEngine.getDiscoveredTokens().find(
      (t: any) => t.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (discovered) return discovered.address;
  }
  throw new Error(`Unknown token: ${symbol}`);
}

export function getTokenDecimals(symbol: string): number {
  if (TOKEN_REGISTRY[symbol]) return TOKEN_REGISTRY[symbol].decimals;
  if (tokenDiscoveryEngine) {
    const discovered = tokenDiscoveryEngine.getDiscoveredTokens().find(
      (t: any) => t.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (discovered) return discovered.decimals;
  }
  return 18;
}
