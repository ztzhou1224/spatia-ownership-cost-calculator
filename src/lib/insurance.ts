/**
 * Insurance: homeowners (Treasury FIO's ZIP average, brought to date with BLS's national price index of homeowners premiums) and
 * flood (NFIP's premiums of similar homes, with the state's back-test range). Neither is a quote.
 */
import hoiIndex from "../data/hoi-index.generated.json";
import national from "../data/national.generated.json";
import type { CountyData, ZipData } from "./types";

export interface InsuranceFigure {
  yearly: number;
  low: number | null;
  high: number | null;
  source: string;
  notes: string[];
}

const HOI_INDEX = hoiIndex as { series: string; latest: { year: number; month: number; value: number }; annual_average: Record<string, number> };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The change in BLS's producer price index of homeowners insurance premiums from Treasury's year (its average) to the latest final
 * month (owner 2026-11-20: Treasury's premium brought to date with a published index; the study's next step 4). Null when the
 * index has no full year for Treasury's year.
 */
export function hoiFactor(year: number): { factor: number; to: string } | null {
  const base = HOI_INDEX.annual_average[String(year)];
  if (!base) return null;
  return { factor: HOI_INDEX.latest.value / base, to: `${MONTHS[HOI_INDEX.latest.month - 1]} ${HOI_INDEX.latest.year}` };
}

/** Treasury's published figure, then the index step, both stated. */
function dated(usd: number, year: number, what: string): { yearly: number; notes: string[] } {
  const published = `${what}: $${Math.round(usd).toLocaleString("en-US")} in ${year}, as Treasury published it.`;
  const f = hoiFactor(year);
  if (!f) return { yearly: usd, notes: [`${published} Premiums have risen since then in many states.`] };
  const change = Math.round((f.factor - 1) * 100);
  return {
    yearly: usd * f.factor,
    notes: [
      published,
      `Brought to ${f.to} with the Bureau of Labor Statistics' price index of homeowners insurance premiums (PPI ${HOI_INDEX.series}): ${change >= 0 ? "+" : ""}${change} % since the ${year} average. The index is national: premiums in this state can have risen more or less.`,
    ],
  };
}

/** Treasury FIO's average premium per policy in the ZIP (else the county's middle ZIP), brought to date with BLS's national index. */
export function homeownersInsurance(z: ZipData, c: CountyData | null = null): InsuranceFigure | null {
  if (!z.hoi) {
    const h = c?.hoi_county;
    if (!h) return null;
    const d = dated(h.usd, h.year, `The middle of ${h.zips} ZIP averages in the county`);
    return {
      yearly: d.yearly,
      low: null,
      high: null,
      source: `U.S. Treasury Federal Insurance Office: the middle of the county's ZIP averages (${h.year}), brought to date with BLS's premium index`,
      notes: ["Treasury does not publish this ZIP. The figure starts from the middle of the county's published ZIP averages.", ...d.notes, "It is not a quote for this home: ask an agent for one."],
    };
  }
  const d = dated(z.hoi.usd, z.hoi.year, "The average homeowners premium per policy in this ZIP");
  return {
    yearly: d.yearly,
    low: null,
    high: null,
    source: `U.S. Treasury Federal Insurance Office, ZIP ${z.hoi.year} average premium per policy, brought to date with BLS's premium index`,
    notes: [...d.notes, "It is the average over every home in the ZIP, not a quote for this home's size or roof. Ask an agent for a quote."],
  };
}

export type FloodZone = "outside" | "sfha";

interface BacktestRow {
  state: string;
  level: string;
  primary: string;
  n: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
}
const BACKTEST = (national as { nfip_backtest: BacktestRow[] }).nfip_backtest;
/** A range is shown only on a back-test of 100 tested policies or more. */
export const NFIP_MIN_TESTED = 100;

/**
 * NFIP's median new-business premium of similar homes in the county: the zone group (inside the high-risk Special Flood Hazard Area
 * or outside it) × whether it is the main home. The range is that median × the state's back-test ratios (10th to 90th percentile).
 */
export function floodInsurance(c: CountyData | null, st: string, zone: FloodZone, mainHome: boolean): InsuranceFigure | null {
  const f = c?.flood?.[`${zone}:${mainHome ? "yes" : "no"}`];
  if (!f) return null;
  const bt = BACKTEST.find((b) => b.state === st && b.level === "county" && b.primary === (mainHome ? "yes" : "no"));
  const tested = !!bt && (bt.n ?? 0) >= NFIP_MIN_TESTED && bt.p10 !== null && bt.p90 !== null;
  return {
    yearly: f.p50,
    low: tested ? f.p50 * bt!.p10! : null,
    high: tested ? f.p50 * bt!.p90! : null,
    source: `FEMA NFIP policies in force, similar homes in the county (${f.n.toLocaleString("en-US")} policies)`,
    notes: [
      zone === "sfha"
        ? "Inside FEMA's high-risk flood zone (A or V), a lender with a federally backed loan requires flood insurance."
        : "Outside FEMA's high-risk flood zone, flood insurance is optional. FEMA says more than 20 % of flood claims come from outside the high-risk zones.",
      "The median premium of new NFIP policies on similar homes in the county under Risk Rating 2.0. Your premium depends on the building.",
      tested ? `Tested on ${bt!.n!.toLocaleString("en-US")} held-out policies in the state: 8 in 10 premiums fall in the range.` : "No tested range for this state.",
    ],
  };
}
