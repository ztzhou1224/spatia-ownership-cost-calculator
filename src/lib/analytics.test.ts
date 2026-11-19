import { describe, expect, it } from "vitest";
import { LINE_KEYS } from "./calc";
import { snake } from "./analytics";

describe("analytics event names", () => {
  it("every input and line gives a valid GA4 event name (letters, digits, underscores; at most 40 characters)", () => {
    const inputs = ["price", "downPct", "ratePct", "termYears", "pmiPct", "homeType", "sqft", "bedrooms", "yearBuilt", "heating", "cooling", "pool", "liveInHome", "floodZone", "buyFlood", "flDistrict", "txUnits", "electricityUsdPerKwh", "gasUsdPerMcf", "hoaMonthly", "flatChargesYearly", "waterMonthly", "maintenancePct"];
    const names = [...inputs.map((k) => `change_${snake(k)}`), ...inputs.map((k) => `reset_${snake(k)}`), ...LINE_KEYS.map((k) => `reset_line_${k}`)];
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    expect(snake("downPct")).toBe("down_pct");
    expect(snake("electricityUsdPerKwh")).toBe("electricity_usd_per_kwh");
  });
});
