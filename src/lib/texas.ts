/**
 * Texas: the Comptroller's 2025 rates per taxing unit (spatia-data `tx_property_tax_rates`), dollars per $100 of taxable value.
 *
 * The layer's own rule (its notes): a county's rows list EVERY unit with territory in the county, not the units that tax one home,
 * so the rows are never summed over a county. The COUNTY row applies countywide; a school district (ISD) row applies where its
 * school-district polygon covers the home; a city or special district (MUD, ESD, …) cannot be placed from the table. So the
 * calculator's default is the county row and the school district at the address (or, with no address, the county's largest), and
 * the user ticks the city and special districts on the bill. The sum is over the units the user's home pays, not over the county.
 */
import type { TaxEstimate, TaxInputs } from "./tax";

export interface TxUnit {
  id: string;
  cls: "county" | "school_district" | "city" | "special_district";
  name: string;
  /** Dollars per $100 of taxable value. */
  rate: number;
  /** An ISD's school-district GEOID (TIGER), to match the polygon at the address. */
  sd?: string | null;
  /** The unit's value in the county (the largest ISD is the default without an address). */
  value?: number | null;
}

/**
 * Texas's general residence homestead exemption from school district taxes (Tax Code § 11.13(b)): $140,000 from tax year 2025
 * (Senate Bill 4, approved by the voters on November 4, 2025). Counties and cities may give their own percentage exemption; that is
 * not in the table, so it is not applied.
 */
export const TX_SCHOOL_HOMESTEAD_USD = 140_000;

/**
 * The default units: every county row; one school district (the address's, else the county's largest by value); and, with an
 * address, the city whose name is the geocoder's postal city (exactly one unit of that name). The postal city is an ASSUMPTION
 * the page says: a postal city can lie outside the city limits, and the table has no city boundary.
 */
export function txDefaultUnits(units: TxUnit[], sdAtAddress: string | null, postalCity: string | null = null): { ids: string[]; schoolFromAddress: boolean; cityFromAddress: boolean } {
  const ids = units.filter((u) => u.cls === "county").map((u) => u.id);
  const isds = units.filter((u) => u.cls === "school_district");
  const atAddress = sdAtAddress ? isds.filter((u) => u.sd === sdAtAddress) : [];
  const school = atAddress.length === 1 ? atAddress[0] : [...isds].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  if (school) ids.push(school.id);
  const key = (s: string) => s.toLowerCase().replace(/^city of\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const cities = postalCity ? units.filter((u) => u.cls === "city" && key(u.name) === key(postalCity)) : [];
  if (cities.length === 1) ids.push(cities[0].id);
  return { ids, schoolFromAddress: atAddress.length === 1, cityFromAddress: cities.length === 1 };
}

export function texasTax(x: TaxInputs, units: TxUnit[], chosen: string[]): TaxEstimate | null {
  const picked = units.filter((u) => chosen.includes(u.id));
  if (!picked.length) return null;
  const value = x.price; // the appraisal district values a home at its market value on January 1
  let yearly = 0;
  for (const u of picked) {
    const taxable = u.cls === "school_district" && x.liveInHome ? Math.max(value - TX_SCHOOL_HOMESTEAD_USD, 0) : value;
    yearly += (taxable * u.rate) / 100;
  }
  const total = picked.reduce((s, u) => s + u.rate, 0);
  const hasCity = picked.some((u) => u.cls === "city");
  return {
    yearly,
    low: null,
    high: null,
    effectivePct: (yearly / x.price) * 100,
    method: "price × each taxing unit's rate, less the school homestead exemption",
    source: "Texas Comptroller, 2025 tax rates by taxing unit (preliminary)",
    notes: [
      `Units: ${picked.map((u) => `${u.name} (${u.rate.toFixed(4)})`).join(", ")}: $${total.toFixed(4)} per $100 of value before exemptions.`,
      "The appraisal district values the home at its market value on January 1; the calculator uses your price. Texas does not publish sale prices, so this is not tested.",
      x.liveInHome
        ? "Includes the $140,000 school homestead exemption. A county or city may give its own exemption too; it is not in this figure. File for homestead with the appraisal district."
        : "No exemption: the figure for a home you will not live in.",
      hasCity ? "Check that the home is inside the city limits: a postal city name can lie outside them." : "No city tax is included. Add your city if the home is inside city limits.",
      "Special districts (MUD, ESD, water, hospital) are on many Texas bills. Tick the ones on your bill: the table cannot place them at an address.",
    ],
  };
}
