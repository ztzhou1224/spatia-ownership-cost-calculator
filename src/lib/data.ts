/** Loads one ZIP's place: its ZIP file, its state's county file, and the state's prices. */
import states from "../data/states.generated.json";
import type { CountyData, Place, StateData, ZipData } from "./types";

const STATES = states as Record<string, StateData>;
const cache = new Map<string, Promise<unknown>>();

async function getJson<T>(url: string): Promise<T | null> {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return (await cache.get(url)) as T | null;
}

export type LoadResult = { ok: true; place: Place } | { ok: false; reason: "format" | "unknown" };

export async function loadPlace(zip: string, base = import.meta.env.BASE_URL): Promise<LoadResult> {
  if (!/^\d{5}$/.test(zip)) return { ok: false, reason: "format" };
  const zips = await getJson<Record<string, ZipData>>(`${base}data/zip/${zip.slice(0, 3)}.json`);
  const z = zips?.[zip];
  if (!z) return { ok: false, reason: "unknown" };
  const counties = await getJson<Record<string, CountyData>>(`${base}data/county/${z.st}.json`);
  return { ok: true, place: { zip, zipData: z, county: counties?.[z.county] ?? null, state: STATES[z.st] ?? null } };
}
