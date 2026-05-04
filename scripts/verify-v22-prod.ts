/**
 * NVR-SPEC-024 — v22 Production Verification Script
 *
 * Run after deploying the v22-enabled forward-harness to Railway, OR
 * any time you want to confirm v22 is healthy in production.
 *
 * Hits the forward-harness's HTTP endpoints, asserts the v22 stack is
 * actually firing, and reports a clear pass/fail with specific failure
 * modes — not just a generic "broken." Categorizes findings into
 * BLOCKING (must fix before trusting paper-mode data) vs INFORMATIONAL
 * (paper-mode-as-designed, e.g. "no API keys → no entries").
 *
 * Usage:
 *   npx tsx scripts/verify-v22-prod.ts <base-url>
 *
 *   examples:
 *     npx tsx scripts/verify-v22-prod.ts https://observation-harness-production.up.railway.app
 *     npx tsx scripts/verify-v22-prod.ts http://localhost:3000
 *
 * Exit codes:
 *   0 — all blocking checks pass; informational items may exist
 *   1 — at least one blocking check failed; v22 is not fully healthy
 *   2 — could not reach the service at all
 */

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "INFO" | "WARN";
  message: string;
  blocking: boolean;
}

interface V22StatusResponse {
  enabled: boolean;
  lastTickAt?: number | null;
  lastTickAgeSec?: number | null;
  totalTicks?: number;
  totalTriggers?: number;
  totalEntered?: number;
  totalExited?: number;
  openPositions?: number;
  closedPositions?: number;
  lastError?: string | null;
  patternStatuses?: Record<string, "disabled" | "paper" | "live">;
  reason?: string; // when enabled=false
}

interface HealthResponse {
  status: string;
  uptimeSec: number;
  lastPollAgeSec: number | null;
  lastPollError: string | null;
  pollErrorCount: number;
  v22?: V22StatusResponse;
  [k: string]: unknown;
}

const FETCH_TIMEOUT_MS = 8_000;

async function httpGetJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function pass(name: string, message: string): CheckResult {
  return { name, status: "PASS", message, blocking: false };
}
function fail(name: string, message: string): CheckResult {
  return { name, status: "FAIL", message, blocking: true };
}
function warn(name: string, message: string): CheckResult {
  return { name, status: "WARN", message, blocking: false };
}
function info(name: string, message: string): CheckResult {
  return { name, status: "INFO", message, blocking: false };
}

async function verify(baseUrl: string): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  // ── 1. Reachability ──────────────────────────────────────────────────
  let health: HealthResponse;
  try {
    health = await httpGetJson<HealthResponse>(`${baseUrl}/health`);
    checks.push(pass("reachability", `${baseUrl}/health responded`));
  } catch (e) {
    checks.push(fail("reachability", `${baseUrl}/health failed: ${(e as Error).message}`));
    return checks;
  }

  // ── 2. Forward-harness itself is healthy (existing IntermediarySurge) ─
  if (health.status === "ok") {
    checks.push(
      pass(
        "forward-harness-status",
        `existing IntermediarySurge layer is healthy (uptime ${Math.floor(health.uptimeSec / 3600)}h)`,
      ),
    );
  } else {
    checks.push(
      warn(
        "forward-harness-status",
        `IntermediarySurge layer status=${health.status} (lastPollAge=${health.lastPollAgeSec}s, errors=${health.pollErrorCount}). v22 might still work but parent harness is degraded.`,
      ),
    );
  }

  // ── 3. v22 enabled? ──────────────────────────────────────────────────
  const v22 = health.v22;
  if (!v22) {
    checks.push(fail("v22-block-present", "/health response has no `v22` field — branch likely missing the SPEC-024 integration"));
    return checks;
  }
  if (!v22.enabled) {
    checks.push(
      fail(
        "v22-enabled",
        `v22 reports enabled=false. Set V22_RUNTIME_ENABLED=true on the Railway service and redeploy. ${v22.reason ? `(server reason: ${v22.reason})` : ""}`,
      ),
    );
    return checks;
  }
  checks.push(pass("v22-enabled", "v22.enabled=true"));

  // ── 4. /api/v22-summary endpoint also working ───────────────────────
  let summary: V22StatusResponse;
  try {
    summary = await httpGetJson<V22StatusResponse>(`${baseUrl}/api/v22-summary`);
    if (summary.enabled !== true) {
      checks.push(
        fail(
          "v22-summary-endpoint",
          `/api/v22-summary returned enabled=${summary.enabled}. Inconsistent with /health (which reported enabled=true).`,
        ),
      );
    } else {
      checks.push(pass("v22-summary-endpoint", "/api/v22-summary returns valid status"));
    }
  } catch (e) {
    checks.push(fail("v22-summary-endpoint", `/api/v22-summary failed: ${(e as Error).message}`));
    return checks;
  }

  // ── 5. Patterns registered ──────────────────────────────────────────
  const patternCount = Object.keys(summary.patternStatuses ?? {}).length;
  if (patternCount === 0) {
    checks.push(fail("patterns-registered", "No patterns registered on the runtime. registerPostVolatilityLong was not called or failed silently."));
  } else if (patternCount < 3) {
    checks.push(
      warn(
        "patterns-registered",
        `Only ${patternCount} pattern(s) registered, expected 3 (AERO/BRETT/DEGEN). Some failed to instantiate.`,
      ),
    );
  } else {
    const statuses = Object.values(summary.patternStatuses ?? {});
    const distinct = Array.from(new Set(statuses));
    checks.push(
      pass(
        "patterns-registered",
        `${patternCount} patterns registered (status: ${distinct.join(", ")})`,
      ),
    );

    // Check status alignment
    if (statuses.every((s) => s === "disabled")) {
      checks.push(
        warn(
          "patterns-status",
          "All patterns are 'disabled' — they won't tick. Set V22_PATTERN_STATUS=paper to enable paper-mode firing.",
        ),
      );
    } else if (statuses.some((s) => s === "live") && summary.openPositions === 0) {
      checks.push(info("patterns-status", "Some patterns are 'live' but no open positions (yet)."));
    } else if (statuses.every((s) => s === "paper")) {
      checks.push(pass("patterns-status", "All patterns at status='paper' — paper-mode soak in progress"));
    }
  }

  // ── 6. Has the runtime ticked recently? ─────────────────────────────
  if (summary.lastTickAt === null || summary.lastTickAt === undefined) {
    checks.push(
      warn(
        "v22-tick-firing",
        "Runtime has never ticked. If the service was just deployed, wait 60-120s and re-run this verification. If it's been longer, the polling-loop integration may not be calling tick().",
      ),
    );
  } else {
    const ageSec = summary.lastTickAgeSec ?? Math.floor((Date.now() - summary.lastTickAt) / 1000);
    if (ageSec > 300) {
      checks.push(
        fail(
          "v22-tick-firing",
          `lastTickAgeSec=${ageSec}s — runtime stopped ticking >5 min ago. Check forward-harness logs for [v22] errors.`,
        ),
      );
    } else if (ageSec > 120) {
      checks.push(
        warn(
          "v22-tick-firing",
          `lastTickAgeSec=${ageSec}s — older than the 60s expected cadence. Cadence guard or polling loop may be slow.`,
        ),
      );
    } else {
      checks.push(pass("v22-tick-firing", `last tick ${ageSec}s ago, totalTicks=${summary.totalTicks}`));
    }
  }

  // ── 7. Errors observed? ─────────────────────────────────────────────
  if (summary.lastError) {
    checks.push(
      fail(
        "v22-no-errors",
        `lastError reported: "${summary.lastError}". Check forward-harness logs for full stack trace.`,
      ),
    );
  } else {
    checks.push(pass("v22-no-errors", "No errors reported by the runtime"));
  }

  // ── 8. Trigger + entry signals (informational) ──────────────────────
  if ((summary.totalTriggers ?? 0) === 0 && (summary.totalTicks ?? 0) > 5) {
    checks.push(
      info(
        "v22-trigger-activity",
        `${summary.totalTicks} ticks, 0 triggers detected. Expected if the meme tokens haven't moved 5%+ in 1h windows. Will pick up on volatility.`,
      ),
    );
  } else if ((summary.totalTriggers ?? 0) > 0) {
    checks.push(
      pass(
        "v22-trigger-activity",
        `triggers=${summary.totalTriggers} entered=${summary.totalEntered} exited=${summary.totalExited} (open=${summary.openPositions}, closed=${summary.closedPositions})`,
      ),
    );
  }

  // ── 9. Conviction layer (informational) ─────────────────────────────
  // We can't directly probe whether ANTHROPIC_API_KEY is set on the
  // server, but if there have been triggers AND entered=0 always,
  // that's a strong hint askAI is vetoing every time (fail-closed).
  if (
    (summary.totalTriggers ?? 0) > 3 &&
    (summary.totalEntered ?? 0) === 0
  ) {
    checks.push(
      info(
        "v22-conviction-layer",
        `${summary.totalTriggers} triggers fired but 0 entries. If ANTHROPIC_API_KEY/GROQ_API_KEY are unset, every confirm() vetoes (fail-closed by design). Set keys to enable the conviction layer.`,
      ),
    );
  }

  return checks;
}

function printResults(checks: readonly CheckResult[]): void {
  const ICON = { PASS: "✅", FAIL: "❌", WARN: "⚠️ ", INFO: "ℹ️ " };

  console.log("\n=== v22 Production Verification ===\n");
  for (const c of checks) {
    console.log(`${ICON[c.status]} [${c.name}] ${c.message}`);
  }

  const blocking = checks.filter((c) => c.blocking);
  const passing = checks.filter((c) => c.status === "PASS").length;
  const warning = checks.filter((c) => c.status === "WARN").length;
  const informational = checks.filter((c) => c.status === "INFO").length;

  console.log("");
  console.log(
    `Summary: ${passing} pass, ${blocking.length} blocking fail, ${warning} warn, ${informational} info`,
  );
  console.log("");

  if (blocking.length > 0) {
    console.log("⛔ BLOCKING ISSUES — fix these before trusting v22 paper-mode data:");
    for (const c of blocking) {
      console.log(`  - ${c.name}: ${c.message}`);
    }
    console.log("");
  } else {
    console.log("✅ No blocking issues. v22 is healthy in this deployment.");
    console.log("");
  }

  if (warning > 0 || informational > 0) {
    console.log("Notes (non-blocking):");
    for (const c of checks) {
      if (c.status === "WARN" || c.status === "INFO") {
        console.log(`  - ${c.name}: ${c.message}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error("Usage: npx tsx scripts/verify-v22-prod.ts <base-url>");
    console.error("Example: npx tsx scripts/verify-v22-prod.ts https://observation-harness-production.up.railway.app");
    process.exit(2);
  }

  let checks: CheckResult[];
  try {
    checks = await verify(baseUrl.replace(/\/$/, ""));
  } catch (e) {
    console.error("Verification crashed:", (e as Error).message);
    process.exit(2);
  }

  printResults(checks);

  const blockingFails = checks.filter((c) => c.blocking).length;
  process.exit(blockingFails > 0 ? 1 : 0);
}

main();
