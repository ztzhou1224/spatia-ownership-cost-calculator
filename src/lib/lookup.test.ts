import { describe, expect, it } from "vitest";
import { calculate, resolveAssumptions } from "./calc";
import { floodZoneOf, rollOf, type AddressFacts } from "./lookup";
import type { Place } from "./types";

describe("the address lookup", () => {
  it("reads FEMA's SFHA flag: inside if any covering row is inside", () => {
    expect(floodZoneOf([])).toEqual({ zone: null, code: null });
    expect(floodZoneOf([{ fld_zone: "X", sfha_tf: "F" }])).toEqual({ zone: "outside", code: "X" });
    expect(floodZoneOf([{ fld_zone: "X", sfha_tf: "F" }, { fld_zone: "AE", sfha_tf: "T" }])).toEqual({ zone: "sfha", code: "AE" });
    expect(floodZoneOf([{ fld_zone: "D", sfha_tf: null }])).toEqual({ zone: null, code: null });
  });
  it("maps the roll's DOR use to a home type, never a multi-family code", () => {
    expect(rollOf({ dor_uc: "001", act_yr_blt: 1957, tot_lvg_ar: 1109 })!.homeType).toBe("house");
    expect(rollOf({ dor_uc: "004" })!.homeType).toBe("condo");
    expect(rollOf({ dor_uc: "008" })!.homeType).toBeNull();
    expect(rollOf({ dor_uc: "001", act_yr_blt: 0, tot_lvg_ar: 0 })).toMatchObject({ yearBuilt: null, livingSqft: null });
    expect(rollOf(null)).toBeNull();
  });
});

const facts: AddressFacts = {
  label: "3005 W Concord St, Orlando, FL 32805",
  zip: "32805",
  st: "FL",
  county: "12095",
  floodZone: "sfha",
  floodZoneCode: "AE",
  roll: { homeType: "house", useLabel: "DOR 001 — Single Family", yearBuilt: 1957, livingSqft: 1109, units: 1, justValue: 156830, rollYear: 2025 },
  flDistrict: "ORL26",
};
const place: Place = {
  zip: "32805",
  zipData: { st: "FL", county: "12095", lat: 28.53, lon: -81.41, hoi: null, climate: { station: "ORLANDO INTL AP", hdd: 500, cdd: 3600, km: 10 } },
  county: {
    area_tax: { rate_pct: 0.9, tracts: 10, owners: 100, median_value: 350000 },
    flood: null,
    fl_districts: [
      { code: "ORL26", name: "ORLANDO", school: 5.3, nonschool: 12.8, parcels: 5000 },
      { code: "UNI", name: "UNINCORPORATED", school: 5.3, nonschool: 10.0, parcels: 90000 },
    ],
    fl_default_district: "UNI",
  },
  state: null,
  facts,
};

describe("defaults from an address", () => {
  it("the record's facts become the defaults, with their source", () => {
    const { values, sources } = resolveAssumptions(place, {});
    expect(values).toMatchObject({ floodZone: "sfha", buyFlood: true, flDistrict: "ORL26", homeType: "house", sqft: 1109, yearBuilt: 1957 });
    expect(sources.floodZone).toContain("zone AE");
    expect(sources.flDistrict).toContain("county roll");
    expect(sources.sqft).toContain("roll");
  });
  it("Florida's flat charges on the tax roll are their own line, never inside the property tax", () => {
    const withNav = { ...place, facts: { ...facts, flatCharges: { amount: 284.77, year: 2025, count: 2, status: "matched" } } };
    const { values, sources } = resolveAssumptions(withNav, {});
    expect(values.flatChargesYearly).toBe(284.77);
    expect(sources.flatChargesYearly).toContain("non-ad-valorem");
    const r = calculate(withNav, values);
    expect(r.lines.find((l) => l.key === "flat_charges")!.yearly).toBe(284.77);
    const noRow = { ...place, facts: { ...facts, flatCharges: { amount: null, year: 2025, count: null, status: "no_row_in_county_nav_file" } } };
    expect(resolveAssumptions(noRow, {}).values.flatChargesYearly).toBe(0);
    expect(resolveAssumptions(noRow, {}).sources.flatChargesYearly).toContain("Not known");
  });
  it("a changed type takes the type's typical size, not the roll's", () => {
    expect(resolveAssumptions(place, { homeType: "condo" }).values.sqft).toBe(1100);
  });
  it("without an address, the county's typical district", () => {
    expect(resolveAssumptions({ ...place, facts: null }, {}).values).toMatchObject({ flDistrict: "UNI", floodZone: "outside", sqft: 1800, yearBuilt: null });
  });
});
