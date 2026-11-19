/**
 * Builds the calculator's default tables from published sources. Run once per data refresh:
 *
 *   QUERY_URL=https://api.runspatia.com/query QUERY_BEARER=… pnpm data [--stage <name>]
 *
 * Every stage caches its raw answers under `.cache/` (git-ignored), so a stage that fails (a token that expired after 15 minutes)
 * resumes where it stopped. The outputs are GENERATED; never edit them by hand:
 *
 *   public/data/zip/<zip3>.json        per ZIP: state, county, centroid, Treasury FIO's homeowners premium, the nearest degree-day station
 *   public/data/county/<ST>.json       per county: the area tax rate (ACS), NFIP's similar-home flood premiums, Florida's tax districts
 *   src/data/states.generated.json     per state: EIA's electricity and gas prices, the default heating fuel, California's voter rate
 *   src/data/national.generated.json   Freddie Mac's mortgage rates, NFIP's back-test ratios, the build and source notes
 *   src/data/fl-tax.generated.json     Florida's k × price back-test groups (trimmed from spatia-report's tax-backtest-fl.generated.json)
 *
 * Sources: Spatia's data service (`/query`, the spatia-data catalog), the U.S. Census Bureau's ZCTA files, and Freddie Mac's PMMS.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CACHE = join(ROOT, ".cache");
mkdirSync(CACHE, { recursive: true });

const QUERY_URL = (process.env.QUERY_URL ?? "https://api.runspatia.com/query").replace(/\/+$/, "");
const HOME_REPO = process.env.HOME_REPO ?? join(ROOT, "..", "spatia-report");

const STATE_FIPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA",
  "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA",
  "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY",
  "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX",
  "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "72": "PR",
};
const STATES = Object.values(STATE_FIPS).filter((s) => s !== "PR");

// ---------------------------------------------------------------------------------------------------------------------------
// The data service.

interface Rec { claim: Record<string, unknown> }
interface CheckResult { id: string; status: string; truncated?: boolean; error?: unknown; records?: Rec[] }

let catalogBuild = "";
async function catalog(): Promise<{ catalog_build: string; layers: { id: string; version: string; withheld?: { reason_code?: string } | null }[] }> {
  const f = join(CACHE, "catalog.json");
  if (!existsSync(f)) {
    const r = await fetch(`${QUERY_URL}/catalog`, { headers: auth() });
    if (!r.ok) throw new Error(`catalog: HTTP ${r.status}`);
    writeFileSync(f, await r.text());
  }
  const c = JSON.parse(readFileSync(f, "utf8"));
  catalogBuild = c.catalog_build;
  return c;
}
function auth(): Record<string, string> {
  const t = process.env.QUERY_BEARER;
  if (!t) throw new Error("QUERY_BEARER is not set (spatia-report's query-token skill mints one)");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json", Accept: "application/json", "X-Spatia-End-User": "cost-calculator-build" };
}
/** One check, at a subject point inside the layer's extent. Retries a transient failure. */
async function check(c: Record<string, unknown>, at: { lon: number; lat: number } = { lon: -82.46, lat: 27.95 }, withPilot = false): Promise<CheckResult> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(QUERY_URL, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ dsl_version: "0.4", mode: "lookup", catalog_build: catalogBuild, ...(withPilot ? { with_pilot: true } : {}), subject: { kind: "point", ...at }, checks: [{ id: "c", ...c }] }),
    });
    if (r.ok) {
      const res = ((await r.json()) as { checks: CheckResult[] }).checks[0];
      if (res.status !== "ok") throw new Error(`${String(c.layer)}: ${JSON.stringify(res.error)}`);
      return res;
    }
    const body = await r.text();
    if (r.status === 401) throw new Error("the token expired: mint a new one and run again (the cache keeps what is done)");
    if (attempt >= 4 || (r.status < 500 && r.status !== 429)) throw new Error(`${String(c.layer)}: HTTP ${r.status} ${body.slice(0, 300)}`);
    await new Promise((ok) => setTimeout(ok, 1000 * 2 ** attempt));
  }
}
const claims = (r: CheckResult) => (r.records ?? []).map((x) => x.claim).filter((x) => x.present !== false && Object.keys(x).length > 0);

/** Every row for the given keys, paged by `cursorCol` (500 rows a page). Cached per stage + batch. */
async function keyedAll(stage: string, layer: string, key: string, keys: string[], columns: string[], cursorCol: string, opts: { batch?: number; filter?: Record<string, unknown>; at?: { lon: number; lat: number }; withPilot?: boolean } = {}): Promise<Record<string, unknown>[]> {
  const batch = opts.batch ?? 400;
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < keys.length; i += batch) {
    const f = join(CACHE, `${stage}-${i}.json`);
    if (existsSync(f)) {
      out.push(...JSON.parse(readFileSync(f, "utf8")));
      continue;
    }
    const part: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    for (;;) {
      const filters: Record<string, unknown>[] = [];
      if (opts.filter) filters.push(opts.filter);
      if (cursor !== null) filters.push({ col: cursorCol, op: ">", value: cursor });
      const filter = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { all: filters };
      const res = await check({ layer, predicate: { op: "keyed", key, keys: keys.slice(i, i + batch) }, columns, order: [{ [cursorCol]: "asc" }], limit: 500, ...(filter ? { filter } : {}) }, opts.at, opts.withPilot);
      const rows = claims(res);
      part.push(...rows);
      if (rows.length < 500) break;
      cursor = String(rows[rows.length - 1][cursorCol]);
    }
    writeFileSync(f, JSON.stringify(part));
    out.push(...part);
    process.stdout.write(`\r${stage}: ${Math.min(i + batch, keys.length)}/${keys.length} keys, ${out.length} rows`);
  }
  process.stdout.write("\n");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Census files (public, no key).

async function download(url: string, name: string): Promise<string> {
  const f = join(CACHE, name);
  if (!existsSync(f)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return f;
}
function unzipText(zip: string): string {
  return execFileSync("unzip", ["-p", zip], { maxBuffer: 1 << 28 }).toString("utf8");
}
function tsv(text: string, sep: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(sep).map((h) => h.trim());
  return lines.slice(1).map((l) => Object.fromEntries(l.split(sep).map((v, i) => [head[i], v.trim()])));
}

interface ZipRow { zip: string; st: string; county: string; lat: number; lon: number }
async function zips(): Promise<ZipRow[]> {
  const gaz = unzipText(await download("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip", "gaz_zcta.zip"));
  const pos = new Map(tsv(gaz, "\t").map((r) => [r.GEOID, { lat: Number(r.INTPTLAT), lon: Number(r.INTPTLONG) }]));
  const rel = readFileSync(await download("https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt", "zcta_county.txt"), "utf8");
  // the county holding the largest share of the ZIP's land
  const best = new Map<string, { county: string; land: number }>();
  for (const r of tsv(rel, "|")) {
    const z = r.GEOID_ZCTA5_20;
    if (!z) continue;
    const land = Number(r.AREALAND_PART);
    const b = best.get(z);
    if (!b || land > b.land) best.set(z, { county: r.GEOID_COUNTY_20, land });
  }
  const out: ZipRow[] = [];
  for (const [zip, b] of best) {
    const p = pos.get(zip);
    const st = STATE_FIPS[b.county.slice(0, 2)];
    if (!p || !st || st === "PR") continue;
    out.push({ zip, st, county: b.county, lat: p.lat, lon: p.lon });
  }
  return out.sort((a, b) => a.zip.localeCompare(b.zip));
}

async function tracts(): Promise<string[]> {
  const gaz = unzipText(await download("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_tracts_national.zip", "gaz_tracts.zip"));
  return tsv(gaz, "\t").map((r) => r.GEOID).filter((g) => g && STATE_FIPS[g.slice(0, 2)] && g.slice(0, 2) !== "72");
}

// ---------------------------------------------------------------------------------------------------------------------------
// Helpers.

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
function weightedMedian(xs: { v: number; w: number }[]): number | null {
  const s = xs.filter((x) => x.w > 0 && Number.isFinite(x.v)).sort((a, b) => a.v - b.v);
  const total = s.reduce((t, x) => t + x.w, 0);
  if (!total) return null;
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= total / 2) return x.v;
  }
  return s[s.length - 1].v;
}
const haversineKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
function writeJson(path: string, v: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(v)}\n`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Stages.

async function main() {
  const cat = await catalog();
  const ver = (id: string) => cat.layers.find((l) => l.id === id)?.version ?? null;
  console.log(`catalog build ${catalogBuild}`);

  // 1. ZIPs, counties.
  const zipRows = await zips();
  const counties = [...new Set(zipRows.map((z) => z.county))].sort();
  console.log(`${zipRows.length} ZIPs in ${counties.length} counties`);

  // 2. Treasury FIO's homeowners premium per policy, the latest year each ZIP has.
  const fio = await keyedAll("fio", "fio_homeowners_insurance_zip", "ZIP", zipRows.map((z) => z.zip), ["ZIP", "year", "premium_per_policy_usd"], "ZIP", { batch: 90 });
  const fioBy = new Map<string, { usd: number; year: number }>();
  for (const r of fio) {
    const usd = num(r.premium_per_policy_usd);
    const year = num(r.year);
    if (usd === null || year === null || usd <= 0) continue;
    const b = fioBy.get(String(r.ZIP));
    if (!b || year > b.year) fioBy.set(String(r.ZIP), { usd: Math.round(usd), year });
  }

  // 3. NOAA's 1991–2020 degree-day normals: the nearest station with both normals.
  const dd = await keyedAll("normals", "noaa_normals_degree_days", "state", STATES, ["station_id", "station_name", "state", "lat", "lon", "htdd_normal_base65", "cldd_normal_base65"], "station_id", { batch: 60 });
  const stations = dd
    .map((r) => ({ id: String(r.station_id), name: String(r.station_name), lat: num(r.lat)!, lon: num(r.lon)!, hdd: num(r.htdd_normal_base65), cdd: num(r.cldd_normal_base65) }))
    .filter((s) => s.lat !== null && s.lon !== null && s.hdd !== null && s.cdd !== null);
  console.log(`${stations.length} degree-day stations`);
  const nearest = (p: { lat: number; lon: number }) => {
    let best = stations[0];
    let bestKm = Infinity;
    for (const s of stations) {
      if (Math.abs(s.lat - p.lat) > 3) continue;
      const km = haversineKm(p, s);
      if (km < bestKm) {
        best = s;
        bestKm = km;
      }
    }
    return { station: best.name, hdd: Math.round(best.hdd!), cdd: Math.round(best.cdd!), km: Math.round(bestKm) };
  };

  // 4. The ZIP files, by the first three digits.
  rmSync(join(ROOT, "public/data/zip"), { recursive: true, force: true });
  const byZip3 = new Map<string, Record<string, unknown>>();
  for (const z of zipRows) {
    const m = byZip3.get(z.zip.slice(0, 3)) ?? {};
    m[z.zip] = { st: z.st, county: z.county, lat: round(z.lat, 4), lon: round(z.lon, 4), hoi: fioBy.get(z.zip) ?? null, climate: nearest(z) };
    byZip3.set(z.zip.slice(0, 3), m);
  }
  for (const [k, m] of byZip3) writeJson(join(ROOT, "public/data/zip", `${k}.json`), m);

  // 5. The area tax rate: ACS 5-year owners' median real estate taxes ÷ median home value, per county, owner-weighted over tracts.
  const tractIds = await tracts();
  const acs = await keyedAll("acs", "acs_tract", "GEOID", tractIds, ["GEOID", "B25103_001E", "B25077_001E", "B25003_002E"], "GEOID", { batch: 450 });
  const areaRate = new Map<string, { tax: number; value: number; owners: number; tracts: number }>();
  for (const r of acs) {
    const tax = num(r.B25103_001E);
    const value = num(r.B25077_001E);
    const owners = num(r.B25003_002E);
    if (tax === null || value === null || owners === null || tax <= 0 || value <= 0 || owners <= 0) continue;
    const c = String(r.GEOID).slice(0, 5);
    const a = areaRate.get(c) ?? { tax: 0, value: 0, owners: 0, tracts: 0 };
    a.tax += tax * owners;
    a.value += value * owners;
    a.owners += owners;
    a.tracts += 1;
    areaRate.set(c, a);
  }

  // 6. NFIP's flood premiums of similar homes, per county, with the state's back-test.
  const nfip = await keyedAll("nfip", "nfip_premiums_similar_homes", "GEOID", counties, ["level", "GEOID", "zone_group", "primary_residence", "policies_n", "cost_p25_usd", "cost_p50_usd", "cost_p75_usd", "cost_status"], "GEOID", { batch: 70, filter: { col: "level", op: "=", value: "county" } });
  const nfipBy = new Map<string, Record<string, { p25: number; p50: number; p75: number; n: number }>>();
  for (const r of nfip) {
    if (r.cost_status !== "published") continue;
    const p50 = num(r.cost_p50_usd);
    if (p50 === null) continue;
    const m = nfipBy.get(String(r.GEOID)) ?? {};
    m[`${r.zone_group}:${r.primary_residence}`] = { p25: num(r.cost_p25_usd) ?? p50, p50, p75: num(r.cost_p75_usd) ?? p50, n: num(r.policies_n) ?? 0 };
    nfipBy.set(String(r.GEOID), m);
  }
  const nfipBt = await keyedAll("nfipbt", "nfip_premiums_similar_backtest", "state", STATES, ["state", "level", "primary_residence", "tested_n", "ratio_p10", "ratio_p50", "ratio_p90", "ratio_status"], "state", { batch: 60 });

  // 7. Florida's tax districts: the 2025 rates of every district on the 2026 roll, with its parcel count.
  const flCounties = counties.filter((c) => c.startsWith("12"));
  const fld = await keyedAll("fldistricts", "fl_tax_district_rates", "county_fips", flCounties, ["county_fips", "tax_auth_cd", "district_name", "total_millage", "school_millage", "nonschool_millage", "rate_status", "total_includes_other_base_levy", "on_2026_roll", "roll_parcels", "tax_year"], "tax_auth_cd", { batch: 1 });
  const flBy = new Map<string, { code: string; name: string; school: number; nonschool: number; parcels: number }[]>();
  const SETTLED = new Set(["printed", "printed_total_differs_from_components", "printed_total_leaves_out_a_printed_rate", "printed_total_short_of_dor_countywide_levies", "total_not_printed", "total_from_county_millage_chart"]);
  for (const r of fld) {
    const school = num(r.school_millage);
    const nonschool = num(r.nonschool_millage);
    const parcels = num(r.roll_parcels) ?? 0;
    if (r.on_2026_roll === false || r.total_includes_other_base_levy === true || !SETTLED.has(String(r.rate_status)) || school === null || nonschool === null || parcels <= 0) continue;
    const l = flBy.get(String(r.county_fips)) ?? [];
    l.push({ code: String(r.tax_auth_cd), name: String(r.district_name ?? r.tax_auth_cd), school: round(school, 4), nonschool: round(nonschool, 4), parcels });
    flBy.set(String(r.county_fips), l);
  }

  // 8. California's voter-approved rates: a sample of parcels in each county whose rate book is read.
  const caCounties = counties.filter((c) => c.startsWith("06"));
  const caVoter: number[] = [];
  const caByCounty = new Map<string, number>();
  for (const c of caCounties) {
    const f = join(CACHE, `ca-${c}.json`);
    let rows: Record<string, unknown>[];
    if (existsSync(f)) rows = JSON.parse(readFileSync(f, "utf8"));
    else {
      rows = claims(await check({ layer: "ca_parcel_tax_rate_area", predicate: { op: "keyed", key: "county_fips", keys: [c] }, columns: ["county_fips", "total_rate_pct", "voter_approved_rate_pct", "rate_status"], filter: { col: "voter_approved_rate_pct", op: ">=", value: 0 }, limit: 500 }, { lon: -119.4, lat: 36.8 }));
      writeFileSync(f, JSON.stringify(rows));
    }
    const v = rows.map((r) => num(r.voter_approved_rate_pct)).filter((x): x is number => x !== null);
    if (v.length >= 50) {
      const med = weightedMedian(v.map((x) => ({ v: x, w: 1 })))!;
      caByCounty.set(c, round(med, 4));
      caVoter.push(med);
    }
  }
  console.log(`California: voter-approved rates read in ${caByCounty.size} of ${caCounties.length} counties`);

  // 8b. Texas: the Comptroller's taxing units per county. Read only once spatia-data serves the layer stable: a PILOT layer is
  // never published here. TX_PILOT_PREVIEW=1 reads it with `with_pilot` for a LOCAL look only (the output must not be committed).
  const txLayer = cat.layers.find((l) => l.id === "tx_property_tax_rates");
  const txPreview = process.env.TX_PILOT_PREVIEW === "1";
  const txBy = new Map<string, { id: string; cls: string; name: string; rate: number; sd: string | null; value: number | null }[]>();
  if (txLayer && (!txLayer.withheld || txPreview)) {
    if (txLayer.withheld) console.warn("WARNING: TX_PILOT_PREVIEW=1 reads a withheld pilot layer. Do not commit public/data/county/TX.json.");
    const txCounties = counties.filter((c) => c.startsWith("48"));
    const rows = await keyedAll(txPreview ? "txpreview" : "tx", "tx_property_tax_rates", "GEOID", txCounties, ["GEOID", "unit_id", "unit_class", "unit_name", "total_rate", "school_district_geoid", "market_value", "taxable_value", "taxable_value_mo", "rates_reported"], "unit_id", { batch: 1, at: { lon: -97.74, lat: 30.27 }, withPilot: !!txLayer.withheld });
    const CLASSES = new Set(["county", "school_district", "city", "special_district"]);
    for (const r of rows) {
      const rate = num(r.total_rate);
      if (rate === null || rate < 0 || !CLASSES.has(String(r.unit_class)) || r.rates_reported === false) continue;
      const l = txBy.get(String(r.GEOID)) ?? [];
      if (l.some((u) => u.id === String(r.unit_id))) continue;
      l.push({ id: String(r.unit_id), cls: String(r.unit_class), name: String(r.unit_name).replace(/\*+$/, "").trim(), rate, sd: typeof r.school_district_geoid === "string" ? r.school_district_geoid : null, value: num(r.taxable_value) ?? num(r.taxable_value_mo) ?? num(r.market_value) });
      txBy.set(String(r.GEOID), l);
    }
    console.log(`Texas: taxing units in ${txBy.size} counties${txLayer.withheld ? " (PILOT PREVIEW)" : ""}`);
  } else console.log("Texas: tx_property_tax_rates is withheld (pilot); Texas uses the area rate");

  // 8c. The state's owner-weighted area rate, for a county with no tract figure (Connecticut: ACS tracts carry the 2022 planning
  // regions, the ZIP file the 2020 counties; a few small counties have no published tract figure).
  const stateRate = new Map<string, { tax: number; value: number; owners: number; tracts: number }>();
  for (const [c, a] of areaRate) {
    const st = STATE_FIPS[c.slice(0, 2)];
    const t = stateRate.get(st) ?? { tax: 0, value: 0, owners: 0, tracts: 0 };
    t.tax += a.tax;
    t.value += a.value;
    t.owners += a.owners;
    t.tracts += a.tracts;
    stateRate.set(st, t);
  }

  // 9. The county files, by state. A ZIP Treasury does not publish takes the median of the county's published ZIPs (their latest year).
  const hoiCounty = new Map<string, { usd: number; year: number; zips: number }>();
  for (const c of counties) {
    const got = zipRows.filter((z) => z.county === c).map((z) => fioBy.get(z.zip)).filter((x): x is { usd: number; year: number } => !!x);
    if (got.length < 1) continue;
    const med = weightedMedian(got.map((x) => ({ v: x.usd, w: 1 })))!;
    hoiCounty.set(c, { usd: Math.round(med), year: Math.max(...got.map((x) => x.year)), zips: got.length });
  }
  rmSync(join(ROOT, "public/data/county"), { recursive: true, force: true });
  const byState = new Map<string, Record<string, unknown>>();
  for (const c of counties) {
    const st = STATE_FIPS[c.slice(0, 2)];
    const own = areaRate.get(c);
    const a = own ?? stateRate.get(STATE_FIPS[c.slice(0, 2)]);
    const areaScope = own ? "county" : "state";
    const districts = flBy.get(c);
    let flDefault: string | null = null;
    if (districts?.length) {
      const med = weightedMedian(districts.map((d) => ({ v: d.school + d.nonschool, w: d.parcels })));
      flDefault = districts.find((d) => d.school + d.nonschool === med)?.code ?? null;
    }
    const m = byState.get(st) ?? {};
    m[c] = {
      // median_value: the owner-weighted mean of the tracts' median home values (a typical price, the calculator's default)
      area_tax: a && a.tracts >= 1 ? { rate_pct: round((a.tax / a.value) * 100, 3), tracts: a.tracts, owners: Math.round(a.owners), median_value: Math.round(a.value / a.owners / 1000) * 1000, scope: areaScope } : null,
      flood: nfipBy.get(c) ?? null,
      fl_districts: districts ? districts.sort((x, y) => y.parcels - x.parcels) : undefined,
      fl_default_district: flDefault ?? undefined,
      ca_voter_pct: caByCounty.get(c),
      hoi_county: hoiCounty.get(c),
      tx_units: txBy.get(c)?.sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name)),
    };
    byState.set(st, m);
  }
  for (const [st, m] of byState) writeJson(join(ROOT, "public/data/county", `${st}.json`), m);

  // 10. The states: EIA's prices and the default heating fuel.
  const elec = await keyedAll("eia861", "eia_861_residential", "state", STATES, ["row_kind", "state", "residential_avg_price_usd_per_kwh", "residential_customers", "data_year"], "state", { batch: 60, filter: { col: "row_kind", op: "=", value: "state_total" } });
  // one batch per state: the paging column must be unique within a page, and a state holds one row a year
  const gas = await keyedAll("eiagas1", "eia_ng_residential_price_state", "state", STATES, ["state", "year", "residential_price_usd_per_mcf", "residential_consumers"], "year", { batch: 1 });
  const states: Record<string, unknown> = {};
  for (const st of STATES) {
    const e = elec.find((r) => r.state === st);
    const rows = gas.filter((r) => r.state === st).sort((a, b) => num(b.year)! - num(a.year)!);
    const g = rows.find((r) => num(r.residential_price_usd_per_mcf) !== null);
    const elecCustomers = num(e?.residential_customers);
    const gasConsumers = num(rows.find((r) => num(r.residential_consumers) !== null)?.residential_consumers);
    states[st] = {
      electricity_usd_per_kwh: num(e?.residential_avg_price_usd_per_kwh) !== null ? round(num(e?.residential_avg_price_usd_per_kwh)!, 4) : null,
      electricity_year: num(e?.data_year),
      gas_usd_per_mcf: g ? num(g.residential_price_usd_per_mcf) : null,
      gas_year: g ? num(g.year) : null,
      // gas heat is the default where at least half as many homes buy gas as buy electricity (EIA's two customer counts)
      gas_share: elecCustomers && gasConsumers ? round(gasConsumers / elecCustomers, 3) : null,
    };
  }
  writeJson(join(ROOT, "src/data/states.generated.json"), states);

  // 11. National: Freddie Mac's PMMS, NFIP's back-test, the versions.
  const pmms = readFileSync(await download("https://www.freddiemac.com/pmms/docs/PMMS_history.csv", "pmms.csv"), "utf8").trim().split(/\r?\n/);
  const last = pmms[pmms.length - 1].split(",");
  const [mm, dd2, yy] = last[0].split("/");
  writeJson(join(ROOT, "src/data/national.generated.json"), {
    generated: new Date().toISOString().slice(0, 10),
    catalog_build: catalogBuild,
    mortgage: { week_of: `${yy}-${mm.padStart(2, "0")}-${dd2.padStart(2, "0")}`, rate30_pct: Number(last[1]), rate15_pct: Number(last[3]), source: "Freddie Mac Primary Mortgage Market Survey" },
    nfip_backtest: nfipBt
      .filter((r) => r.ratio_status === "published")
      .map((r) => ({ state: r.state, level: r.level, primary: r.primary_residence, n: num(r.tested_n), p10: num(r.ratio_p10), p50: num(r.ratio_p50), p90: num(r.ratio_p90) })),
    ca_voter_pct_median: caVoter.length ? round(weightedMedian(caVoter.map((v) => ({ v, w: 1 })))!, 4) : null,
    versions: Object.fromEntries(
      ["fio_homeowners_insurance_zip", "noaa_normals_degree_days", "acs_tract", "nfip_premiums_similar_homes", "nfip_premiums_similar_backtest", "fl_tax_district_rates", "ca_parcel_tax_rate_area", "eia_861_residential", "eia_ng_residential_price_state"].map((id) => [id, ver(id)]),
    ),
  });

  // 12. Florida's back-test, trimmed to what the calculator reads.
  const fl = JSON.parse(readFileSync(join(HOME_REPO, "app/lib/home/tax-backtest-fl.generated.json"), "utf8"));
  const homeCommit = execFileSync("git", ["-C", HOME_REPO, "rev-parse", "--short", "HEAD"]).toString().trim();
  writeJson(join(ROOT, "src/data/fl-tax.generated.json"), {
    source: `spatia-report app/lib/home/tax-backtest-fl.generated.json at ${homeCommit} (generated ${fl.generated})`,
    truth: fl.truth,
    bars: fl.bars,
    homestead: fl.homestead,
    k_by_county_type: fl.k_by_county_type,
    counties: fl.counties.map((c: { county: string; rate_ok: boolean; sample: string; groups: { match: { type: string; value_band: string[]; input: string }; cases: Record<string, Record<string, unknown>> }[] }) => ({
      county: c.county,
      rate_ok: c.rate_ok,
      sample: c.sample,
      groups: c.groups
        .filter((g) => g.match.input === "k_times_price" && g.match.type !== "new_construction")
        .map((g) => ({
          type: g.match.type,
          bands: g.match.value_band,
          cases: Object.fromEntries(
            Object.entries(g.cases).map(([k, s]) => [k, { n: s.n ?? null, p10: s.ratio_p10 ?? null, p90: s.ratio_p90 ?? null, median_abs_error: s.median_abs_error ?? null, passed: !!s.bars && Object.values(s.bars as Record<string, boolean>).every(Boolean) }]),
          ),
        })),
    })),
  });
  console.log("done");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
