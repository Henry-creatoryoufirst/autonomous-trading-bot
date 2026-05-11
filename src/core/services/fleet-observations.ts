/**
 * Fleet Observations — fetches the latest thought from each of the 4
 * master-fleet agents on schertzingertrading.com (Operator, Capital
 * Manager, Core Sleeve, Alpha Sleeve) and formats them into a prompt
 * block the heavy-cycle Sonnet decider sees on every full cycle.
 *
 * Closes the loop: the agents have been observing + reasoning all day,
 * but the bot's trade decider didn't know they existed. Now every heavy
 * cycle gets four expert opinions injected just before the decision.
 *
 * Default OFF behind FLEET_OBSERVATIONS_ENABLED. Graceful fallback: any
 * fetch error or disabled flag → empty block, prompt unchanged.
 *
 * Env:
 *   FLEET_OBSERVATIONS_ENABLED  "true" to enable. Default: off.
 *   FLEET_THOUGHTS_TOKEN        Bearer token (matches CRON_SECRET on the
 *                               website). Required when enabled.
 *   FLEET_THOUGHTS_URL          Override endpoint. Default:
 *                               https://schertzingertrading.com/api/admin/agent-fleet/latest-thoughts
 *   FLEET_THOUGHTS_TIMEOUT_MS   Fetch timeout. Default: 4000.
 */

import axios from "axios";

const DEFAULT_URL =
  "https://schertzingertrading.com/api/admin/agent-fleet/latest-thoughts";
const DEFAULT_TIMEOUT_MS = 4000;
const MAX_OBSERVATION_CHARS = 280;
const MAX_ANOMALIES_PER_AGENT = 3;
const MAX_EXECUTED_ACTIONS_PER_AGENT = 2;
const MAX_ACTION_CHARS = 140;

interface FleetThoughtExecutedAction {
  action: string;
  class: "A" | "B";
  status: "ok" | "error";
  result: string;
}

interface FleetThought {
  ts: string;
  observation: string;
  anomalies?: string[];
  questions?: string[];
  proposedActions?: string[];
  executedActions?: FleetThoughtExecutedAction[];
  modelUsed?: string;
}

export interface FleetObservationsResponse {
  fetchedAt: string;
  operator: FleetThought | null;
  capitalManager: FleetThought | null;
  coreSleeve: FleetThought | null;
  alphaSleeve: FleetThought | null;
}

/**
 * Fetches the latest-thoughts aggregator. Returns null on any failure
 * (disabled, missing config, network error, non-200 response). Never
 * throws — failures must not break the heavy cycle.
 */
export async function fetchFleetObservations(): Promise<FleetObservationsResponse | null> {
  if (process.env.FLEET_OBSERVATIONS_ENABLED !== "true") return null;

  const token = process.env.FLEET_THOUGHTS_TOKEN;
  if (!token) {
    console.warn(
      "[FleetObservations] FLEET_THOUGHTS_TOKEN unset — skipping fetch",
    );
    return null;
  }

  const url = process.env.FLEET_THOUGHTS_URL || DEFAULT_URL;
  const timeoutMs = parseTimeout(
    process.env.FLEET_THOUGHTS_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );

  try {
    const res = await axios.get(url, {
      headers: { authorization: `Bearer ${token}` },
      timeout: timeoutMs,
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      console.warn(
        `[FleetObservations] HTTP ${res.status} from ${url} — skipping injection this cycle`,
      );
      return null;
    }
    const data = res.data as FleetObservationsResponse;
    if (!data || typeof data !== "object" || !data.fetchedAt) {
      console.warn("[FleetObservations] malformed response shape");
      return null;
    }
    return data;
  } catch (err) {
    console.warn(
      `[FleetObservations] fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

function parseTimeout(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 500 || n > 30_000) return fallback;
  return n;
}

/**
 * Formats the fleet observations into a single ═══ FLEET OBSERVATIONS ═══
 * block the bot's heavy-cycle prompt can include verbatim. Returns ""
 * when there's nothing to inject (disabled / fetch failed / all 4 agents
 * null) so callers can concat unconditionally.
 *
 * Voice match: same ═══ section header style + same compact prose as
 * the rest of the prompt. The bot's Sonnet decider reads this as "four
 * specialist agents just told me what they see — weigh accordingly."
 */
export function formatFleetObservationsBlock(
  data: FleetObservationsResponse | null,
): string {
  if (!data) return "";
  const sections: string[] = [];
  pushAgent(sections, "Operator", data.operator, data.fetchedAt);
  pushAgent(sections, "Capital Manager", data.capitalManager, data.fetchedAt);
  pushAgent(sections, "Core Sleeve", data.coreSleeve, data.fetchedAt);
  pushAgent(sections, "Alpha Sleeve", data.alphaSleeve, data.fetchedAt);
  if (sections.length === 0) return "";

  return [
    "",
    "═══ FLEET OBSERVATIONS ═══",
    "Four specialist observation agents tick every 15 min on this bot's state.",
    "Each one's most recent thought is below. Weigh as expert second-opinions;",
    "they do NOT have authority to trade. You make the call.",
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}

function pushAgent(
  out: string[],
  label: string,
  thought: FleetThought | null,
  fetchedAt: string,
): void {
  if (!thought) return;
  const ageMin = ageMinutes(thought.ts, fetchedAt);
  const lines: string[] = [`${label} (${ageMin} min ago):`];
  lines.push(`  ▸ ${truncate(thought.observation, MAX_OBSERVATION_CHARS)}`);

  if (thought.anomalies && thought.anomalies.length > 0) {
    const top = thought.anomalies
      .slice(0, MAX_ANOMALIES_PER_AGENT)
      .map((a) => truncate(a, 100))
      .join(" | ");
    lines.push(`  Anomalies: ${top}`);
  }

  if (thought.executedActions && thought.executedActions.length > 0) {
    const top = thought.executedActions
      .slice(0, MAX_EXECUTED_ACTIONS_PER_AGENT)
      .filter((e) => e.status === "ok" && e.result)
      .map((e) => `[${e.class}] ${truncate(e.result, MAX_ACTION_CHARS)}`);
    if (top.length > 0) {
      lines.push(`  Executed Tier 2: ${top.join(" || ")}`);
    }
  }

  out.push(lines.join("\n"));
}

function ageMinutes(ts: string, fetchedAt: string): number {
  const t = Date.parse(ts);
  const f = Date.parse(fetchedAt);
  if (!Number.isFinite(t) || !Number.isFinite(f)) return 0;
  return Math.max(0, Math.round((f - t) / 60_000));
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}
