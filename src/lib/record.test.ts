import { describe, expect, it } from "vitest";
import { calculate, resolveAssumptions } from "./calc";
import { makePayload, payloadProblem } from "./record";
import type { Place } from "./types";

const place: Place = {
  zip: "43214",
  zipData: { st: "OH", county: "39049", lat: 40, lon: -83, hoi: null, climate: { station: "COLUMBUS", hdd: 5500, cdd: 1000, km: 8 } },
  county: { area_tax: { rate_pct: 1.5, tracts: 1, owners: 1, median_value: 300000 }, flood: null },
  state: { electricity_usd_per_kwh: 0.17, electricity_year: 2025, gas_usd_per_mcf: 13.85, gas_year: 2025, gas_share: 0.68 },
};

describe("the record of what a visitor entered", () => {
  const { values } = resolveAssumptions(place, { price: 450000, downPct: 10 });
  const result = calculate(place, values, { home_insurance: 1800 });
  const p = makePayload({ session: "6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c", seq: 1, kind: "edit", query: "43214", place, values, changed: ["price", "downPct"], setLines: { home_insurance: 1800 }, result, build: "b" });
  it("carries every input, the changes, the set lines and the result; no IP, name or email field", () => {
    expect(payloadProblem(p)).toBeNull();
    expect(p.values.price).toBe(450000);
    expect(p.changed).toEqual(["price", "downPct"]);
    expect(p.lines.home_insurance).toBe(1800);
    expect(Object.keys(p).sort()).toEqual(["build", "changed", "kind", "lines", "monthly", "place", "query", "seq", "session", "setLines", "values", "yearly"]);
  });
  it("refuses a bad shape", () => {
    expect(payloadProblem({ ...p, session: "x" })).toBe("session");
    expect(payloadProblem({ ...p, kind: "other" })).toBe("kind");
    expect(payloadProblem({ ...p, place: { ...p.place, zip: "4321" } })).toBe("place");
    expect(payloadProblem({ ...p, changed: ["notAnInput"] })).toBe("changed");
    expect(payloadProblem(null)).toBe("not_object");
  });
});
