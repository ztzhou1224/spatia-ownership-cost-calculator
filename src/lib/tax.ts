/**
 * The new owner's property tax. Two parts (the study, docs/study.md):
 *
 *   1. the taxable value after the sale: California's purchase price (Prop 13); Florida's k × the price, k the county's measured
 *      ratio of the first just value after a sale to the sale price; elsewhere the price itself at the area's effective rate;
 *   2. the rate: read from the published rate files (Florida's districts, California's 1 % levy and the voter-approved rates), else
 *      the area's effective rate (ACS: what owners pay ÷ what they say the home is worth).
 *
 * Exemptions are case by case: the calculator applies Florida's homestead exemptions when the buyer will live in the home. A range
 * is shown only where a back-test measured one (Florida's k × price groups that passed every bar).
 */
import flTax from "../data/fl-tax.generated.json";
import type { CountyData, FlDistrict } from "./types";

export type HomeType = "house" | "townhouse" | "condo" | "mobile";

export interface TaxInputs {
  st: string;
  county: string;
  price: number;
  homeType: HomeType;
  liveInHome: boolean;
  /** Florida: the district's tax authority code (default: the county's typical district). */
  flDistrict?: string | null;
  /** A rate the user typed, in percent of the price a year; replaces the default rate. */
  ratePct?: number | null;
}

export interface TaxEstimate {
  yearly: number;
  low: number | null;
  high: number | null;
  /** The rate behind the figure, as a percent of the price (an effective rate). */
  effectivePct: number;
  method: string;
  source: string;
  notes: string[];
}

interface FlCase {
  n: number | null;
  p10: number | null;
  p90: number | null;
  median_abs_error: number | null;
  passed: boolean;
}
interface FlFile {
  homestead: { FL_HOMESTEAD_USD: number; FL_ADDITIONAL_HOMESTEAD_USD_2026: number; FL_ADDITIONAL_FROM_USD: number };
  k_by_county_type: Record<string, number>;
  counties: { county: string; rate_ok: boolean; sample: string; groups: { type: string; bands: string[]; cases: Record<string, FlCase> }[] }[];
}
const FL = flTax as unknown as FlFile;

const FL_BANDS = [
  { low: 0, high: 250_000, name: "lt250k" },
  { low: 250_000, high: 500_000, name: "250k_500k" },
  { low: 500_000, high: 1_000_000, name: "500k_1m" },
  { low: 1_000_000, high: Infinity, name: "gt1m" },
];
const flBand = (v: number) => FL_BANDS.find((b) => v >= b.low && v < b.high)!.name;
/** Florida's DOR use code for the home type: 001 single family (a townhouse is usually on its own lot), 004 condominium. */
const FL_DOR: Partial<Record<HomeType, "001" | "004">> = { house: "001", townhouse: "001", condo: "004" };

/** California's general levy (Constitution art. XIII A, § 1(a)): 1 % of the assessed value, which a sale resets to the price. */
export const CA_BASE_PCT = 1;

export function flDistrictOf(c: CountyData | null, code?: string | null): FlDistrict | null {
  const list = c?.fl_districts ?? [];
  return list.find((d) => d.code === code) ?? list.find((d) => d.code === c?.fl_default_district) ?? list[0] ?? null;
}

/** Florida: k × price, then each levy's mills, less the homestead exemptions when the buyer lives in the home. */
export function floridaTax(x: TaxInputs, c: CountyData | null): TaxEstimate | null {
  const type = FL_DOR[x.homeType];
  const d = flDistrictOf(c, x.flDistrict);
  if (!type || !d) return null;
  const k = FL.k_by_county_type[`${x.county}:${type}`];
  if (typeof k !== "number") return null;
  const value = k * x.price;
  const h = FL.homestead;
  let yearly: number;
  if (x.liveInHome) {
    const off = h.FL_HOMESTEAD_USD + Math.min(Math.max(value - h.FL_ADDITIONAL_FROM_USD, 0), h.FL_ADDITIONAL_HOMESTEAD_USD_2026);
    yearly = (Math.max(value - h.FL_HOMESTEAD_USD, 0) * d.school) / 1000 + (Math.max(value - off, 0) * d.nonschool) / 1000;
  } else {
    yearly = (value * (d.school + d.nonschool)) / 1000;
  }
  const caseKey = x.liveInHome ? "owner_occupied" : "not_owner_occupied";
  const county = FL.counties.find((cc) => cc.county === x.county);
  const group = county?.groups.find((g) => g.type === type && g.bands.includes(flBand(value)) && g.cases[caseKey]);
  const s = group?.cases[caseKey];
  const tested = !!(county?.rate_ok && s?.passed && s.p10 !== null && s.p90 !== null);
  const notes = [
    `Florida resets the value at the sale: the first bill after it uses the property appraiser's just value, about ${Math.round(k * 100)} % of the price in this county for this type of home (measured on 2025 sales).`,
    `District ${d.name}: ${(d.school + d.nonschool).toFixed(4)} mills (2025 rates). Choose your district if you know it: rates differ by city.`,
    x.liveInHome
      ? "Includes the homestead exemptions ($25,000 off every levy, and up to $26,411 more off the non-school levies). File for homestead by March 1 after you buy."
      : "No exemption: the figure for a home you will not live in.",
    "Florida's Amendment 3 (2026) raises the homestead exemption from 2027 only for owners who were residents on December 31, 2026; it is not in this figure.",
    "Flat charges on the bill (waste, special districts) are not in this figure.",
  ];
  if (tested) notes.push(`Tested on ${s!.n} recent sales in this county against the buyers' first taxable values: 8 in 10 bills fall in the range.`);
  else notes.push("Not tested for this county, type and price band: no range is shown.");
  return {
    yearly,
    low: tested ? yearly * s!.p10! : null,
    high: tested ? yearly * s!.p90! : null,
    effectivePct: (yearly / x.price) * 100,
    method: "k × price × district mills, less exemptions",
    source: "Florida DOR rolls and district rates (2025), Spatia's back-test",
    notes,
  };
}

export function californiaTax(x: TaxInputs, c: CountyData | null, stateVoterPct: number | null): TaxEstimate {
  const voter = c?.ca_voter_pct ?? stateVoterPct ?? 0;
  const pct = CA_BASE_PCT + voter;
  const yearly = (x.price * pct) / 100;
  return {
    yearly,
    low: null,
    high: null,
    effectivePct: pct,
    method: "price × (1 % + voter-approved rates)",
    source: c?.ca_voter_pct !== undefined ? "California Constitution art. XIII A; the county's tax rate book (typical rate area)" : "California Constitution art. XIII A; the state's typical voter-approved rate",
    notes: [
      "California resets the assessed value to the purchase price at the sale (Prop 13), so the 1 % levy is exact.",
      `The voter-approved rates here are ${c?.ca_voter_pct !== undefined ? "the county's typical rate area" : "a typical figure from the counties whose rate books are read"} (${voter.toFixed(3)} %). Your tax rate area's own rate is on the county's rate book.`,
      x.liveInHome ? "The homeowners' exemption takes $7,000 off the value (about $70 a year) when you live in the home; it is not taken off here." : "No exemption.",
      "A supplemental bill covers the months between the sale and the next roll. Mello-Roos and other special assessments are not in this figure.",
    ],
  };
}

export function areaRateTax(x: TaxInputs, c: CountyData | null): TaxEstimate | null {
  if (!c?.area_tax) return null;
  const pct = c.area_tax.rate_pct;
  return {
    yearly: (x.price * pct) / 100,
    low: null,
    high: null,
    effectivePct: pct,
    method: "price × the area's effective rate",
    source: "Census ACS 5-year: owners' median real estate taxes ÷ median home value, in the county",
    notes: [
      "The area's effective rate: what owners in the county pay, divided by what they say their home is worth.",
      "In a state that caps the taxed value until a sale, a new owner usually pays more than this rate.",
      "Exemptions and flat charges are not modelled for this state. Check the county's tax estimator or the seller's bill.",
    ],
  };
}

/** The tax a new owner pays a year, by the best method this place has. A typed rate replaces the default rate. */
export function propertyTax(x: TaxInputs, c: CountyData | null, stateVoterPct: number | null): TaxEstimate | null {
  if (!(x.price > 0)) return null;
  if (typeof x.ratePct === "number" && x.ratePct >= 0) {
    return { yearly: (x.price * x.ratePct) / 100, low: null, high: null, effectivePct: x.ratePct, method: "price × your rate", source: "Your rate", notes: ["You set the rate."] };
  }
  if (x.st === "FL") {
    const fl = floridaTax(x, c);
    if (fl) return fl;
  }
  if (x.st === "CA") return californiaTax(x, c, stateVoterPct);
  return areaRateTax(x, c);
}
