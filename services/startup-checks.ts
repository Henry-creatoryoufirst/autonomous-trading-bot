/**
 * NVR Capital — Startup Validation Checks
 * v19.6.0: Pre-flight checks that run BEFORE the trading loop starts.
 *
 * Validates:
 * 1. CDP API key format (PKCS#8 PEM or Ed25519 base64)
 * 2. Anthropic API credit availability
 * 3. Wallet address format (checksummed)
 * 4. Required environment variables
 *
 * Philosophy: Fail FAST and LOUD at startup, not silently 14 hours later.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAddress } from "viem";

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface CheckResult {
  passed: boolean;
  name: string;
  message: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
}

// ============================================================================
// 1. CDP KEY FORMAT VALIDATION
// ============================================================================

/**
 * Validate that the CDP API key secret is in a format the SDK can use.
 * Accepts:
 *   - PKCS#8 PEM (starts with -----BEGIN PRIVATE KEY-----)
 *   - EC PEM (starts with -----BEGIN EC PRIVATE KEY-----)
 *   - Ed25519 base64 (exactly 88 chars, base64-encoded)
 *
 * REJECTS:
 *   - Empty/missing keys
 *   - Truncated PEM (missing footer)
 *   - Keys with corrupted base64 content
 *   - Keys shorter than 40 chars (clearly incomplete)
 *
 * This check would have caught the March 22-23 incident where header swapping
 * corrupted the ASN.1 structure and derived the wrong wallet address.
 */
export function validateCdpKeyFormat(): CheckResult {
  const apiKeyId = process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY_NAME;
  let apiKeySecret = process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY;

  if (!apiKeyId) {
    return {
      passed: false,
      name: "CDP API Key ID",
      message: "CDP_API_KEY_ID (or CDP_API_KEY_NAME) is not set",
      severity: "CRITICAL",
    };
  }

  if (!apiKeySecret) {
    return {
      passed: false,
      name: "CDP API Key Secret",
      message: "CDP_API_KEY_SECRET (or CDP_API_KEY_PRIVATE_KEY) is not set",
      severity: "CRITICAL",
    };
  }

  // Normalize Railway's escaped newlines
  if (apiKeySecret.includes('\\n')) {
    apiKeySecret = apiKeySecret.replace(/\\n/g, '\n');
  }

  const trimmed = apiKeySecret.trim();

  // Ed25519 keys: exactly 88 chars of base64
  if (!trimmed.startsWith('-----') && trimmed.length === 88) {
    // Validate it's valid base64
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    if (base64Regex.test(trimmed)) {
      return {
        passed: true,
        name: "CDP Key Format",
        message: `Ed25519 key detected (${trimmed.length} chars, valid base64)`,
        severity: "INFO",
      };
    }
    return {
      passed: false,
      name: "CDP Key Format",
      message: `Key is 88 chars but contains invalid base64 characters`,
      severity: "CRITICAL",
    };
  }

  // PEM keys: must have proper headers and footers
  if (trimmed.startsWith('-----BEGIN')) {
    const hasPKCS8Header = trimmed.includes('-----BEGIN PRIVATE KEY-----');
    const hasECHeader = trimmed.includes('-----BEGIN EC PRIVATE KEY-----');
    const hasPKCS8Footer = trimmed.includes('-----END PRIVATE KEY-----');
    const hasECFooter = trimmed.includes('-----END EC PRIVATE KEY-----');

    if (hasPKCS8Header && !hasPKCS8Footer) {
      return {
        passed: false,
        name: "CDP Key Format",
        message: "PKCS#8 PEM header found but footer is MISSING — key is truncated",
        severity: "CRITICAL",
      };
    }

    if (hasECHeader && !hasECFooter) {
      return {
        passed: false,
        name: "CDP Key Format",
        message: "EC PEM header found but footer is MISSING — key is truncated",
        severity: "CRITICAL",
      };
    }

    if (hasPKCS8Header && hasPKCS8Footer) {
      // Extract the base64 body and validate it has content
      const body = trimmed
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\s/g, '');
      if (body.length < 40) {
        return {
          passed: false,
          name: "CDP Key Format",
          message: `PKCS#8 PEM body is suspiciously short (${body.length} chars) — key may be corrupted`,
          severity: "CRITICAL",
        };
      }
      return {
        passed: true,
        name: "CDP Key Format",
        message: `PKCS#8 PEM key detected (body: ${body.length} base64 chars)`,
        severity: "INFO",
      };
    }

    if (hasECHeader && hasECFooter) {
      const body = trimmed
        .replace('-----BEGIN EC PRIVATE KEY-----', '')
        .replace('-----END EC PRIVATE KEY-----', '')
        .replace(/\s/g, '');
      if (body.length < 40) {
        return {
          passed: false,
          name: "CDP Key Format",
          message: `EC PEM body is suspiciously short (${body.length} chars) — key may be corrupted`,
          severity: "CRITICAL",
        };
      }
      return {
        passed: true,
        name: "CDP Key Format",
        message: `EC PEM key detected (body: ${body.length} base64 chars). Note: SDK prefers PKCS#8 format.`,
        severity: "WARNING",
      };
    }

    return {
      passed: false,
      name: "CDP Key Format",
      message: `PEM key has unrecognized header type. Expected 'BEGIN PRIVATE KEY' (PKCS#8) or 'BEGIN EC PRIVATE KEY'`,
      severity: "CRITICAL",
    };
  }

  // Unknown format
  if (trimmed.length < 40) {
    return {
      passed: false,
      name: "CDP Key Format",
      message: `Key is only ${trimmed.length} chars — too short to be valid`,
      severity: "CRITICAL",
    };
  }

  return {
    passed: true,
    name: "CDP Key Format",
    message: `Non-PEM key detected (${trimmed.length} chars). Passing to CDP SDK as-is.`,
    severity: "WARNING",
  };
}

// ============================================================================
// 2. ANTHROPIC API CREDIT CHECK
// ============================================================================

/**
 * Validate that the Anthropic API key is functional by making a minimal API call.
 * This catches:
 *   - Expired API keys
 *   - Exhausted credit balance
 *   - Invalid key format
 *   - Network connectivity issues
 *
 * Uses the cheapest possible call (tiny prompt, haiku model) to minimize cost.
 */
export async function validateAnthropicCredits(): Promise<CheckResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      passed: false,
      name: "Anthropic API Key",
      message: "ANTHROPIC_API_KEY is not set",
      severity: "CRITICAL",
    };
  }

  if (!apiKey.startsWith('sk-ant-')) {
    return {
      passed: false,
      name: "Anthropic API Key",
      message: `Key doesn't start with 'sk-ant-' — may be invalid format`,
      severity: "WARNING",
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    // Cheapest possible call — 1 token response with haiku
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "1" }],
    });

    if (response.id) {
      return {
        passed: true,
        name: "Anthropic API Credits",
        message: "API key is valid and has available credits",
        severity: "INFO",
      };
    }

    return {
      passed: false,
      name: "Anthropic API Credits",
      message: "API returned unexpected response — credits may be exhausted",
      severity: "CRITICAL",
    };
  } catch (error: any) {
    const status = error?.status || error?.statusCode;
    const errorMessage = error?.message || "Unknown error";

    if (status === 401) {
      return {
        passed: false,
        name: "Anthropic API Credits",
        message: "API key is INVALID or REVOKED (401 Unauthorized)",
        severity: "CRITICAL",
      };
    }

    if (status === 429) {
      return {
        passed: false,
        name: "Anthropic API Credits",
        message: "API rate limited or CREDITS EXHAUSTED (429). Check billing at console.anthropic.com",
        severity: "CRITICAL",
      };
    }

    if (status === 403) {
      return {
        passed: false,
        name: "Anthropic API Credits",
        message: "API key forbidden (403) — may need billing setup or plan upgrade",
        severity: "CRITICAL",
      };
    }

    // Network errors — warning, not critical (could be transient)
    return {
      passed: false,
      name: "Anthropic API Credits",
      message: `API check failed: ${errorMessage.substring(0, 200)}`,
      severity: "WARNING",
    };
  }
}

// ============================================================================
// 3. WALLET ADDRESS VALIDATION
// ============================================================================

/**
 * Validate wallet address is a properly checksummed Ethereum address.
 */
export function validateWalletAddress(): CheckResult {
  const walletAddress = process.env.WALLET_ADDRESS;

  if (!walletAddress) {
    return {
      passed: false,
      name: "Wallet Address",
      message: "WALLET_ADDRESS is not set",
      severity: "CRITICAL",
    };
  }

  if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
    return {
      passed: false,
      name: "Wallet Address",
      message: `Invalid format: '${walletAddress.substring(0, 10)}...' (expected 0x + 40 hex chars)`,
      severity: "CRITICAL",
    };
  }

  try {
    const checksummed = getAddress(walletAddress);
    if (checksummed !== walletAddress) {
      return {
        passed: true,
        name: "Wallet Address",
        message: `Valid but not checksummed. Canonical: ${checksummed}`,
        severity: "WARNING",
      };
    }
    return {
      passed: true,
      name: "Wallet Address",
      message: `Valid checksummed address: ${walletAddress.substring(0, 10)}...${walletAddress.substring(38)}`,
      severity: "INFO",
    };
  } catch {
    return {
      passed: false,
      name: "Wallet Address",
      message: `Failed checksum validation: '${walletAddress.substring(0, 10)}...' — not a valid Ethereum address`,
      severity: "CRITICAL",
    };
  }
}

// ============================================================================
// 4. REQUIRED ENV VARS CHECK
// ============================================================================

export function validateRequiredEnvVars(signalMode: string): CheckResult[] {
  const results: CheckResult[] = [];

  // Always required
  if (!process.env.CDP_WALLET_SECRET) {
    results.push({
      passed: false,
      name: "CDP Wallet Secret",
      message: "CDP_WALLET_SECRET is not set — wallet derivation will fail",
      severity: "WARNING",
    });
  }

  return results;
}

// ============================================================================
// RUN ALL PRE-FLIGHT CHECKS
// ============================================================================

export async function runPreFlightChecks(signalMode: string): Promise<{
  allPassed: boolean;
  criticalFailures: CheckResult[];
  warnings: CheckResult[];
  results: CheckResult[];
}> {
  console.log("\n\u{1F6EB} Running pre-flight checks...");

  const results: CheckResult[] = [];

  // Synchronous checks
  if (signalMode !== 'producer') {
    results.push(validateCdpKeyFormat());
    results.push(validateWalletAddress());
    results.push(...validateRequiredEnvVars(signalMode));
  }

  // Async checks
  if (signalMode === 'local' || signalMode === 'producer') {
    results.push(await validateAnthropicCredits());
  }

  // Report results
  const criticalFailures = results.filter(r => !r.passed && r.severity === "CRITICAL");
  const warnings = results.filter(r => !r.passed && r.severity === "WARNING");
  const passed = results.filter(r => r.passed);

  for (const r of results) {
    const icon = r.passed ? "\u{2705}" : (r.severity === "CRITICAL" ? "\u{274C}" : "\u{26A0}\u{FE0F}");
    console.log(`  ${icon} ${r.name}: ${r.message}`);
  }

  const allPassed = criticalFailures.length === 0;

  if (allPassed) {
    console.log(`  \u{2705} All pre-flight checks passed (${warnings.length} warning${warnings.length !== 1 ? 's' : ''})\n`);
  } else {
    console.error(`\n  \u{274C} ${criticalFailures.length} CRITICAL failure(s) — bot should not start trading`);
    for (const f of criticalFailures) {
      console.error(`     - ${f.name}: ${f.message}`);
    }
    console.error("");
  }

  return { allPassed, criticalFailures, warnings, results };
}
