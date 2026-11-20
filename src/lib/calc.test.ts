import { describe, expect, it } from "vitest";
import { calculate, defaultsFor, LINE_KEYS, resolveAssumptions } from "./calc";
import { energyCost } from "./energy-cost";
import { floodInsurance, hoiFactor, homeownersInsurance } from "./insurance";
import { defaultPmiPct, monthlyPayment, pmiEndMonth } from "./mortgage";
import { californiaTax, floridaTax, propertyTax } from "./tax";
import type { CountyData, Place } from "./types";
import flTax from "../data/fl-tax.generated.json";

const hillsborough: CountyData = {
  area_tax: { rate_pct: 1.1, tracts: 300, owners: 300000, median_value: 380000 },
  flood: {
    "outside:yes": { p25: 491, p50: 610, p75: 874, n: 6934 },
    "outside:no": { p25: 668, p50: 770, p75: 1025, n: 719 },
    "sfha:yes": { p25: 900, p50: 1500, p75: 2600, n: 3000 },
    "sfha:no": { p25: 1312, p50: 2264, p75: 3908, n: 2105 },
  },
  fl_districts: [
    { code: "TA", name: "CITY OF TAMPA", school: 5.4, nonschool: 14.4428, parcels: 120000 },
    { code: "U", name: "UNINCORPORATED", school: 5.4, nonschool: 12.0, parcels: 300000 },
  ],
  fl_default_district: "U",
};

const tampa: Place = {
  zip: "33606",
  zipData: { st: "FL", county: "12057", lat: 27.93, lon: -82.47, hoi: { usd: 9481, year: 2022 }, climate: { station: "TAMPA INTL AP, FL US", hdd: 500, cdd: 3800, km: 6 } },
  county: hillsborough,
  state: { electricity_usd_per_kwh: 0.152, electricity_year: 2025, gas_usd_per_mcf: 25.48, gas_year: 2025, gas_share: 0.08 },
};

describe("the loan", () => {
  it("pays the standard amortised payment", () => {
    expect(monthlyPayment(320_000, 7, 30)).toBeCloseTo(2128.97, 1);
    expect(monthlyPayment(120_000, 0, 10)).toBe(1000);
    expect(monthlyPayment(0, 7, 30)).toBe(0);
  });
  it("needs no mortgage insurance at 20 % down, and ends it at 78 % of the price", () => {
    expect(defaultPmiPct(20)).toBe(0);
    expect(defaultPmiPct(10)).toBeGreaterThan(defaultPmiPct(15));
    expect(pmiEndMonth(100_000, 78_000, 7, 30)).toBe(0);
    const m = pmiEndMonth(400_000, 360_000, 7, 30)!;
    expect(m).toBeGreaterThan(12 * 5);
    expect(m).toBeLessThan(12 * 15);
  });
});

describe("the property tax", () => {
  it("Florida: k × price × the district's mills, less the homestead exemptions for a main home", () => {
    const k = (flTax as { k_by_county_type: Record<string, number> }).k_by_county_type["12057:001"];
    expect(k).toBeGreaterThan(0.5);
    expect(k).toBeLessThan(1.1);
    const off = floridaTax({ st: "FL", county: "12057", price: 400_000, homeType: "house", liveInHome: false, flDistrict: "TA" }, hillsborough)!;
    expect(off.yearly).toBeCloseTo((k * 400_000 * (5.4 + 14.4428)) / 1000, 6);
    const main = floridaTax({ st: "FL", county: "12057", price: 400_000, homeType: "house", liveInHome: true, flDistrict: "TA" }, hillsborough)!;
    expect(main.yearly).toBeLessThan(off.yearly);
    // the default district when none is chosen
    const dflt = floridaTax({ st: "FL", county: "12057", price: 400_000, homeType: "house", liveInHome: false }, hillsborough)!;
    expect(dflt.yearly).toBeCloseTo((k * 400_000 * 17.4) / 1000, 6);
  });
  it("Florida: a range only where the county's k × price group passed every bar", () => {
    const fl = flTax as { counties: { county: string; rate_ok: boolean; groups: { type: string; cases: Record<string, { passed: boolean }> }[] }[] };
    for (const c of fl.counties) for (const g of c.groups) for (const s of Object.values(g.cases)) expect(typeof s.passed).toBe("boolean");
    const r = floridaTax({ st: "FL", county: "12057", price: 400_000, homeType: "house", liveInHome: false }, hillsborough)!;
    if (r.low !== null) {
      expect(r.low).toBeLessThan(r.yearly);
      expect(r.high!).toBeGreaterThan(r.yearly);
    }
  });
  it("California: 1 % of the price plus the voter-approved rate", () => {
    const t = californiaTax({ st: "CA", county: "06037", price: 1_000_000, homeType: "house", liveInHome: true }, { area_tax: null, flood: null, ca_voter_pct: 0.2 }, 0.15);
    expect(t.yearly).toBeCloseTo(12_000, 6);
    const s = californiaTax({ st: "CA", county: "06037", price: 1_000_000, homeType: "house", liveInHome: true }, null, 0.15);
    expect(s.yearly).toBeCloseTo(11_500, 6);
  });
  it("elsewhere: the area's effective rate; a typed rate wins", () => {
    const c: CountyData = { area_tax: { rate_pct: 1.8, tracts: 10, owners: 1000 }, flood: null };
    expect(propertyTax({ st: "OH", county: "39049", price: 300_000, homeType: "house", liveInHome: true }, c, null)!.yearly).toBeCloseTo(5_400, 6);
    expect(propertyTax({ st: "OH", county: "39049", price: 300_000, homeType: "house", liveInHome: true, ratePct: 2 }, c, null)!.yearly).toBeCloseTo(6_000, 6);
    expect(propertyTax({ st: "OH", county: "39049", price: 300_000, homeType: "house", liveInHome: true }, null, null)).toBeNull();
  });
});

describe("insurance and energy", () => {
  it("flood: the county's median for the zone and the main-home case", () => {
    expect(floodInsurance(hillsborough, "FL", "sfha", false)!.yearly).toBe(2264);
    expect(floodInsurance(hillsborough, "FL", "outside", true)!.yearly).toBe(610);
    expect(floodInsurance(null, "FL", "outside", true)).toBeNull();
  });
  it("homeowners: Treasury's figure as published, brought to date with BLS's index, both stated", () => {
    const f = hoiFactor(2022)!;
    expect(f.factor).toBeGreaterThan(1);
    expect(f.factor).toBeLessThan(2);
    const h = homeownersInsurance(tampa.zipData)!;
    expect(h.yearly).toBeCloseTo(9481 * f.factor, 6);
    expect(h.notes[0]).toContain("$9,481 in 2022, as Treasury published it");
    expect(h.notes[1]).toContain(f.to);
    // a year the index has no full year for stays as published
    expect(hoiFactor(1990)).toBeNull();
    expect(homeownersInsurance({ ...tampa.zipData, hoi: { usd: 2000, year: 1990 } })!.yearly).toBe(2000);
  });
  it("energy: a bigger home uses more; the range holds the figure", () => {
    const base = { homeType: "house" as const, bedrooms: null, yearBuilt: null, cooling: null, pool: null, heating: "electric_heat" as const, hdd: 500, cdd: 3800, st: "FL", electricityUsdPerKwh: 0.15, gasUsdPerMcf: null };
    const small = energyCost({ ...base, sqft: 1200 })!;
    const big = energyCost({ ...base, sqft: 3000 })!;
    expect(big.yearly).toBeGreaterThan(small.yearly);
    expect(small.low).toBeLessThan(small.yearly);
    expect(small.high).toBeGreaterThan(small.yearly);
    expect(energyCost({ ...base, sqft: 100 })).toBeNull();
    // gas heat without a gas price falls back to the electric case
    expect(energyCost({ ...base, sqft: 1200, heating: "gas_heat" })!.gasYearly).toBeNull();
  });
});

describe("the calculator", () => {
  it("every input has a default and a source", () => {
    const { values, sources } = defaultsFor(tampa);
    for (const [k, v] of Object.entries(values)) {
      expect(v, k).not.toBeUndefined();
      expect(sources[k as keyof typeof sources], k).toBeTruthy();
    }
    expect(values.price).toBe(380_000);
    expect(values.heating).toBe("electric_heat");
    expect(values.flDistrict).toBe("U");
  });
  it("defaults follow the inputs they depend on", () => {
    const r = resolveAssumptions(tampa, { homeType: "condo", downPct: 10, floodZone: "sfha" });
    expect(r.values.sqft).toBe(1100);
    expect(r.values.pmiPct).toBe(defaultPmiPct(10));
    expect(r.values.buyFlood).toBe(true);
    expect(resolveAssumptions(tampa, { homeType: "condo", sqft: 900 }).values.sqft).toBe(900);
  });
  it("every line is there, a figure the user sets wins, and the total adds the lines", () => {
    const { values } = resolveAssumptions(tampa, {});
    const r = calculate(tampa, values);
    expect(r.lines.map((l) => l.key)).toEqual([...LINE_KEYS]);
    expect(r.yearly).toBeCloseTo(r.lines.reduce((s, l) => s + l.yearly, 0), 6);
    expect(r.monthlyLow).toBeLessThanOrEqual(r.monthly);
    expect(r.monthlyHigh).toBeGreaterThanOrEqual(r.monthly);
    expect(r.lines.find((l) => l.key === "pmi")!.yearly).toBe(0);
    expect(r.lines.find((l) => l.key === "flood_insurance")!.yearly).toBe(0);
    const set = calculate(tampa, values, { home_insurance: 3600 });
    const hoi = set.lines.find((l) => l.key === "home_insurance")!;
    expect(hoi.yearly).toBe(3600);
    expect(hoi.setByUser).toBe(true);
    expect(hoi.estimate).toBeCloseTo(9481 * hoiFactor(2022)!.factor, 6);
    expect(set.yearly - r.yearly).toBeCloseTo(3600 - hoi.estimate!, 6);
  });
});
