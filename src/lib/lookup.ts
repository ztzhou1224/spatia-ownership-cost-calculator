/**
 * The address lookup's shape and its pure parts, shared by the Worker (`workers/app.ts`) and the page. The Worker asks Spatia's
 * geocoder (`/geocode`), then the data service (`/query`) at the point; only a trusted (rooftop-grade) point is answered.
 */
import type { PropertyFacts } from "./rentcast";
import type { HomeType } from "./tax";

export interface AddressFacts {
  /** The geocoder's label of the address. */
  label: string;
  zip: string;
  st: string;
  /** The county FIPS when the data service gives one (Florida's roll), else null (the ZIP's county is used). */
  county: string | null;
  /** FEMA's flood zone at the point: `sfha` (A or V), `outside`, or null when FEMA's map does not answer. */
  floodZone: "sfha" | "outside" | null;
  floodZoneCode: string | null;
  /** Florida's county roll (FDOR), the parcel at the point. */
  roll: {
    homeType: HomeType | null;
    useLabel: string | null;
    yearBuilt: number | null;
    livingSqft: number | null;
    units: number | null;
    justValue: number | null;
    rollYear: number;
  } | null;
  /** Florida's tax district of the parcel (2026 roll code). */
  flDistrict: string | null;
  /**
   * Florida: the parcel's non-ad-valorem assessments on the county tax roll (spatia-data `fl_parcel_tax_district`
   * `nav_total_usd`, tax year 2025): waste, fire, drainage, lighting, community development districts and the like. `amount` is
   * null when the county's file has no row for the parcel (unknown, never zero).
   */
  flatCharges?: { amount: number | null; year: number | null; count: number | null; status: string } | null;
  /** Texas: the unified school district covering the point (TIGER GEOID). */
  txSchoolDistrict?: string | null;
  /** The geocoder's city: the POSTAL city, which can lie outside the city limits. */
  city?: string | null;
  /** RentCast's property record for the address (allowlisted), when one record matches it. */
  property?: PropertyFacts | null;
}

export type LookupAnswer = { ok: true; facts: AddressFacts } | { ok: false; reason: "not_found" | "not_trusted" | "unavailable" | "bad_request" | "busy" };

/** Florida's DOR use codes the calculator maps to a home type; any other use is no type. */
export const FL_DOR_TYPE: Readonly<Record<string, HomeType>> = { "001": "house", "002": "mobile", "004": "condo", "005": "condo" };

/** FEMA's Special Flood Hazard Area flag (`sfha_tf`): `T` inside, `F` outside. */
export function floodZoneOf(rows: { fld_zone?: unknown; sfha_tf?: unknown }[]): { zone: "sfha" | "outside" | null; code: string | null } {
  if (!rows.length) return { zone: null, code: null };
  const inside = rows.find((r) => r.sfha_tf === "T");
  if (inside) return { zone: "sfha", code: typeof inside.fld_zone === "string" ? inside.fld_zone : null };
  if (rows.every((r) => r.sfha_tf === "F")) return { zone: "outside", code: typeof rows[0].fld_zone === "string" ? rows[0].fld_zone : null };
  return { zone: null, code: null };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function rollOf(r: Record<string, unknown> | null): AddressFacts["roll"] {
  if (!r) return null;
  const dor = typeof r.dor_uc === "string" ? r.dor_uc : null;
  const living = num(r.tot_lvg_ar);
  const year = num(r.act_yr_blt);
  return {
    homeType: dor ? FL_DOR_TYPE[dor] ?? null : null,
    useLabel: typeof r.dor_uc_label === "string" ? r.dor_uc_label : dor,
    yearBuilt: year && year > 1700 ? year : null,
    livingSqft: living && living > 0 ? living : null,
    units: num(r.no_res_unt),
    justValue: num(r.jv),
    rollYear: num(r.asmnt_yr) ?? 2025,
  };
}
