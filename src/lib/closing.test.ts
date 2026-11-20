import { describe, expect, it } from "vitest";
import { calculate, resolveAssumptions } from "./calc";
import { closingCosts, ESCROW_INSURANCE_MONTHS, ESCROW_TAX_MONTHS, FL_INTANGIBLE_PCT, FL_NOTE_STAMP_PCT, lenderTitleRow, PREPAID_INTEREST_DAYS } from "./closing";
import closingFile from "../data/closing.generated.json";
import type { CountyData, Place } from "./types";

const county: CountyData = {
  area_tax: { rate_pct: 1.1, tracts: 300, owners: 300000, median_value: 380000 },
  flood: null,
  fl_districts: [{ code: "U", name: "UNINCORPORATED", school: 5.4, nonschool: 12.0, parcels: 300000 }],
  fl_default_district: "U",
};
const place = (st: string, countyFips: string): Place => ({
  zip: "00000",
  zipData: { st, county: countyFips, lat: 0, lon: 0, hoi: { usd: 3000, year: 2022 }, climate: { station: "X", hdd: 1000, cdd: 2000, km: 1 } },
  county,
  state: { electricity_usd_per_kwh: 0.15, electricity_year: 2025, gas_usd_per_mcf: null, gas_year: null, gas_share: 0 },
});
const run = (p: Place, changed = {}, set = {}) => {
  const { values } = resolveAssumptions(p, changed);
  const r = calculate(p, values, set);
  return { values, r, c: closingCosts(p, values, r, set) };
};

describe("closing costs", () => {
  it("the file covers every state with at least one loan size, and a range only where the test passed", () => {
    const f = closingFile as unknown as { states: Record<string, { p10: number; p50: number; p90: number; passed: boolean; tested: { coverage: number } | null }[]> };
    expect(Object.keys(f.states).length).toBeGreaterThanOrEqual(50);
    for (const rows of Object.values(f.states))
      for (const r of rows) {
        expect(r.p10).toBeLessThanOrEqual(r.p50);
        expect(r.p50).toBeLessThanOrEqual(r.p90);
        if (r.passed) expect(r.tested!.coverage).toBeGreaterThanOrEqual(0.75);
      }
  });

  it("Florida: HMDA's median for the loan size, the taxes on the mortgage by statute, the prepaid bills from the monthly lines", () => {
    const { values, r, c } = run(place("FL", "12057"), { price: 400_000 });
    expect(r.loan).toBe(320_000);
    const lt = c.lines.find((l) => l.key === "lender_title")!;
    expect(lt.amount).toBe(lenderTitleRow("FL", 320_000)!.p50);
    const tax = c.lines.find((l) => l.key === "mortgage_tax")!;
    expect(tax.amount).toBeCloseTo((320_000 * (FL_NOTE_STAMP_PCT + FL_INTANGIBLE_PCT)) / 100, 6);
    const y = (k: string) => r.lines.find((l) => l.key === k)!.yearly;
    const ins = y("home_insurance") + y("flood_insurance");
    const expected = ins + ((y("tax") + y("flat_charges")) * ESCROW_TAX_MONTHS) / 12 + (ins * ESCROW_INSURANCE_MONTHS) / 12 + (320_000 * (values.ratePct / 100) * PREPAID_INTEREST_DAYS) / 365;
    expect(c.lines.find((l) => l.key === "prepaids")!.amount).toBeCloseTo(expected, 6);
    expect(c.total).toBeCloseTo(c.lines.reduce((s, l) => s + l.amount, 0), 6);
    expect(c.cashToClose).toBeCloseTo(80_000 + c.total, 6);
  });

  it("Texas has no mortgage tax; another state's is not known", () => {
    expect(run(place("TX", "48201")).c.lines.find((l) => l.key === "mortgage_tax")!.amount).toBe(0);
    const ga = run(place("GA", "13121")).c.lines.find((l) => l.key === "mortgage_tax")!;
    expect(ga.estimate).toBeNull();
    expect(ga.amount).toBe(0);
  });

  it("a figure the user sets replaces the estimate and drops the range", () => {
    const { c } = run(place("FL", "12057"), {}, { lender_title: 5000 });
    const lt = c.lines.find((l) => l.key === "lender_title")!;
    expect(lt.amount).toBe(5000);
    expect(lt.setByUser).toBe(true);
    expect(lt.low).toBeNull();
  });

  it("no loan: no lender fees, no escrow, no interest", () => {
    const { r, c } = run(place("FL", "12057"), { downPct: 100 });
    expect(r.loan).toBe(0);
    expect(c.lines.find((l) => l.key === "lender_title")!.amount).toBe(0);
    expect(c.lines.find((l) => l.key === "mortgage_tax")!.amount).toBe(0);
    const y = (k: string) => r.lines.find((l) => l.key === k)!.yearly;
    expect(c.lines.find((l) => l.key === "prepaids")!.amount).toBeCloseTo(y("home_insurance") + y("flood_insurance"), 6);
  });
});
