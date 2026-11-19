/**
 * What the site records (owner direction 2026-11-19: "This should be a free site without login, the purpose is to collect data.
 * We record what every user put in combination"). One row per snapshot of a visit: the place, every input as used, which inputs
 * and cost lines the visitor changed, and the result. No IP address, name, email, cookie or device field is stored; a visit is
 * tied together only by a random id the page makes for its own tab (`sessionStorage`).
 */
import type { Assumptions, LineKey, Result } from "./calc";
import type { Place } from "./types";

export const RECORD_KINDS = ["load", "edit", "leave"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export interface RecordPayload {
  /** The tab's random id (a UUID). */
  session: string;
  /** 1, 2, 3 … within the session. */
  seq: number;
  kind: RecordKind;
  /** What the visitor typed in the search box (an address or a ZIP code). */
  query: string;
  place: { zip: string; st: string; county: string; address: string | null };
  values: Assumptions;
  /** The inputs the visitor changed (their values are in `values`). */
  changed: (keyof Assumptions)[];
  /** The cost lines the visitor set, a year. */
  setLines: Partial<Record<LineKey, number>>;
  /** Each line a year as shown, and the totals. */
  lines: Partial<Record<LineKey, number>>;
  monthly: number;
  yearly: number;
  /** The site's data build (the data service build the tables came from). */
  build: string;
}

export const RECORD_MAX_BYTES = 16_000;

export function makePayload(a: { session: string; seq: number; kind: RecordKind; query: string; place: Place; values: Assumptions; changed: (keyof Assumptions)[]; setLines: Partial<Record<LineKey, number>>; result: Result; build: string }): RecordPayload {
  return {
    session: a.session,
    seq: a.seq,
    kind: a.kind,
    query: a.query.slice(0, 200),
    place: { zip: a.place.zip, st: a.place.zipData.st, county: a.place.zipData.county, address: a.place.facts?.label ?? null },
    values: a.values,
    changed: a.changed,
    setLines: a.setLines,
    lines: Object.fromEntries(a.result.lines.map((l) => [l.key, Math.round(l.yearly * 100) / 100])),
    monthly: Math.round(a.result.monthly * 100) / 100,
    yearly: Math.round(a.result.yearly * 100) / 100,
    build: a.build,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** The Worker's check of a posted payload: its shape, sizes and types. Returns the reason it is refused, or null. */
export function payloadProblem(p: unknown): string | null {
  if (!isObj(p)) return "not_object";
  if (typeof p.session !== "string" || !UUID.test(p.session)) return "session";
  if (typeof p.seq !== "number" || !Number.isInteger(p.seq) || p.seq < 1 || p.seq > 10_000) return "seq";
  if (!RECORD_KINDS.includes(p.kind as RecordKind)) return "kind";
  if (typeof p.query !== "string" || p.query.length > 200) return "query";
  const pl = p.place;
  if (!isObj(pl) || typeof pl.zip !== "string" || !/^\d{5}$/.test(pl.zip) || typeof pl.st !== "string" || !/^[A-Z]{2}$/.test(pl.st) || typeof pl.county !== "string" || !/^\d{5}$/.test(pl.county)) return "place";
  if (pl.address !== null && (typeof pl.address !== "string" || pl.address.length > 200)) return "address";
  if (!isObj(p.values) || !Array.isArray(p.changed) || !isObj(p.setLines) || !isObj(p.lines)) return "fields";
  if (!p.changed.every((k) => typeof k === "string" && k in (p.values as object))) return "changed";
  if (typeof p.monthly !== "number" || typeof p.yearly !== "number" || !Number.isFinite(p.monthly) || !Number.isFinite(p.yearly)) return "totals";
  if (typeof p.build !== "string" || p.build.length > 80) return "build";
  return null;
}
