/** Loads one ZIP's place: its ZIP file, its state's county file, and the state's prices. */
import states from "../data/states.generated.json";
import type { AddressFacts, LookupAnswer } from "./lookup";
import type { CountyData, Place, StateData, ZipData } from "./types";

const STATES = states as Record<string, StateData>;
const cache = new Map<string, Promise<unknown>>();

async function getJson<T>(url: string): Promise<T | null> {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return (await cache.get(url)) as T | null;
}

export type LoadResult = { ok: true; place: Place } | { ok: false; reason: "format" | "unknown" | "not_found" | "not_trusted" | "unavailable" | "bad_request" | "busy" };

export type JsonReader = <T>(path: string) => Promise<T | null>;

/** The place of a ZIP (and the lookup's facts), read through `read` (the browser's fetch, or the Worker's static assets). */
export async function placeOf(read: JsonReader, zip: string, facts: AddressFacts | null): Promise<LoadResult> {
  if (!/^\d{5}$/.test(zip)) return { ok: false, reason: "format" };
  const zips = await read<Record<string, ZipData>>(`data/zip/${zip.slice(0, 3)}.json`);
  const z0 = zips?.[zip];
  if (!z0) return { ok: false, reason: "unknown" };
  // the roll's county wins over the ZIP's (a ZIP can cross a county line)
  const z = facts?.county && facts.county.slice(0, 2) === z0.county.slice(0, 2) ? { ...z0, county: facts.county } : z0;
  const counties = await read<Record<string, CountyData>>(`data/county/${z.st}.json`);
  return { ok: true, place: { zip, zipData: z, county: counties?.[z.county] ?? null, state: STATES[z.st] ?? null, facts } };
}

export function loadPlace(zip: string, facts: AddressFacts | null = null): Promise<LoadResult> {
  const base = import.meta.env.BASE_URL;
  return placeOf((path) => getJson(`${base}${path}`), zip, facts);
}

/** An address: the Worker's lookup, then the place of its ZIP. */
export async function loadAddress(address: string): Promise<LoadResult> {
  let a: LookupAnswer;
  try {
    const r = await fetch(`/api/lookup?address=${encodeURIComponent(address)}`, { cache: "no-store" });
    a = (await r.json()) as LookupAnswer;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!a.ok) return a;
  return loadPlace(a.facts.zip, a.facts);
}
