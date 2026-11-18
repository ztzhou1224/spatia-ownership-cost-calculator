import { describe, expect, it } from "vitest";
import { texasTax, txDefaultUnits, TX_SCHOOL_HOMESTEAD_USD, type TxUnit } from "./texas";

const travis: TxUnit[] = [
  { id: "227-000-00", cls: "county", name: "Travis", rate: 0.375845, value: 4.5e11 },
  { id: "227-901-02", cls: "school_district", name: "Austin ISD", rate: 0.9252, sd: "4808940", value: 2e11 },
  { id: "227-904-02", cls: "school_district", name: "Pflugerville ISD", rate: 1.1069, sd: "4834830", value: 3e10 },
  { id: "227-201-03", cls: "city", name: "Austin", rate: 0.574017, value: 2.1e11 },
  { id: "227-202-03", cls: "city", name: "Pflugerville", rate: 0.535, value: 1.2e10 },
  { id: "227-211-11", cls: "special_district", name: "Travis County Healthcare District", rate: 0.118023 },
];
const x = { st: "TX", county: "48453", price: 500_000, homeType: "house" as const, liveInHome: true };

describe("Texas", () => {
  it("defaults: the county, the school district at the address, the postal city when exactly one unit has its name", () => {
    expect(txDefaultUnits(travis, "4834830", "Austin")).toEqual({ ids: ["227-000-00", "227-904-02", "227-201-03"], schoolFromAddress: true, cityFromAddress: true });
    expect(txDefaultUnits(travis, null, null)).toEqual({ ids: ["227-000-00", "227-901-02"], schoolFromAddress: false, cityFromAddress: false });
    expect(txDefaultUnits(travis, "0000000", "Round Rock").ids).toEqual(["227-000-00", "227-901-02"]);
  });
  it("never sums the county's rows: only the chosen units; the school homestead exemption on the school rate only", () => {
    const t = texasTax(x, travis, ["227-000-00", "227-901-02"])!;
    expect(t.yearly).toBeCloseTo((500_000 * 0.375845) / 100 + ((500_000 - TX_SCHOOL_HOMESTEAD_USD) * 0.9252) / 100, 6);
    const notMain = texasTax({ ...x, liveInHome: false }, travis, ["227-000-00", "227-901-02"])!;
    expect(notMain.yearly).toBeCloseTo((500_000 * (0.375845 + 0.9252)) / 100, 6);
    expect(texasTax(x, travis, [])).toBeNull();
    expect(t.low).toBeNull();
  });
});
