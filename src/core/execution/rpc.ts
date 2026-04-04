/**
 * Never Rest Capital — RPC Management & Balance Reads
 * Extracted from agent-v3.2.ts (Phase 4 refactor)
 *
 * Multi-endpoint RPC with automatic failover, plus on-chain balance reads.
 */

import axios from 'axios';

// ============================================================================
// RPC STATE
// ============================================================================

let rpcEndpoints: string[] = [];
let currentRpcIndex = 0;
let rpcFailCounts: number[] = [];

/** Initialize RPC with endpoint list from constants */
export function initRpc(endpoints: string[]) {
  rpcEndpoints = endpoints;
  currentRpcIndex = 0;
  rpcFailCounts = new Array(endpoints.length).fill(0);
}

// ============================================================================
// RPC FUNCTIONS
// ============================================================================

export function getCurrentRpc(): string {
  return rpcEndpoints[currentRpcIndex] || rpcEndpoints[0];
}

export function rotateRpc(failedIndex: number): string {
  rpcFailCounts[failedIndex]++;
  const nextIndex = (failedIndex + 1) % rpcEndpoints.length;
  currentRpcIndex = nextIndex;
  console.log(`   🔄 RPC rotated: ${rpcEndpoints[failedIndex]} → ${rpcEndpoints[nextIndex]} (fails: ${rpcFailCounts.join(',')})`);
  return rpcEndpoints[nextIndex];
}

export async function rpcCall(method: string, params: any[]): Promise<any> {
  for (let rpcAttempt = 0; rpcAttempt < rpcEndpoints.length; rpcAttempt++) {
    const rpcUrl = rpcAttempt === 0 ? getCurrentRpc() : rpcEndpoints[(currentRpcIndex + rpcAttempt) % rpcEndpoints.length];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await axios.post(rpcUrl, {
          jsonrpc: "2.0", id: 1, method, params,
        }, { timeout: 12000 });
        if (response.data.error) {
          throw new Error(`RPC error: ${response.data.error.message}`);
        }
        if (rpcAttempt > 0) {
          currentRpcIndex = (currentRpcIndex + rpcAttempt) % rpcEndpoints.length;
        }
        return response.data.result;
      } catch (error: any) {
        const status = error?.response?.status;
        const isRetryable = status === 429 || status === 502 || status === 503 ||
          error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND';
        if (isRetryable && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, attempt * 1500));
          continue;
        }
        break;
      }
    }
  }
  throw new Error(`All ${rpcEndpoints.length} RPC endpoints failed for ${method}`);
}

// ============================================================================
// BALANCE READS
// ============================================================================

export async function getETHBalance(address: string): Promise<number> {
  const result = await rpcCall("eth_getBalance", [address, "latest"]);
  return parseInt(result, 16) / 1e18;
}

export async function getERC20Balance(tokenAddress: string, walletAddress: string, decimals: number = 18): Promise<number> {
  const data = "0x70a08231" + walletAddress.slice(2).padStart(64, "0");
  const result = await rpcCall("eth_call", [{ to: tokenAddress, data }, "latest"]);
  return parseInt(result, 16) / Math.pow(10, decimals);
}
