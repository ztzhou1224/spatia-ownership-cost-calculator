/**
 * Insurance: homeowners (Treasury FIO's ZIP average, as published) and flood (NFIP's premiums of similar homes, with the state's
 * back-test range). Neither is a quote.
 */
import national from "../data/national.generated.json";
import type { CountyData, ZipData } from "./types";

export interface InsuranceFigure {
  yearly: number;
  low: number | null;
  high: number | null;
  source: string;
  notes: string[];
}

/** Treasury FIO's average premium per policy in the ZIP, its latest year, as published (never scaled to today). */
export function homeownersInsurance(z: ZipData, c: CountyData | null = null): InsuranceFigure | null {
  if (!z.hoi) {
    const h = c?.hoi_county;
    if (!h) return null;
    return {
      yearly: h.usd,
      low: null,
      high: null,
      source: `U.S. Treasury Federal Insurance Office: the middle of ${h.zips} ZIP averages in the county, up to ${h.year}`,
      notes: [
        "Treasury does not publish this ZIP. The figure is the middle of the county's published ZIP averages, as published.",
        "Premiums have risen since then in many states. It is not a quote for this home: ask an agent for one.",
      ],
    };
  }
  return {
    yearly: z.hoi.usd,
    low: null,
    high: null,
    source: `U.S. Treasury Federal Insurance Office, ZIP ${z.hoi.year} average premium per policy`,
    notes: [
      `The average homeowners premium in this ZIP in ${z.hoi.year}, as Treasury published it. Premiums have risen since then in many states.`,
      "It is the average over every home in the ZIP, not a quote for this home's size or roof. Ask an agent for a quote.",
    ],
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
