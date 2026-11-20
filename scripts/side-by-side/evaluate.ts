/**
 * The side-by-side test (docs/side-by-side-test.md): each Florida 2024 sale's 2025 bill against three ways to estimate it.
 *
 *   pnpm exec tsx scripts/side-by-side/evaluate.ts .cache/side-by-side-fl.json
 *
 *   ours      this calculator's Florida method (src/lib/tax.ts floridaTax) at the parcel's district, as with an address
 *   county    the price × the county's effective rate: the method Zillow's property tax calculator describes (the rate here is the
 *             Census ACS rate this calculator uses outside FL / CA / TX; Zillow's own rate table is not public)
 *   flat      the price × 1.25 %: one generic calculator's default (The Truth About Mortgage's review)
 *
 * The truth is the bill's ad valorem part: the 2025 school and non-school taxable values × the parcel's 2025 mills. Flat charges
 * are left out on both sides. Prints the tables; writes nothing.
 */
import { readFileSync } from "node:fs";
import { floridaTax } from "../../src/lib/tax";
import type { CountyData } from "../../src/lib/types";

interface Row { county: string; type: "001" | "004"; price: number; mo: number; case: "none" | "homestead"; district: string; truth: number }
const { rows } = JSON.parse(readFileSync(process.argv[2], "utf8")) as { rows: Row[] };
const counties = JSON.parse(readFileSync(new URL("../../public/data/county/FL.json", import.meta.url), "utf8")) as Record<string, CountyData>;

type Method = "ours" | "county" | "flat";
interface Scored { row: Row; est: Record<Method, number | null>; low: number | null; high: number | null; districtKnown: boolean }
const scored: Scored[] = [];
for (const r of rows) {
  if (!(r.truth > 0)) continue;
  const c = counties[r.county] ?? null;
  const districtKnown = !!c?.fl_districts?.some((d) => d.code === r.district);
  const fl = floridaTax({ st: "FL", county: r.county, price: r.price, homeType: r.type === "004" ? "condo" : "house", liveInHome: r.case === "homestead", flDistrict: r.district }, c);
  const rate = c?.area_tax?.rate_pct ?? null;
  scored.push({
    row: r,
    est: { ours: fl?.yearly ?? null, county: rate === null ? null : (r.price * rate) / 100, flat: r.price * 0.0125 },
    low: fl?.low ?? null,
    high: fl?.high ?? null,
    districtKnown,
  });
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : NaN;
};
const pct = (v: number) => `${(v * 100).toFixed(0)} %`;

function table(title: string, set: Scored[]) {
  console.log(`\n### ${title} (${set.length.toLocaleString("en-US")} sales)\n`);
  console.log("| Method | Median estimate ÷ bill | Median error | Within 10 % | Within 20 % | 90th-percentile error | More than 20 % too low |");
  console.log("|---|---|---|---|---|---|---|");
  for (const m of ["ours", "county", "flat"] as Method[]) {
    const ok = set.filter((s) => s.est[m] !== null);
    const ratio = ok.map((s) => s.est[m]! / s.row.truth);
    const err = ratio.map((x) => Math.abs(x - 1));
    console.log(`| ${m} | ${q(ratio, 0.5).toFixed(2)} | ${pct(q(err, 0.5))} | ${pct(err.filter((e) => e <= 0.1).length / err.length)} | ${pct(err.filter((e) => e <= 0.2).length / err.length)} | ${pct(q(err, 0.9))} | ${pct(ratio.filter((x) => x < 0.8).length / ratio.length)} |${ok.length < set.length ? ` (${ok.length} with a figure)` : ""}`);
  }
  const ranged = set.filter((s) => s.low !== null && s.high !== null);
  if (ranged.length) {
    const inside = ranged.filter((s) => s.row.truth >= s.low! && s.row.truth <= s.high!).length;
    console.log(`\nOur range shown on ${ranged.length.toLocaleString("en-US")} (${pct(ranged.length / set.length)}); the bill inside it on ${pct(inside / ranged.length)}.`);
  }
}

console.log(`${scored.length.toLocaleString("en-US")} sales; the parcel's district in the calculator's list: ${pct(scored.filter((s) => s.districtKnown).length / scored.length)}`);
table("All sales", scored);
table("No exemption (a home you will not live in)", scored.filter((s) => s.row.case === "none"));
table("Homestead (you live in the home)", scored.filter((s) => s.row.case === "homestead"));
table("Houses (DOR 001)", scored.filter((s) => s.row.type === "001"));
table("Condominiums (DOR 004)", scored.filter((s) => s.row.type === "004"));
