/**
 * The calculator's Worker: the static site (Workers static assets) and ONE API, `GET /api/lookup?address=…`.
 *
 * The lookup asks Spatia's geocoder (`/geocode`) for the address, and, for a trusted (rooftop-grade) point only, Spatia's data
 * service (`/query`) at that point: FEMA's flood zone; in Florida the county roll's parcel and its tax district. The address is
 * not logged and the answer is `no-store`. Every calculation goes through `POST /api/estimate` (owner, 2026-11-19), which runs
 * the calculator here and saves the combination in D1 `inputs`, with no IP address, name, email or device field. The Worker authenticates with a spatia-auth service client
 * (`SPATIA_CLIENT_ID` / `SPATIA_CLIENT_SECRET`, Worker secrets; audience `geocode`).
 */
import { floodZoneOf, rollOf, type AddressFacts, type LookupAnswer } from "../src/lib/lookup";
import { calculate, NATIONAL, resolveAssumptions } from "../src/lib/calc";
import { placeOf, type JsonReader } from "../src/lib/data";
import { ESTIMATE_MAX_BYTES, RECORD_SQL, recordRow, requestProblem, type EstimateAnswer, type EstimateRequest } from "../src/lib/record";
import { matchListing, matchProperty, RENTCAST_LISTINGS_URL, RENTCAST_PROPERTIES_URL, type ListingFacts, type PropertyFacts } from "../src/lib/rentcast";

export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  SPATIA_CLIENT_ID?: string;
  SPATIA_CLIENT_SECRET?: string;
  /** RentCast's API key (a Worker secret). Without it the lookup reads no property record. */
  RENTCAST_API_KEY?: string;
  /** Cloudflare's rate limiter: lookups per visitor a minute (each one can cost a RentCast call). */
  LOOKUP_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  /** Calculations per visitor a minute. */
  RECORD_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  /** D1 `spatia-ownership-cost`: the `inputs` table (migrations/0001_inputs.sql). */
  DB?: { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } };
  AUTH_ISSUER: string;
  API_ORIGIN: string;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const END_USER = "cost-calculator";

// ---------------------------------------------------------------------------------------------------------------------------
// The service token, kept per isolate until a minute before it expires.

let token: { value: string; until: number } | null = null;

async function bearer(env: Env): Promise<string> {
  if (token && token.until > Date.now()) return token.value;
  if (!env.SPATIA_CLIENT_ID || !env.SPATIA_CLIENT_SECRET) throw new Error("no_client");
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: env.SPATIA_CLIENT_ID, client_secret: env.SPATIA_CLIENT_SECRET, audience: "geocode" });
  const r = await fetch(`${env.AUTH_ISSUER}/oauth/token`, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (!r.ok) throw new Error(`token_${r.status}`);
  const d = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!d.access_token) throw new Error("token_missing");
  token = { value: d.access_token, until: Date.now() + Math.max((d.expires_in ?? 900) - 60, 30) * 1000 };
  return token.value;
}

async function api(env: Env, path: string, body: unknown): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${env.API_ORIGIN}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await bearer(env)}`, "Content-Type": "application/json", Accept: "application/json", "X-Spatia-End-User": END_USER },
      body: JSON.stringify(body),
    });
    if (r.status !== 401) return r;
    token = null;
  }
  throw new Error("unauthorized");
}

// ---------------------------------------------------------------------------------------------------------------------------
// The lookup.

interface Geocode {
  result?: { label: string; lat: number; lon: number; accuracy: number; accuracy_type: string; components?: { postal_code?: string; state_province?: string; city?: string } };
  certainty?: string;
}
interface Check {
  id: string;
  status: string;
  records?: { kind: string; claim: Record<string, unknown> }[];
}

let build: { value: string; until: number } | null = null;
async function catalogBuild(env: Env): Promise<string> {
  if (build && build.until > Date.now()) return build.value;
  const r = await fetch(`${env.API_ORIGIN}/query/catalog`, { headers: { Authorization: `Bearer ${await bearer(env)}`, "X-Spatia-End-User": END_USER } });
  if (!r.ok) throw new Error(`catalog_${r.status}`);
  build = { value: ((await r.json()) as { catalog_build: string }).catalog_build, until: Date.now() + 10 * 60_000 };
  return build.value;
}

async function lookup(env: Env, subject: Record<string, unknown>, checks: Record<string, unknown>[]): Promise<Map<string, Record<string, unknown>[]>> {
  const send = async () => api(env, "/query", { dsl_version: "0.4", mode: "lookup", catalog_build: await catalogBuild(env), subject, checks });
  let r = await send();
  if (r.status === 409) {
    build = null; // the catalog moved: pin the new build once
    r = await send();
  }
  if (!r.ok) throw new Error(`query_${r.status}`);
  const out = new Map<string, Record<string, unknown>[]>();
  for (const c of ((await r.json()) as { checks: Check[] }).checks) {
    out.set(c.id, c.status === "ok" ? (c.records ?? []).filter((x) => x.kind === "OBSERVED" && Object.keys(x.claim).length > 0).map((x) => x.claim) : []);
  }
  return out;
}

/** The calculator's input names (the defaults of any place carry every key). */
const INPUT_KEYS: ReadonlySet<string> = new Set([
  "price", "downPct", "ratePct", "termYears", "pmiPct", "homeType", "sqft", "bedrooms", "yearBuilt", "heating", "cooling", "pool", "liveInHome",
  "floodZone", "buyFlood", "flDistrict", "txUnits", "electricityUsdPerKwh", "gasUsdPerMcf", "hoaMonthly", "flatChargesYearly", "waterMonthly", "maintenancePct",
]);

/** The static data tables, read from the Worker's own assets and kept per isolate. */
const assetCache = new Map<string, Promise<unknown>>();
function assetReader(env: Env, url: URL): JsonReader {
  return <T>(path: string) => {
    if (!assetCache.has(path))
      assetCache.set(
        path,
        env.ASSETS.fetch(new Request(new URL(`/${path}`, url.origin)))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      );
    return assetCache.get(path) as Promise<T | null>;
  };
}

/** RentCast's record for the geocoded address; any failure is no record (the lookup still answers). */
async function property(env: Env, label: string): Promise<PropertyFacts | null> {
  if (!env.RENTCAST_API_KEY) return null;
  try {
    const r = await fetch(`${RENTCAST_PROPERTIES_URL}?${new URLSearchParams({ address: label })}`, { headers: { "X-Api-Key": env.RENTCAST_API_KEY, Accept: "application/json" } });
    if (!r.ok) {
      console.error("rentcast:", r.status);
      return null;
    }
    return matchProperty(await r.json(), label);
  } catch {
    console.error("rentcast: fetch failed");
    return null;
  }
}

/** RentCast's active sale listing for the address; any failure, or no listing, is none. */
async function listing(env: Env, label: string): Promise<ListingFacts | null> {
  if (!env.RENTCAST_API_KEY) return null;
  try {
    const r = await fetch(`${RENTCAST_LISTINGS_URL}?${new URLSearchParams({ address: label, status: "Active" })}`, { headers: { "X-Api-Key": env.RENTCAST_API_KEY, Accept: "application/json" } });
    if (!r.ok) {
      if (r.status !== 404) console.error("rentcast listing:", r.status);
      return null;
    }
    return matchListing(await r.json(), label);
  } catch {
    console.error("rentcast listing: fetch failed");
    return null;
  }
}

export async function answer(env: Env, address: string): Promise<LookupAnswer> {
  const g = await api(env, "/geocode", { q: address });
  if (!g.ok) return { ok: false, reason: g.status === 404 ? "not_found" : "unavailable" };
  const geo = (await g.json()) as Geocode;
  const res = geo.result;
  if (!res) return { ok: false, reason: "not_found" };
  if (geo.certainty !== "trusted") return { ok: false, reason: "not_trusted" };
  const zip = (res.components?.postal_code ?? "").slice(0, 5);
  const st = (res.components?.state_province ?? "").toUpperCase();
  if (!/^\d{5}$/.test(zip) || !/^[A-Z]{2}$/.test(st)) return { ok: false, reason: "not_found" };
  const subject = { kind: "point", lon: res.lon, lat: res.lat, provenance: { source: "geocodio", accuracy_type: res.accuracy_type, accuracy: res.accuracy } };
  const checks: Record<string, unknown>[] = [{ id: "flood", layer: "fema_flood_zones", predicate: { op: "covers" }, columns: ["fld_zone", "sfha_tf"], limit: 10 }];
  if (st === "TX") checks.push({ id: "isd", layer: "us_school_districts_unified", predicate: { op: "covers" }, columns: ["GEOID"], limit: 2 });
  if (st === "FL") checks.push({ id: "roll", layer: "fl_parcels", predicate: { op: "covers" }, columns: ["parcel_id", "county_fips", "dor_uc", "act_yr_blt", "tot_lvg_ar", "no_res_unt", "jv", "asmnt_yr"], limit: 2 });
  const [first, prop, list] = await Promise.all([lookup(env, subject, checks), property(env, res.label), listing(env, res.label)]);
  const rolls = first.get("roll") ?? [];
  // one parcel only: a point on two roll rows (a stacked condominium) gives no roll facts
  const roll = rolls.length === 1 ? rolls[0] : null;
  let flDistrict: string | null = null;
  let flatCharges: AddressFacts["flatCharges"] = null;
  if (roll && typeof roll.parcel_id === "string" && typeof roll.county_fips === "string") {
    const second = await lookup(env, subject, [{ id: "district", layer: "fl_parcel_tax_district", predicate: { op: "keyed", key: "parcel_id", keys: [roll.parcel_id] }, columns: ["county_fips", "tax_auth_cd", "nav_total_usd", "nav_levy_count", "nav_tax_year", "nav_status"], limit: 5 }]);
    const d = (second.get("district") ?? []).filter((x) => x.county_fips === roll.county_fips);
    if (d.length === 1 && typeof d[0].tax_auth_cd === "string") flDistrict = d[0].tax_auth_cd;
    if (d.length === 1 && typeof d[0].nav_status === "string") {
      const n = d[0];
      const usd = typeof n.nav_total_usd === "number" && n.nav_status === "matched" ? n.nav_total_usd : null;
      flatCharges = { amount: usd, year: typeof n.nav_tax_year === "number" ? n.nav_tax_year : null, count: typeof n.nav_levy_count === "number" ? n.nav_levy_count : null, status: String(n.nav_status) };
    }
  }
  const flood = floodZoneOf(first.get("flood") ?? []);
  const facts: AddressFacts = {
    label: res.label,
    zip,
    st,
    county: roll && typeof roll.county_fips === "string" ? roll.county_fips : null,
    floodZone: flood.zone,
    floodZoneCode: flood.code,
    roll: rollOf(roll),
    flDistrict,
    flatCharges,
    city: res.components?.city ?? null,
    property: prop,
    listing: list,
    txSchoolDistrict: (() => {
      const isd = first.get("isd") ?? [];
      return isd.length === 1 && typeof isd[0].GEOID === "string" ? isd[0].GEOID : null;
    })(),
  };
  return { ok: true, facts };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/lookup") {
      if (request.method !== "GET") return json({ ok: false, reason: "bad_request" }, 405);
      const address = (url.searchParams.get("address") ?? "").trim();
      if (address.length < 5 || address.length > 200) return json({ ok: false, reason: "bad_request" }, 400);
      if (env.LOOKUP_LIMIT) {
        const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
        if (!(await env.LOOKUP_LIMIT.limit({ key: ip })).success) return json({ ok: false, reason: "busy" }, 429);
      }
      try {
        return json(await answer(env, address));
      } catch (e) {
        // the reason only, never the address
        console.error("lookup failed:", e instanceof Error ? e.message : "unknown");
        return json({ ok: false, reason: "unavailable" }, 502);
      }
    }
    if (url.pathname === "/api/estimate") {
      if (request.method !== "POST") return json({ ok: false }, 405);
      if (env.RECORD_LIMIT && !(await env.RECORD_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" })).success) return json({ ok: false, reason: "busy" }, 429);
      const text = await request.text();
      if (text.length > ESTIMATE_MAX_BYTES) return json({ ok: false, reason: "too_large" }, 413);
      let p: unknown;
      try {
        p = JSON.parse(text);
      } catch {
        return json({ ok: false, reason: "not_json" }, 400);
      }
      const problem = requestProblem(p, INPUT_KEYS);
      if (problem) return json({ ok: false, reason: problem }, 400);
      const r = p as EstimateRequest;
      const loaded = await placeOf(assetReader(env, url), r.zip, r.facts);
      if (!loaded.ok) return json({ ok: false, reason: loaded.reason }, 404);
      const { values, defaults, sources } = resolveAssumptions(loaded.place, r.changed);
      const result = calculate(loaded.place, values, r.setLines);
      if (r.record !== "no" && env.DB) {
        try {
          await env.DB.prepare(RECORD_SQL)
            .bind(...recordRow(r, values, result, loaded.place.zipData.st, loaded.place.zipData.county, NATIONAL.catalog_build))
            .run();
        } catch (e) {
          console.error("record failed:", e instanceof Error ? e.message : "unknown");
        }
      }
      const answer: EstimateAnswer = { ok: true, values, defaults, sources, result };
      return json(answer);
    }
    if (url.pathname === "/api/forget") {
      if (request.method !== "POST" || !env.DB) return json({ ok: false }, 405);
      let session: unknown;
      try {
        session = ((await request.json()) as { session?: unknown }).session;
      } catch {
        return json({ ok: false }, 400);
      }
      if (typeof session !== "string" || !/^[0-9a-f-]{36}$/.test(session)) return json({ ok: false }, 400);
      await env.DB.prepare("DELETE FROM inputs WHERE session = ?").bind(session).run();
      return json({ ok: true });
    }
    return env.ASSETS.fetch(request);
  },
};
