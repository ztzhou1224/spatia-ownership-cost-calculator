import { describe, expect, it } from "vitest";
import { calculate, defaultsFor } from "./calc";
import { recordRow, requestProblem, type EstimateRequest } from "./record";
import type { Place } from "./types";

const place: Place = {
  zip: "43214",
  zipData: { st: "OH", county: "39049", lat: 40, lon: -83, hoi: null, climate: { station: "COLUMBUS", hdd: 5500, cdd: 1000, km: 8 } },
  county: { area_tax: { rate_pct: 1.5, tracts: 1, owners: 1, median_value: 300000 }, flood: null },
  state: { electricity_usd_per_kwh: 0.17, electricity_year: 2025, gas_usd_per_mcf: 13.85, gas_year: 2025, gas_share: 0.68 },
};
const KEYS = new Set(Object.keys(defaultsFor(place).values));
const req: EstimateRequest = { session: "6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c", seq: 2, query: "43214", zip: "43214", facts: null, changed: { price: 450000, downPct: 10 }, setLines: { home_insurance: 1800 }, record: "yes" };

describe("a calculation request", () => {
  it("passes when well formed", () => expect(requestProblem(req, KEYS)).toBeNull());
  it("refuses a bad shape", () => {
    expect(requestProblem({ ...req, session: "x" }, KEYS)).toBe("session");
    expect(requestProblem({ ...req, zip: "4321" }, KEYS)).toBe("zip");
    expect(requestProblem({ ...req, changed: { notAnInput: 1 } }, KEYS)).toBe("changed");
    expect(requestProblem({ ...req, changed: { price: { a: 1 } } }, KEYS)).toBe("changed");
    expect(requestProblem({ ...req, setLines: { home_insurance: -5 } }, KEYS)).toBe("set_lines");
    expect(requestProblem({ ...req, record: "maybe" }, KEYS)).toBe("record");
    expect(requestProblem({ ...req, facts: { zip: "99999", label: "x" } }, KEYS)).toBe("facts");
    expect(requestProblem(null, KEYS)).toBe("not_object");
  });
  it("saves every input, the changes, the set lines and the result; no IP, name or email field", () => {
    const values = { ...defaultsFor(place).values, price: 450000, downPct: 10 };
    const row = recordRow(req, values, calculate(place, values, req.setLines), "OH", "39049", "build");
    expect(row).toHaveLength(16);
    expect(row[2]).toBe("edit");
    expect(JSON.parse(row[9] as string).price).toBe(450000);
    expect(JSON.parse(row[10] as string)).toEqual(["price", "downPct"]);
    expect(JSON.parse(row[12] as string).home_insurance).toBe(1800);
    // the 16 columns of migrations/0001_inputs.sql: none is an IP address, a name, an email or a device field
    expect(Object.keys(JSON.parse(row[9] as string))).not.toEqual(expect.arrayContaining(["ip", "email", "name", "userAgent"]));
  });
  it("the Worker's list of input names matches the calculator's", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../workers/app.ts", import.meta.url), "utf8"));
    const listed = new Set([...src.slice(src.indexOf("const INPUT_KEYS"), src.indexOf("]);", src.indexOf("const INPUT_KEYS"))).matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]));
    expect([...listed].sort()).toEqual([...KEYS].sort());
  });
});
