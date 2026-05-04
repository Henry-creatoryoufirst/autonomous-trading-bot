/**
 * NVR · Speculative Retro Sweep
 *
 * Runs every hypothesis in `config/pattern-hypotheses.json` through the
 * existing event-reaction retro harness. Each hypothesis is just a
 * parameter set (env vars) for that harness — same statistical machinery
 * (same gate criteria, same volume-null comparison, same distribution
 * stats), different inputs.
 *
 * Output: `data/spec-sweep/<UTC-date>-results.json` with the verdict for
 * each hypothesis × pattern combination, plus a summary of survivors.
 *
 * The "NVR · Pattern Hypothesis Sweep" routine runs this daily and
 * proposes any survivors as auto-PR'd SPEC stubs.
 *
 * Cache reuse: each hypothesis runs against the same cached candle data
 * (no new GeckoTerminal API calls). Total cost ≈ N × ~10s CPU.
 *
 * Usage:
 *   npx tsx scripts/spec-sweep.ts
 *   npx tsx scripts/spec-sweep.ts --config <alt-config.json>
 *   npx tsx scripts/spec-sweep.ts --dry-run        # parse config + print
 *                                                  #  what would run; no exec
 *
 * Exit codes:
 *   0  always (downstream routine reads the JSON output, not exit code)
 */

import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// ----------------------------------------------------------------------------
// Types — match the existing harness's verdict shape
// ----------------------------------------------------------------------------

interface Hypothesis {
  name: string;
  rationale: string;
  params: Record<string, string>;
}

interface HarnessVerdict {
  label: string;
  n: number;
  hitRate: number;
  stopRate: number;
  μ: number;
  med: number;
  σ: number;
  skew: number;
  nullHitRate: number;
  edge: number;
  allPass: boolean;
}

interface SweepResult {
  hypothesisName: string;
  rationale: string;
  params: Record<string, string>;
  patternLabel: string;
  n: number;
  hitRate: number;
  edge: number;
  nullHitRate: number;
  μ: number;
  σ: number;
  allPass: boolean;
  /** Margin-pass: cleared with margin per SPEC-024 (n≥40, hit≥42%, edge≥17pp). */
  marginPass: boolean;
  error?: string;
}

interface SweepSummary {
  runAt: string;
  hypothesesTested: number;
  hypothesesErrored: number;
  patternsEvaluated: number;
  survivors: SweepResult[];
  marginSurvivors: SweepResult[];
  allResults: SweepResult[];
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function parseArgs(argv: readonly string[]): {
  configPath: string;
  dryRun: boolean;
} {
  let configPath = "config/pattern-hypotheses.json";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config" && argv[i + 1]) {
      configPath = argv[i + 1]!;
      i++;
    } else if (a === "--dry-run") {
      dryRun = true;
    }
  }
  return { configPath, dryRun };
}

function utcDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A pattern verdict clears margin if it has comfortable headroom over the
 *  base gates. SPEC-024's promotion criteria. */
function clearsWithMargin(v: HarnessVerdict): boolean {
  return v.n >= 40 && v.hitRate >= 0.42 && v.edge >= 0.17;
}

// ----------------------------------------------------------------------------
// Run one hypothesis through the harness
// ----------------------------------------------------------------------------

function runHypothesis(
  hypothesis: Hypothesis,
  repoRoot: string,
): { verdicts: HarnessVerdict[]; error?: string } {
  // The harness writes its results to `data/observation-pass/<UTC-date>-event-reaction-retro.json`.
  // Each run overwrites the previous, so we read it immediately after
  // spawnSync returns. (No race — spawnSync is blocking.)
  const env = {
    ...process.env,
    ...hypothesis.params,
    // Quiet the harness so the sweep's output stays readable
    NO_COLOR: "1",
  };

  const result = spawnSync(
    "npx",
    ["tsx", "scripts/observation-event-reaction.ts"],
    {
      cwd: repoRoot,
      env,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120_000,
    },
  );

  if (result.error) {
    return { verdicts: [], error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      verdicts: [],
      error: `harness exited with code ${result.status}: ${result.stderr?.slice(0, 200) ?? ""}`,
    };
  }

  const outputPath = join(
    repoRoot,
    "data/observation-pass",
    `${utcDateStamp()}-event-reaction-retro.json`,
  );
  if (!existsSync(outputPath)) {
    return {
      verdicts: [],
      error: `harness ran but output file missing at ${outputPath}`,
    };
  }

  let parsed: { verdicts?: HarnessVerdict[] };
  try {
    parsed = JSON.parse(readFileSync(outputPath, "utf-8")) as {
      verdicts?: HarnessVerdict[];
    };
  } catch (e) {
    return { verdicts: [], error: `failed to parse output: ${(e as Error).message}` };
  }

  return { verdicts: parsed.verdicts ?? [] };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(__dirname, "..");
  const configPath = join(repoRoot, args.configPath);

  if (!existsSync(configPath)) {
    console.error(`config not found: ${configPath}`);
    process.exit(2);
  }

  const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
    hypotheses: Hypothesis[];
  };

  if (!Array.isArray(config.hypotheses) || config.hypotheses.length === 0) {
    console.error(`config has no hypotheses to sweep`);
    process.exit(2);
  }

  console.log(`=== NVR Speculative Retro Sweep ===`);
  console.log(`Hypotheses: ${config.hypotheses.length}`);
  console.log(`Config: ${args.configPath}`);
  if (args.dryRun) console.log(`MODE: DRY RUN — no execution\n`);
  else console.log("");

  if (args.dryRun) {
    for (const h of config.hypotheses) {
      console.log(`  • ${h.name}`);
      console.log(`    ${h.rationale}`);
      console.log(`    params: ${JSON.stringify(h.params)}`);
    }
    return;
  }

  const allResults: SweepResult[] = [];
  let errored = 0;

  for (const h of config.hypotheses) {
    process.stdout.write(`[${h.name}] running… `);
    const t0 = Date.now();
    const { verdicts, error } = runHypothesis(h, repoRoot);
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

    if (error) {
      console.log(`ERROR (${elapsedSec}s): ${error.slice(0, 100)}`);
      allResults.push({
        hypothesisName: h.name,
        rationale: h.rationale,
        params: h.params,
        patternLabel: "(harness-error)",
        n: 0,
        hitRate: 0,
        edge: 0,
        nullHitRate: 0,
        μ: 0,
        σ: 0,
        allPass: false,
        marginPass: false,
        error,
      });
      errored++;
      continue;
    }

    if (verdicts.length === 0) {
      console.log(`no verdicts produced (${elapsedSec}s)`);
      continue;
    }

    const lines: string[] = [];
    for (const v of verdicts) {
      const margin = clearsWithMargin(v);
      const result: SweepResult = {
        hypothesisName: h.name,
        rationale: h.rationale,
        params: h.params,
        patternLabel: v.label,
        n: v.n,
        hitRate: v.hitRate,
        edge: v.edge,
        nullHitRate: v.nullHitRate,
        μ: v.μ,
        σ: v.σ,
        allPass: v.allPass,
        marginPass: margin,
      };
      allResults.push(result);

      const icon = v.allPass && margin ? "🎯" : v.allPass ? "✅" : "❌";
      lines.push(
        `    ${icon} ${v.label.split(" ")[0]}: ` +
          `n=${v.n} hit=${(v.hitRate * 100).toFixed(1)}% edge=${(v.edge * 100).toFixed(1)}pp` +
          (margin ? " (margin-pass)" : ""),
      );
    }
    console.log(`done (${elapsedSec}s)`);
    for (const line of lines) console.log(line);
  }

  // Summary
  const survivors = allResults.filter((r) => r.allPass);
  const marginSurvivors = allResults.filter((r) => r.marginPass);

  const summary: SweepSummary = {
    runAt: new Date().toISOString(),
    hypothesesTested: config.hypotheses.length,
    hypothesesErrored: errored,
    patternsEvaluated: allResults.length,
    survivors,
    marginSurvivors,
    allResults,
  };

  const outDir = join(repoRoot, "data/spec-sweep");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${utcDateStamp()}-results.json`);
  writeFileSync(outFile, JSON.stringify(summary, null, 2));

  console.log("");
  console.log(`=== Summary ===`);
  console.log(
    `Hypotheses: ${config.hypotheses.length} (${errored} errored). ` +
      `Pattern verdicts: ${allResults.length}.`,
  );
  console.log(
    `Survivors (all gates): ${survivors.length}. ` +
      `Margin survivors (per SPEC-024 promotion bar): ${marginSurvivors.length}.`,
  );
  if (marginSurvivors.length > 0) {
    console.log("");
    console.log("🎯 Margin survivors — candidates for SPEC promotion:");
    for (const s of marginSurvivors) {
      console.log(
        `  - ${s.hypothesisName} / ${s.patternLabel.split(" ")[0]}: ` +
          `n=${s.n} hit=${(s.hitRate * 100).toFixed(1)}% edge=${(s.edge * 100).toFixed(1)}pp`,
      );
    }
  } else if (survivors.length > 0) {
    console.log("");
    console.log("✅ Gate survivors (no margin yet — borderline):");
    for (const s of survivors) {
      console.log(
        `  - ${s.hypothesisName} / ${s.patternLabel.split(" ")[0]}: ` +
          `n=${s.n} hit=${(s.hitRate * 100).toFixed(1)}% edge=${(s.edge * 100).toFixed(1)}pp`,
      );
    }
  } else {
    console.log("");
    console.log("No survivors today. Search-space narrowed.");
  }

  console.log("");
  console.log(`Output: ${outFile}`);
}

main();
