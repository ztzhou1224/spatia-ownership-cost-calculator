import { describe, expect, it } from "vitest";
import { resolveAssumptions } from "./calc";
import { matchListing, matchProperty, parseListing, parseProperty } from "./rentcast";
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

const listingRec = {
  formattedAddress: "700 S Harbour Island Blvd, Unit 326, Tampa, FL 33602",
  status: "Active",
  price: 770000,
  listedDate: "2023-07-01T00:00:00.000Z",
  daysOnMarket: 1237,
  hoa: { fee: 658 },
  listingAgent: { name: "AN AGENT", phone: "555" },
  listingOffice: { name: "AN OFFICE" },
  mlsName: "StellarMLS",
  mlsNumber: "T3453505",
};

describe("RentCast's sale listing", () => {
  it("keeps the asking price, the listed date and the HOA fee; never the agent, the office or the MLS", () => {
    const l = parseListing(listingRec)!;
    expect(l).toEqual({ formattedAddress: listingRec.formattedAddress, price: 770000, listedDate: "2023-07-01", daysOnMarket: 1237, hoaFee: 658 });
    for (const banned of ["AN AGENT", "AN OFFICE", "StellarMLS", "T3453505"]) expect(JSON.stringify(l)).not.toContain(banned);
    expect(parseListing({ ...listingRec, status: "Inactive" })).toBeNull();
  });
  it("matches the unit, not the building's other units", () => {
    expect(matchListing([listingRec], "700 S Harbour Island Blvd, Unit 326, Tampa, FL 33602")?.price).toBe(770000);
    expect(matchListing([listingRec], "700 S Harbour Island Blvd, Unit 327, Tampa, FL 33602")).toBeNull();
  });
  it("the asking price becomes the price default, with its source", () => {
    const place = {
      zip: "33602",
      zipData: { st: "FL", county: "12057", lat: 27.9, lon: -82.4, hoi: null, climate: { station: "TAMPA", hdd: 500, cdd: 3800, km: 5 } },
      county: { area_tax: { rate_pct: 0.9, tracts: 1, owners: 1, median_value: 400000 }, flood: null },
      state: null,
      facts: { label: listingRec.formattedAddress, zip: "33602", st: "FL", county: null, floodZone: null, floodZoneCode: null, roll: null, flDistrict: null, listing: parseListing(listingRec) },
    };
    const { values, sources } = resolveAssumptions(place as never, {});
    expect(values.price).toBe(770000);
    expect(values.hoaMonthly).toBe(658);
    expect(sources.price).toContain("asking price");
  });
});
