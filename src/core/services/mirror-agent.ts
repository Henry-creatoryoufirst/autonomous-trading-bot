/**
 * Mirror Agent — per-family-bot translator of master-fleet observations.
 *
 * See `NVR-SPEC-MIRROR-Per-Bot-Master-Decision-Translation.md` in the
 * Cathedral (`02 - Projects/NVR Capital/Specs/`) for the full design.
 *
 * Short version:
 *   - The master fleet (Operator, Capital Manager, Core Sleeve, Alpha
 *     Sleeve + 15 token specialists) runs ONCE alongside efficient-peace.
 *     Its thoughts are exposed via
 *     https://schertzingertrading.com/api/admin/agent-fleet/latest-thoughts.
 *   - Every OTHER family bot (K&H, Zachary, Ryan, Dansley...) runs ONE
 *     lightweight Haiku mirror per cycle that reads those master thoughts,
 *     layers in THIS bot's portfolio context, and produces a single
 *     translated thought.
 *   - The mirror's thought is read-only context. The family bot's existing
 *     decision pipeline weighs it like any other prompt block.
 *
 * Default OFF behind MIRROR_AGENT_ENABLED. This file is scaffold only —
 * the wiring into agent-v3.2.ts is a separate session per the spec's
 * Phase 1 plan.
 *
 * Env:
 *   MIRROR_AGENT_ENABLED      "true" to enable. Default: off.
 *   MIRROR_BOT_NAME           Bot identifier (e.g. "kathy-howard"). Falls
 *                             back to RAILWAY_SERVICE_NAME, then "unnamed".
 *   FLEET_THOUGHTS_TOKEN      Bearer token. Same value as on efficient-peace.
 *   FLEET_THOUGHTS_URL        Override endpoint. Default points at the
 *                             canonical aggregator on schertzingertrading.com.
 *   MIRROR_MAX_STALENESS_MIN  Master thoughts older than this → state-only
 *                             mode. Default 30.
 *   MIRROR_MODEL              Override Haiku model. Default
 *                             claude-haiku-4-5-20251001.
 *   MIRROR_TIMEOUT_MS         Per-tick wall-clock budget. Default 5000.
 */

import axios from "axios";
import type Anthropic from "@anthropic-ai/sdk";

const DEFAULT_AGGREGATOR_URL =
  "https://schertzingertrading.com/api/admin/agent-fleet/latest-thoughts";
const DEFAULT_MAX_STALENESS_MIN = 30;
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_TOKENS = 600;
const FETCH_TIMEOUT_MS = 4_000;

/**
 * Master-fleet thought shape (mirror of the schertzingertrading.com
 * aggregator response). Each agent field is null when that agent has no
 * thoughts yet or its KV read failed.
 */
interface MasterThought {
  ts: string;
  observation: string;
  anomalies?: string[];
  questions?: string[];
  proposedActions?: string[];
  modelUsed?: string;
}

interface MasterFleetResponse {
  fetchedAt: string;
  operator: MasterThought | null;
  capitalManager: MasterThought | null;
  coreSleeve: MasterThought | null;
  alphaSleeve: MasterThought | null;
}

/**
 * State the family bot's heavy-cycle path passes in each tick. Subset of
 * the bot's own portfolio snapshot — enough for the mirror to translate
 * master thoughts to THIS bot's scale.
 */
export interface BotContextInput {
  portfolioValueUSD: number;
  usdcBalanceUSD: number;
  positionsCount: number;
  positionsSymbols: string[];
  recentTradesCount24h: number;
  hwm: number;
}

export interface MirrorThought {
  ts: string;
  botName: string;
  observation: string;
  relevantAnomalies: string[];
  questions: string[];
  proposedPosture: string[];
  master: {
    fetchedAt: string;
    operatorTs: string | null;
    capitalManagerTs: string | null;
    coreSleeveTs: string | null;
    alphaSleeveTs: string | null;
    maxAgeMin: number;
    stale: boolean;
  };
  botContext: {
    portfolioValueUSD: number;
    usdcBalanceUSD: number;
    usdcReservePct: number;
    positionsCount: number;
    positionsSymbols: string[];
    recentTradesCount24h: number;
    hwm: number;
  };
  mode: "mirror" | "stateOnly";
  modelUsed: string;
}

/**
 * Injectable Haiku caller — tests pass a stub, prod wires this to the
 * model-client. Returns the raw text response from the model.
 */
export type HaikuCallerFn = (req: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxTokens: number;
}) => Promise<string>;

export interface MirrorAgentOptions {
  botName: string;
  aggregatorUrl?: string;
  authToken?: string;
  maxStalenessMin?: number;
  haikuCaller?: HaikuCallerFn;
  nowFn?: () => Date;
  model?: string;
  /**
   * Wall-clock budget for the whole tick (fetch + Haiku). Defaults to
   * DEFAULT_TIMEOUT_MS. The integration in agent-v3.2.ts also enforces
   * its own outer timeout — this one is the mirror's internal ceiling.
   */
  timeoutMs?: number;
  /**
   * Anthropic client. Required if you don't pass a custom haikuCaller.
   * Tests can omit both and rely on the stub.
   */
  anthropic?: Anthropic;
}

export class MirrorAgent {
  private readonly botName: string;
  private readonly aggregatorUrl: string;
  private readonly authToken: string | undefined;
  private readonly maxStalenessMin: number;
  private readonly haikuCaller: HaikuCallerFn;
  private readonly nowFn: () => Date;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(opts: MirrorAgentOptions) {
    this.botName = opts.botName;
    this.aggregatorUrl = opts.aggregatorUrl ||
      process.env.FLEET_THOUGHTS_URL ||
      DEFAULT_AGGREGATOR_URL;
    this.authToken = opts.authToken ?? process.env.FLEET_THOUGHTS_TOKEN;
    this.maxStalenessMin =
      opts.maxStalenessMin ??
      parsePositiveInt(
        process.env.MIRROR_MAX_STALENESS_MIN,
        DEFAULT_MAX_STALENESS_MIN,
      );
    this.nowFn = opts.nowFn ?? (() => new Date());
    this.model =
      opts.model ?? process.env.MIRROR_MODEL ?? DEFAULT_MODEL;
    this.timeoutMs =
      opts.timeoutMs ??
      parsePositiveInt(process.env.MIRROR_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.haikuCaller =
      opts.haikuCaller ?? defaultHaikuCaller(opts.anthropic);
  }

  /**
   * Runs one mirror cycle. Returns null when disabled (env flag off) or
   * when the underlying Haiku call fails. NEVER throws — the family bot
   * must be able to proceed regardless of mirror state.
   */
  async runMirrorTick(
    botContext: BotContextInput,
  ): Promise<MirrorThought | null> {
    if (process.env.MIRROR_AGENT_ENABLED !== "true") {
      return null;
    }

    const masterFleet = await this.fetchMasterFleetThoughts();
    const mode: "mirror" | "stateOnly" =
      masterFleet && !this.isAllStale(masterFleet)
        ? "mirror"
        : "stateOnly";

    let raw: string;
    try {
      raw = await this.haikuCaller({
        systemPrompt: this.buildSystemPrompt(mode),
        userPrompt: this.buildUserPrompt(masterFleet, botContext, mode),
        model: this.model,
        maxTokens: DEFAULT_MAX_TOKENS,
      });
    } catch (err) {
      console.warn(
        `[MirrorAgent:${this.botName}] Haiku call failed: ${describe(err)}`,
      );
      return null;
    }

    return this.parseMirrorResponse(raw, masterFleet, botContext, mode);
  }

  private async fetchMasterFleetThoughts(): Promise<MasterFleetResponse | null> {
    if (!this.authToken) {
      console.warn(
        `[MirrorAgent:${this.botName}] FLEET_THOUGHTS_TOKEN unset — falling back to state-only`,
      );
      return null;
    }
    try {
      const res = await axios.get(this.aggregatorUrl, {
        headers: { authorization: `Bearer ${this.authToken}` },
        timeout: Math.min(FETCH_TIMEOUT_MS, this.timeoutMs),
        validateStatus: () => true,
      });
      if (res.status !== 200) {
        console.warn(
          `[MirrorAgent:${this.botName}] aggregator HTTP ${res.status} — state-only mode`,
        );
        return null;
      }
      const data = res.data as MasterFleetResponse;
      if (!data || typeof data !== "object" || !data.fetchedAt) {
        console.warn(
          `[MirrorAgent:${this.botName}] malformed aggregator response`,
        );
        return null;
      }
      return data;
    } catch (err) {
      console.warn(
        `[MirrorAgent:${this.botName}] aggregator fetch failed: ${describe(err)}`,
      );
      return null;
    }
  }

  private isAllStale(fleet: MasterFleetResponse): boolean {
    const ts = [
      fleet.operator?.ts,
      fleet.capitalManager?.ts,
      fleet.coreSleeve?.ts,
      fleet.alphaSleeve?.ts,
    ].filter((s): s is string => typeof s === "string" && s.length > 0);
    if (ts.length === 0) return true;
    const now = this.nowFn().getTime();
    const maxAgeMin = Math.max(
      ...ts.map((s) => (now - Date.parse(s)) / 60_000),
    );
    return maxAgeMin > this.maxStalenessMin;
  }

  private buildSystemPrompt(mode: "mirror" | "stateOnly"): string {
    if (mode === "stateOnly") {
      return [
        `You are the ${this.botName} Mirror Agent.`,
        "The master agent fleet's latest thoughts are unavailable or too stale.",
        "Reason from THIS bot's portfolio state alone.",
        "Produce a single, sober thought about posture for the next 15-30 min.",
        "Do NOT invent master-fleet insights. Do NOT propose trades — only posture.",
        "Respond as JSON with fields: observation (string, 1-3 sentences),",
        "relevantAnomalies (string[]), questions (string[]), proposedPosture (string[]).",
      ].join("\n");
    }
    return [
      `You are the ${this.botName} Mirror Agent.`,
      "The master fleet (Operator, Capital Manager, Core Sleeve, Alpha Sleeve)",
      "just reasoned about the main bot's state. THIS bot has a different",
      "portfolio, different positions, different USDC %. Your job:",
      "translate the master fleet's posture to what makes sense for THIS bot.",
      "",
      "Rules:",
      "1. Anomalies the master flagged that don't touch this bot's holdings are NOT",
      "   relevant — exclude them.",
      "2. Proposed posture must respect this bot's MIN_DRY_POWDER_PCT (25%) and",
      "   this bot's existing positions. Do NOT mirror master trades blindly.",
      "3. You produce ADVISORY context only — never authoritative.",
      "4. Note when the master fleet's overall posture and this bot's state",
      "   genuinely diverge (e.g. master is deploying, this bot is already at",
      "   target deployment).",
      "",
      "Respond as JSON with fields: observation (string, 2-4 sentences),",
      "relevantAnomalies (string[]), questions (string[]), proposedPosture (string[]).",
    ].join("\n");
  }

  private buildUserPrompt(
    masterFleet: MasterFleetResponse | null,
    ctx: BotContextInput,
    mode: "mirror" | "stateOnly",
  ): string {
    const usdcPct = safeReservePct(ctx);
    const lines: string[] = [
      `BOT NAME: ${this.botName}`,
      `MODE: ${mode}`,
      "",
      "═══ THIS BOT'S STATE ═══",
      `Portfolio value: $${ctx.portfolioValueUSD.toFixed(2)}`,
      `USDC balance:    $${ctx.usdcBalanceUSD.toFixed(2)} (${(usdcPct * 100).toFixed(1)}% reserve)`,
      `Positions:       ${ctx.positionsCount} (${ctx.positionsSymbols.join(", ") || "none"})`,
      `Trades last 24h: ${ctx.recentTradesCount24h}`,
      `High-water mark: $${ctx.hwm.toFixed(2)}`,
      "",
    ];

    if (masterFleet && mode === "mirror") {
      lines.push("═══ MASTER FLEET LATEST THOUGHTS ═══");
      lines.push(`(fetched ${masterFleet.fetchedAt})`);
      lines.push("");
      pushMasterSection(lines, "OPERATOR", masterFleet.operator);
      pushMasterSection(
        lines,
        "CAPITAL MANAGER",
        masterFleet.capitalManager,
      );
      pushMasterSection(lines, "CORE SLEEVE", masterFleet.coreSleeve);
      pushMasterSection(lines, "ALPHA SLEEVE", masterFleet.alphaSleeve);
    } else {
      lines.push("═══ MASTER FLEET ═══");
      lines.push(
        "Master fleet thoughts unavailable or stale. Reason from state alone.",
      );
      lines.push("");
    }

    lines.push("");
    lines.push(
      "Return JSON only. No prose, no code fences. Schema:",
    );
    lines.push(
      `{"observation":"...","relevantAnomalies":["..."],"questions":["..."],"proposedPosture":["..."]}`,
    );
    return lines.join("\n");
  }

  private parseMirrorResponse(
    raw: string,
    masterFleet: MasterFleetResponse | null,
    ctx: BotContextInput,
    mode: "mirror" | "stateOnly",
  ): MirrorThought | null {
    let parsed: unknown;
    try {
      parsed = extractJsonObject(raw);
    } catch (err) {
      console.warn(
        `[MirrorAgent:${this.botName}] JSON extract failed: ${describe(err)}`,
      );
      return null;
    }
    if (!parsed || typeof parsed !== "object") {
      console.warn(
        `[MirrorAgent:${this.botName}] parsed response not an object`,
      );
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const observation =
      typeof obj.observation === "string" ? obj.observation.trim() : "";
    if (!observation) {
      console.warn(
        `[MirrorAgent:${this.botName}] no observation field in response`,
      );
      return null;
    }

    const now = this.nowFn();
    const masterMeta = this.deriveMasterMeta(masterFleet, now);

    return {
      ts: now.toISOString(),
      botName: this.botName,
      observation: observation.slice(0, 800),
      relevantAnomalies: stringArrayField(obj, "relevantAnomalies"),
      questions: stringArrayField(obj, "questions"),
      proposedPosture: stringArrayField(obj, "proposedPosture"),
      master: masterMeta,
      botContext: {
        portfolioValueUSD: ctx.portfolioValueUSD,
        usdcBalanceUSD: ctx.usdcBalanceUSD,
        usdcReservePct: safeReservePct(ctx),
        positionsCount: ctx.positionsCount,
        positionsSymbols: [...ctx.positionsSymbols],
        recentTradesCount24h: ctx.recentTradesCount24h,
        hwm: ctx.hwm,
      },
      mode,
      modelUsed: this.model,
    };
  }

  private deriveMasterMeta(
    fleet: MasterFleetResponse | null,
    now: Date,
  ): MirrorThought["master"] {
    if (!fleet) {
      return {
        fetchedAt: now.toISOString(),
        operatorTs: null,
        capitalManagerTs: null,
        coreSleeveTs: null,
        alphaSleeveTs: null,
        maxAgeMin: Infinity,
        stale: true,
      };
    }
    const tss = [
      fleet.operator?.ts ?? null,
      fleet.capitalManager?.ts ?? null,
      fleet.coreSleeve?.ts ?? null,
      fleet.alphaSleeve?.ts ?? null,
    ];
    const ages = tss
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .map((s) => (now.getTime() - Date.parse(s)) / 60_000);
    const maxAgeMin = ages.length === 0 ? Infinity : Math.max(...ages);
    return {
      fetchedAt: fleet.fetchedAt,
      operatorTs: tss[0],
      capitalManagerTs: tss[1],
      coreSleeveTs: tss[2],
      alphaSleeveTs: tss[3],
      maxAgeMin: Number.isFinite(maxAgeMin) ? Math.round(maxAgeMin) : -1,
      stale: maxAgeMin > this.maxStalenessMin,
    };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function defaultHaikuCaller(anthropic?: Anthropic): HaikuCallerFn {
  return async ({ systemPrompt, userPrompt, model, maxTokens }) => {
    if (!anthropic) {
      throw new Error(
        "MirrorAgent: no Anthropic client provided and no haikuCaller injected",
      );
    }
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = response.content[0];
    return block?.type === "text" ? block.text : "";
  };
}

function pushMasterSection(
  out: string[],
  label: string,
  thought: MasterThought | null,
): void {
  if (!thought) {
    out.push(`${label}: (no thought)`);
    out.push("");
    return;
  }
  out.push(`${label} (${thought.ts}):`);
  out.push(`  ${thought.observation}`);
  if (thought.anomalies && thought.anomalies.length > 0) {
    out.push(`  Anomalies: ${thought.anomalies.slice(0, 4).join(" | ")}`);
  }
  if (thought.questions && thought.questions.length > 0) {
    out.push(`  Questions: ${thought.questions.slice(0, 3).join(" | ")}`);
  }
  if (thought.proposedActions && thought.proposedActions.length > 0) {
    out.push(
      `  Proposed: ${thought.proposedActions.slice(0, 3).join(" | ")}`,
    );
  }
  out.push("");
}

function stringArrayField(
  obj: Record<string, unknown>,
  key: string,
): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function safeReservePct(ctx: BotContextInput): number {
  if (!Number.isFinite(ctx.portfolioValueUSD) || ctx.portfolioValueUSD <= 0) {
    return 0;
  }
  const pct = ctx.usdcBalanceUSD / ctx.portfolioValueUSD;
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return Math.min(pct, 1);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tolerant JSON object extractor — mirrors the website-side helper in
 * stc-website/src/lib/agent-thought-utils.ts. Survives:
 *   - bare JSON
 *   - code-fenced JSON (```json ... ```)
 *   - leading/trailing prose
 *   - max_tokens-induced truncation (recovers from last depth-1 comma)
 *
 * Kept inline here rather than importing from the website to avoid a
 * cross-repo dependency. Behavioral parity is enforced by sharing a
 * test vector with the website-side parser in CI (future work).
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fullyFenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fullyFenced ? fullyFenced[1].trim() : trimmed;
  if (!fullyFenced) {
    candidate = candidate.replace(/^```(?:json)?\s*/i, "");
  }
  const start = candidate.indexOf("{");
  if (start === -1) throw new Error("no JSON object in response");

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1));
      }
    }
  }

  const recovered = tryRecoverTruncatedJson(candidate.slice(start));
  if (recovered !== null) return recovered;
  throw new Error("unbalanced JSON object in response");
}

function tryRecoverTruncatedJson(body: string): unknown | null {
  if (!body.startsWith("{")) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastDepth1Comma = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 1) lastDepth1Comma = i;
  }
  if (lastDepth1Comma === -1) return null;
  try {
    return JSON.parse(body.slice(0, lastDepth1Comma) + "}");
  } catch {
    return null;
  }
}
