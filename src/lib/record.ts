/**
 * Every calculation goes through the Worker (owner, 2026-11-19: "every calculation needs to go through backend"; and the purpose,
 * the same day: "the purpose is to collect data. We record what every user put in combination"). The page posts what the visitor
 * set to `POST /api/estimate`; the Worker loads the place, runs the same `resolveAssumptions` + `calculate`, saves the
 * combination in D1 `inputs` and answers with the result the page shows.
 *
 * Saved per calculation: the query typed, the geocoded address, the place, every input as used, which inputs and cost lines the
 * visitor changed, each line and the totals. Never an IP address, name, email, cookie or device field; a visit is tied together
 * only by a random id the page makes for its own tab. A visitor who chose "Do not save my inputs" sends `record: "no"` and is not
 * saved; choosing it later deletes the visit's rows (`POST /api/forget`).
 */
import type { AssumptionKey, Assumptions, LineKey, Result } from "./calc";
import { LINE_KEYS } from "./calc";
import type { AddressFacts } from "./lookup";

export type RecordChoice = "yes" | "no" | "pending";

export interface EstimateRequest {
  /** The tab's random id (a UUID). */
  session: string;
  /** 1, 2, 3 … within the session. */
  seq: number;
  /** What the visitor typed in the search box (an address or a ZIP code). */
  query: string;
  zip: string;
  /** The address lookup's facts, when the visitor entered an address. */
  facts: AddressFacts | null;
  /** The inputs the visitor changed, with their values. */
  changed: Partial<Assumptions>;
  /** The cost lines the visitor set, a year. */
  setLines: Partial<Record<LineKey, number>>;
  record: RecordChoice;
}

export type EstimateAnswer =
  | { ok: true; values: Assumptions; defaults: Assumptions; sources: Partial<Record<AssumptionKey, string>>; result: Result }
  | { ok: false; reason: string };

export const ESTIMATE_MAX_BYTES = 16_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const SCALAR = (v: unknown) => v === null || typeof v === "boolean" || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

/**
 * The Worker's check of a posted request: its shape and types. `inputKeys` are the calculator's input names (from its defaults).
 * Returns the reason it is refused, or null.
 */
export function requestProblem(p: unknown, inputKeys: ReadonlySet<string>): string | null {
  if (!isObj(p)) return "not_object";
  if (typeof p.session !== "string" || !UUID.test(p.session)) return "session";
  if (typeof p.seq !== "number" || !Number.isInteger(p.seq) || p.seq < 1 || p.seq > 100_000) return "seq";
  if (typeof p.query !== "string" || p.query.length > 200) return "query";
  if (typeof p.zip !== "string" || !/^\d{5}$/.test(p.zip)) return "zip";
  if (p.facts !== null && !isObj(p.facts)) return "facts";
  if (isObj(p.facts) && (typeof p.facts.zip !== "string" || p.facts.zip !== p.zip || typeof p.facts.label !== "string" || p.facts.label.length > 200)) return "facts";
  if (!isObj(p.changed)) return "changed";
  for (const [k, v] of Object.entries(p.changed)) {
    if (!inputKeys.has(k)) return "changed";
    if (!(SCALAR(v) || (Array.isArray(v) && v.length <= 200 && v.every((x) => typeof x === "string" && x.length <= 40)))) return "changed";
  }
  if (!isObj(p.setLines)) return "set_lines";
  for (const [k, v] of Object.entries(p.setLines)) if (!(LINE_KEYS as readonly string[]).includes(k) || typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e8) return "set_lines";
  if (p.record !== "yes" && p.record !== "no" && p.record !== "pending") return "record";
  return null;
}

/** The row the Worker saves for one calculation. */
export function recordRow(r: EstimateRequest, values: Assumptions, result: Result, st: string, county: string, build: string): unknown[] {
  return [
    r.session,
    r.seq,
    r.seq === 1 ? "load" : "edit",
    new Date().toISOString(),
    r.query.slice(0, 200),
    r.facts?.label ?? null,
    r.zip,
    st,
    county,
    JSON.stringify(values),
    JSON.stringify(Object.keys(r.changed)),
    JSON.stringify(r.setLines),
    JSON.stringify(Object.fromEntries(result.lines.map((l) => [l.key, Math.round(l.yearly * 100) / 100]))),
    Math.round(result.monthly * 100) / 100,
    Math.round(result.yearly * 100) / 100,
    build.slice(0, 80),
  ];
}

export const RECORD_SQL =
  "INSERT OR IGNORE INTO inputs (session, seq, kind, recorded_at, query, address, zip, st, county, values_json, changed_json, set_lines_json, lines_json, monthly, yearly, build) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
