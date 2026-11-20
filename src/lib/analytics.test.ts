import { describe, expect, it } from "vitest";
import { LINE_KEYS } from "./calc";
import { CLOSING_KEYS } from "./closing";
import { snake, valueText } from "./analytics";

describe("analytics event names", () => {
  it("every input and line gives a valid GA4 event name (letters, digits, underscores; at most 40 characters)", () => {
    const inputs = ["price", "downPct", "ratePct", "termYears", "pmiPct", "homeType", "sqft", "bedrooms", "yearBuilt", "heating", "cooling", "pool", "liveInHome", "floodZone", "buyFlood", "flDistrict", "txUnits", "electricityUsdPerKwh", "gasUsdPerMcf", "hoaMonthly", "flatChargesYearly", "waterMonthly", "maintenancePct"];
    const names = [...inputs.map((k) => `change_${snake(k)}`), ...inputs.map((k) => `reset_${snake(k)}`), ...LINE_KEYS.map((k) => `reset_line_${k}`), ...CLOSING_KEYS.map((k) => `set_close_${k}`), ...CLOSING_KEYS.map((k) => `reset_close_${k}`)];
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    expect(snake("downPct")).toBe("down_pct");
    expect(snake("electricityUsdPerKwh")).toBe("electricity_usd_per_kwh");
  });
  it("values are text of at most 100 characters; a list joined; null is 'not known'", () => {
    expect(valueText(450000)).toBe("450000");
    expect(valueText(null)).toBe("not known");
    expect(valueText(["227-000-00", "227-901-02"])).toBe("227-000-00,227-901-02");
    expect(valueText("x".repeat(300))).toHaveLength(100);
  });
});
