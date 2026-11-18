/**
 * RentCast's property record (`GET https://api.rentcast.io/v1/properties?address=…`; owner direction 2026-11-18, "Use rentcast
 * property info for better estimation"). Read by the Worker for a trusted address only, parsed here through an ALLOWLIST: the
 * home's facts, the HOA fee, the latest tax bill and the last sale. Every owner field, the zoning, the APN, the subdivision and the
 * legal description are dropped unread (Spatia Home's rules: `rentcast.ts` RENTCAST_FORBIDDEN_KEYS, owner rulings R-a / H-S3).
 * The facts are shown as RentCast's; nothing here is a value of the home.
 */
import type { HomeType } from "./tax";

export const RENTCAST_PROPERTIES_URL = "https://api.rentcast.io/v1/properties";
/** Sale listings (owner direction 2026-11-18, "Use asking price from rentcast"): this address's ACTIVE listing only. */
export const RENTCAST_LISTINGS_URL = "https://api.rentcast.io/v1/listings/sale";

export interface PropertyFacts {
  formattedAddress: string;
  propertyType: string | null;
  homeType: HomeType | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFootage: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  heatingType: string | null;
  /** RentCast's `cooling` flag and `coolingType`. */
  cooling: boolean | null;
  coolingType: string | null;
  pool: boolean | null;
  /** `hoa.fee`: the total monthly HOA fee or assessment. */
  hoaFee: number | null;
  /** The latest year's tax bill on record (the current owner's, with the current owner's exemptions). */
  lastTax: { year: number; total: number } | null;
  lastSale: { date: string; price: number } | null;
}

/** RentCast's property types as the calculator's home types; Multi-Family, Apartment and Land have none. */
export const RENTCAST_HOME_TYPE: Readonly<Record<string, HomeType>> = {
  "Single Family": "house",
  Townhouse: "townhouse",
  Condo: "condo",
  Manufactured: "mobile",
};

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const pos = (x: unknown): number | null => {
  const n = num(x);
  return n !== null && n > 0 ? n : null;
};
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const bool = (x: unknown): boolean | null => (typeof x === "boolean" ? x : null);

/** The latest year of a RentCast `{ "<year>": { year, … } }` map whose field is a positive number. */
function latest(m: unknown, field: "total"): { year: number; total: number } | null {
  if (!isObj(m)) return null;
  let best: { year: number; total: number } | null = null;
  for (const v of Object.values(m)) {
    if (!isObj(v)) continue;
    const year = num(v.year);
    const total = pos(v[field]);
    if (year !== null && total !== null && (!best || year > best.year)) best = { year, total };
  }
  return best;
}

/** One record, allowlisted. */
export function parseProperty(r: unknown): PropertyFacts | null {
  if (!isObj(r)) return null;
  const formattedAddress = str(r.formattedAddress);
  if (!formattedAddress) return null;
  const f = isObj(r.features) ? r.features : {};
  const hoa = isObj(r.hoa) ? r.hoa : {};
  const propertyType = str(r.propertyType);
  const year = num(r.yearBuilt);
  const saleDate = str(r.lastSaleDate);
  const salePrice = pos(r.lastSalePrice);
  return {
    formattedAddress,
    propertyType,
    homeType: propertyType ? RENTCAST_HOME_TYPE[propertyType] ?? null : null,
    bedrooms: num(r.bedrooms),
    bathrooms: num(r.bathrooms),
    squareFootage: pos(r.squareFootage),
    lotSize: pos(r.lotSize),
    yearBuilt: year !== null && year > 1700 ? year : null,
    heatingType: str(f.heatingType),
    cooling: bool(f.cooling),
    coolingType: str(f.coolingType),
    pool: bool(f.pool),
    hoaFee: pos(hoa.fee),
    lastTax: latest(r.propertyTaxes, "total"),
    lastSale: saleDate && salePrice ? { date: saleDate.slice(0, 10), price: salePrice } : null,
  };
}

/** The street line and ZIP of an address, for the match: lower case, letters and digits only. */
function key(address: string): { street: string; zip: string | null } {
  // "<street>[, <unit>], <city>, <ST> <ZIP>": everything before the city is the street line, the unit included
  const parts = address.split(",").map((p) => p.trim());
  const zip = address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
  const street = parts.length > 2 ? parts.slice(0, -2).join(" ") : (parts[0] ?? "");
  return { street: street.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), zip };
}

/**
 * The record for the geocoded address: exactly one record whose street line and ZIP equal the geocoder's label. A unit is in
 * the street line of both (the geocoder's label and RentCast's formattedAddress), so a building's other units do not match.
 */
export function matchProperty(body: unknown, label: string): PropertyFacts | null {
  const recs = (Array.isArray(body) ? body : [body]).map(parseProperty).filter((x): x is PropertyFacts => x !== null);
  const want = key(label);
  const hits = recs.filter((r) => {
    const k = key(r.formattedAddress);
    return k.street === want.street && (!want.zip || k.zip === want.zip);
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The home's active sale listing, allowlisted: the asking price, when it was listed, the days on the market and the HOA fee the
 * listing states. Never the listing agent, the office, the MLS name or number, or the builder.
 */
export interface ListingFacts {
  formattedAddress: string;
  price: number;
  listedDate: string | null;
  daysOnMarket: number | null;
  hoaFee: number | null;
}

export function parseListing(r: unknown): ListingFacts | null {
  if (!isObj(r) || r.status !== "Active") return null;
  const formattedAddress = str(r.formattedAddress);
  const price = pos(r.price);
  if (!formattedAddress || price === null) return null;
  const hoa = isObj(r.hoa) ? r.hoa : {};
  const listed = str(r.listedDate);
  return { formattedAddress, price, listedDate: listed ? listed.slice(0, 10) : null, daysOnMarket: num(r.daysOnMarket), hoaFee: pos(hoa.fee) };
}

/** The address's one active listing (the same street-line and ZIP match as the property record). */
export function matchListing(body: unknown, label: string): ListingFacts | null {
  const recs = (Array.isArray(body) ? body : [body]).map(parseListing).filter((x): x is ListingFacts => x !== null);
  const want = key(label);
  const hits = recs.filter((r) => {
    const k = key(r.formattedAddress);
    return k.street === want.street && (!want.zip || k.zip === want.zip);
  });
  return hits.length === 1 ? hits[0] : null;
}
