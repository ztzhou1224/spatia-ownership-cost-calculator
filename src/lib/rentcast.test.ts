import { describe, expect, it } from "vitest";
import { resolveAssumptions } from "./calc";
import { matchProperty, parseProperty } from "./rentcast";
import type { Place } from "./types";

const record = {
  formattedAddress: "3005 W Concord St, Orlando, FL 32805",
  propertyType: "Single Family",
  bedrooms: 3,
  bathrooms: 1,
  squareFootage: 1109,
  yearBuilt: 1957,
  owner: { names: ["A PERSON"], type: "Individual" },
  zoning: "R-1A",
  assessorID: "x",
  hoa: { fee: 45 },
  features: { cooling: true, coolingType: "Central", heating: true, heatingType: "Forced Air", pool: false },
  propertyTaxes: { "2022": { year: 2022, total: 2187 }, "2024": { year: 2024, total: 2665 } },
  lastSaleDate: "2020-02-17T00:00:00.000Z",
  lastSalePrice: 115000,
};

describe("RentCast's property record", () => {
  it("keeps the allowlisted facts only, never an owner field, the zoning or the APN", () => {
    const p = parseProperty(record)!;
    expect(p).toMatchObject({ homeType: "house", bedrooms: 3, squareFootage: 1109, yearBuilt: 1957, hoaFee: 45, cooling: true, coolingType: "Central", pool: false, lastTax: { year: 2024, total: 2665 }, lastSale: { date: "2020-02-17", price: 115000 } });
    const text = JSON.stringify(p);
    for (const banned of ["A PERSON", "Individual", "R-1A", "assessorID", "owner"]) expect(text).not.toContain(banned);
  });
  it("matches exactly one record by street line and ZIP", () => {
    expect(matchProperty([record], "3005 W Concord St, Orlando, FL 32805")?.yearBuilt).toBe(1957);
    expect(matchProperty([record], "3007 W Concord St, Orlando, FL 32805")).toBeNull();
    expect(matchProperty([record, record], "3005 W Concord St, Orlando, FL 32805")).toBeNull();
    expect(matchProperty([{ ...record, formattedAddress: "3005 W Concord St, Unit 2, Orlando, FL 32805" }], "3005 W Concord St, Orlando, FL 32805")).toBeNull();
    expect(matchProperty({ error: "no record" }, "3005 W Concord St, Orlando, FL 32805")).toBeNull();
  });
});

describe("defaults from RentCast", () => {
  const place: Place = {
    zip: "43214",
    zipData: { st: "OH", county: "39049", lat: 40, lon: -83, hoi: null, climate: { station: "COLUMBUS", hdd: 5500, cdd: 1000, km: 8 } },
    county: { area_tax: { rate_pct: 1.5, tracts: 1, owners: 1, median_value: 300000 }, flood: null },
    state: { electricity_usd_per_kwh: 0.17, electricity_year: 2025, gas_usd_per_mcf: 13.85, gas_year: 2025, gas_share: 0.68 },
    facts: {
      label: "440 Brevoort Rd, Columbus, OH 43214",
      zip: "43214",
      st: "OH",
      county: null,
      floodZone: "outside",
      floodZoneCode: "X",
      roll: null,
      flDistrict: null,
      property: { ...parseProperty(record)!, homeType: "townhouse", features: undefined } as never,
    },
  };
  it("fills the home's facts, the HOA fee and the cooling, each with its source", () => {
    const { values, sources } = resolveAssumptions(place, {});
    expect(values).toMatchObject({ homeType: "townhouse", sqft: 1109, bedrooms: 3, yearBuilt: 1957, cooling: "central", pool: false, hoaMonthly: 45 });
    expect(sources.sqft).toContain("RentCast");
    expect(sources.hoaMonthly).toContain("RentCast");
    // "Forced Air" names no fuel: the state's default heating stays
    expect(values.heating).toBe("gas_heat");
  });
});
