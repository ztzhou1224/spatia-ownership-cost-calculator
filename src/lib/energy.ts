// Copied from spatia-report app/lib/home/energy.ts at acadedd (the formula's leaf part; the RentCast mapping and the record sentences are left out).
/**
 * The energy estimate's formula (owner rulings 2026-10-19, "Option B sounds good with one caveat": no layer is built from
 * RentCast data; a FORMULA is fitted once, and the report applies it to the values RentCast returns for this home;
 * docs/plans/2026-10-energy-estimate.md). A LEAF module: the predictors, the RentCast → formula inputs mapping, and the
 * estimate itself. The coefficients are DATA, fitted by `scripts/fit-energy-formula.ts` from EIA's 2020 Residential Energy
 * Consumption Survey (RECS) public-use file into `energy-formula.generated.json`; never hand-edited.
 *
 * Three equations, each a weighted least-squares fit of log annual use on the same predictors (RECS's `NWEIGHT`):
 *   - `kwh_electric_heat`: electricity, homes whose main heating fuel is electricity (RECS `FUELHEAT` 5);
 *   - `kwh_gas_heat`: electricity, homes heated by natural gas (`FUELHEAT` 1);
 *   - `ccf_gas_heat`: natural gas in hundred cubic feet, the same gas-heated homes.
 * The typical figure is exp(x·b) (the geometric centre of homes like this one); the range is the typical figure times the
 * weighted 10th and 90th percentiles of the fit's own residual ratio — "most homes like this one use between … and …".
 *
 * The PLACE enters twice: the climate's degree days, and the home's census region (RECS's ten divisions, California on its own
 * beside the Pacific division) — what the weather does not carry: electricity prices, humidity, the appliance mix and building
 * codes (California's electricity use runs about 14 % under a weather-only fit; the humid South's 11–25 % over it, measured
 * 2026-10-20 over the survey; owner "yes build both", 2026-10-20).
 *
 * Fair housing (founding rule 6): the predictors are the BUILDING and the PLACE (climate and region) only — no household field (income, size,
 * age, race, tenure …) is read from the survey, as a predictor or a filter (`ENERGY_PREDICTORS`, pinned in `energy.test.ts`).
 */
import formula from "../data/energy-formula.generated.json";

/** RECS `TYPEHUQ` in the formula's words. */
export type EnergyHousing = "mobile" | "detached" | "attached" | "apartment_2_4" | "apartment_5_plus";
/** RECS `YEARMADERANGE` collapsed to the formula's four bands (1980–1999 is the base). */
export type EnergyYearBand = "pre1950" | "1950_1979" | "1980_1999" | "2000_plus";
/** `any`: the home has air conditioning, its type not stated (the survey's central share among cooled homes is used). */
export type EnergyCooling = "central" | "room" | "any" | "none";

/** The home's values the formula reads. `null` = not known: the survey's average for that predictor is used (see {@link designRow}). */
export interface EnergyInputs {
  housing: EnergyHousing;
  /** Living area, square feet (RECS `SQFTEST`, the respondent-reported area; RentCast `squareFootage`). */
  sqft: number;
  yearBand: EnergyYearBand | null;
  bedrooms: number | null;
  cooling: EnergyCooling | null;
  pool: boolean | null;
}

/** The place the formula reads: annual heating and cooling degree days, base 65 °F, and the home's state (its census region). */
export interface EnergyClimate {
  hdd: number;
  cdd: number;
  /** The USPS state code; absent or unknown = the survey's region shares (the average place). */
  state?: string | null;
}

/** RECS 2020's ten census divisions (`DIVISION`; the Mountain division split North / South). East North Central is the base. */
export type EnergyRegion =
  | "new_england"
  | "middle_atlantic"
  | "east_north_central"
  | "west_north_central"
  | "south_atlantic"
  | "east_south_central"
  | "west_south_central"
  | "mountain_north"
  | "mountain_south"
  | "pacific";

/** Each region's RECS `DIVISION` value (the fit checks every survey row's state against {@link ENERGY_REGION_BY_STATE}). */
export const ENERGY_REGION_RECS: Readonly<Record<EnergyRegion, string>> = {
  new_england: "New England",
  middle_atlantic: "Middle Atlantic",
  east_north_central: "East North Central",
  west_north_central: "West North Central",
  south_atlantic: "South Atlantic",
  east_south_central: "East South Central",
  west_south_central: "West South Central",
  mountain_north: "Mountain North",
  mountain_south: "Mountain South",
  pacific: "Pacific",
};

const REGION_STATES: Readonly<Record<EnergyRegion, readonly string[]>> = {
  new_england: ["CT", "MA", "ME", "NH", "RI", "VT"],
  middle_atlantic: ["NJ", "NY", "PA"],
  east_north_central: ["IL", "IN", "MI", "OH", "WI"],
  west_north_central: ["IA", "KS", "MN", "MO", "ND", "NE", "SD"],
  south_atlantic: ["DC", "DE", "FL", "GA", "MD", "NC", "SC", "VA", "WV"],
  east_south_central: ["AL", "KY", "MS", "TN"],
  west_south_central: ["AR", "LA", "OK", "TX"],
  mountain_north: ["CO", "ID", "MT", "UT", "WY"],
  mountain_south: ["AZ", "NM", "NV"],
  pacific: ["AK", "CA", "HI", "OR", "WA"],
};

/** The 50 states and DC by RECS 2020 division (the survey's own state → division assignment, checked by the fit). */
export const ENERGY_REGION_BY_STATE: Readonly<Record<string, EnergyRegion>> = Object.fromEntries(
  (Object.entries(REGION_STATES) as [EnergyRegion, readonly string[]][]).flatMap(([r, sts]) => sts.map((st) => [st, r])),
);

/** The region predictors (every region but the base), then California's own term beside the Pacific division's. */
export const ENERGY_REGION_PREDICTORS = [
  "new_england",
  "middle_atlantic",
  "west_north_central",
  "south_atlantic",
  "east_south_central",
  "west_south_central",
  "mountain_north",
  "mountain_south",
  "pacific",
  "california",
] as const;

/** The predictors, in the coefficient order of every equation. Building and climate only (rule 6). */
export const ENERGY_PREDICTORS = [
  "intercept",
  "ln_sqft",
  "mobile",
  "attached",
  "apartment_2_4",
  "apartment_5_plus",
  "pre1950",
  "y1950_1979",
  "y2000_plus",
  "hdd_k",
  "cdd_k_ac",
  "cdd_k_no_ac",
  "central_ac",
  "pool",
  "bedrooms",
  ...ENERGY_REGION_PREDICTORS,
] as const;
export type EnergyPredictor = (typeof ENERGY_PREDICTORS)[number];

export const ENERGY_EQUATIONS = ["kwh_electric_heat", "kwh_gas_heat", "ccf_gas_heat"] as const;
export type EnergyEquation = (typeof ENERGY_EQUATIONS)[number];

/** The fitted file's shape (`scripts/fit-energy-formula.ts` writes it). */
export interface EnergyEquationFit {
  /** One coefficient per {@link ENERGY_PREDICTORS} entry, same order. */
  coefficients: number[];
  /** Weighted 10th / 90th percentiles of the log residual. */
  residual_p10: number;
  residual_p90: number;
  /** Survey homes in the fit, and the weighted R² on the log scale. */
  n: number;
  r2_log: number;
  /** 5-fold cross-validated median absolute percent error of the typical figure (0.26 = 26 %). */
  cv_median_abs_pct_error: number;
}
export interface EnergyFormula {
  formula_version: string;
  source: { title: string; url: string; file: string; sha256: string; data_year: number };
  predictors: EnergyPredictor[];
  equations: Record<EnergyEquation, EnergyEquationFit>;
  /** The survey's weighted averages, used for a predictor whose input is null. */
  fill: {
    year_band_share: Record<Exclude<EnergyYearBand, "1980_1999">, number>;
    bedrooms_by_housing: Record<EnergyHousing, number>;
    pool_by_housing: Record<EnergyHousing, number>;
    /** Air-conditioning shares by cooling-degree-day band: `cdd_max` is the band's upper edge (the last is open). */
    cooling_by_cdd: { cdd_max: number | null; ac: number; central: number }[];
    /** Each region predictor's survey share (the average place, for a home whose state is not known). */
    region_share: Record<(typeof ENERGY_REGION_PREDICTORS)[number], number>;
  };
}

export const ENERGY_FORMULA = formula as EnergyFormula;

/** The bedroom count the survey top-codes (RECS `BEDROOMS` 0–6). */
export const BEDROOMS_TOP = 6;

/** The predictor row for one home. A null input takes the survey's weighted average of that predictor. */
export function designRow(x: EnergyInputs, c: EnergyClimate, f: EnergyFormula = ENERGY_FORMULA): number[] {
  const hddK = c.hdd / 1000;
  const cddK = c.cdd / 1000;
  const band = x.yearBand;
  const share = f.fill.year_band_share;
  const yr =
    band === null
      ? { pre1950: share.pre1950, y1950_1979: share["1950_1979"], y2000_plus: share["2000_plus"] }
      : { pre1950: band === "pre1950" ? 1 : 0, y1950_1979: band === "1950_1979" ? 1 : 0, y2000_plus: band === "2000_plus" ? 1 : 0 };
  let ac: number;
  let central: number;
  if (x.cooling === null) {
    const row = f.fill.cooling_by_cdd.find((r) => r.cdd_max === null || c.cdd <= r.cdd_max)!;
    ac = row.ac;
    central = row.central;
  } else if (x.cooling === "any") {
    const row = f.fill.cooling_by_cdd.find((r) => r.cdd_max === null || c.cdd <= r.cdd_max)!;
    ac = 1;
    central = row.ac > 0 ? row.central / row.ac : 0;
  } else {
    ac = x.cooling === "none" ? 0 : 1;
    central = x.cooling === "central" ? 1 : 0;
  }
  const bedrooms = x.bedrooms === null ? f.fill.bedrooms_by_housing[x.housing] : Math.min(Math.max(Math.round(x.bedrooms), 0), BEDROOMS_TOP);
  const pool = x.pool === null ? f.fill.pool_by_housing[x.housing] : x.pool ? 1 : 0;
  const region = c.state ? ENERGY_REGION_BY_STATE[c.state.toUpperCase()] : undefined;
  const regionTerms = Object.fromEntries(
    ENERGY_REGION_PREDICTORS.map((k) => [k, !region ? f.fill.region_share[k] : k === "california" ? (c.state!.toUpperCase() === "CA" ? 1 : 0) : region === k ? 1 : 0]),
  ) as Record<(typeof ENERGY_REGION_PREDICTORS)[number], number>;
  const v: Record<EnergyPredictor, number> = {
    intercept: 1,
    ln_sqft: Math.log(x.sqft),
    mobile: x.housing === "mobile" ? 1 : 0,
    attached: x.housing === "attached" ? 1 : 0,
    apartment_2_4: x.housing === "apartment_2_4" ? 1 : 0,
    apartment_5_plus: x.housing === "apartment_5_plus" ? 1 : 0,
    ...yr,
    hdd_k: hddK,
    cdd_k_ac: cddK * ac,
    cdd_k_no_ac: cddK * (1 - ac),
    central_ac: central,
    pool,
    bedrooms,
    ...regionTerms,
  };
  return ENERGY_PREDICTORS.map((p) => v[p]);
}

/** One equation's figures for one home: typical, low (10th percentile), high (90th), in the equation's unit. */
export interface EnergyUse {
  typical: number;
  low: number;
  high: number;
}

export function predictUse(eq: EnergyEquation, x: EnergyInputs, c: EnergyClimate, f: EnergyFormula = ENERGY_FORMULA): EnergyUse {
  const fit = f.equations[eq];
  const row = designRow(x, c, f);
  const xb = row.reduce((s, v, i) => s + v * fit.coefficients[i], 0);
  const typical = Math.exp(xb);
  return { typical, low: typical * Math.exp(fit.residual_p10), high: typical * Math.exp(fit.residual_p90) };
}

/** The prices the dollars use: the utility's average residential price, and the state's residential natural gas price. */
export interface EnergyPrices {
  /** US dollars per kWh (EIA-861: residential revenue ÷ residential sales). */
  electricity_usd_per_kwh: number;
  /** US dollars per thousand cubic feet (EIA's state residential price); null when not read. */
  gas_usd_per_mcf: number | null;
}

export type HeatingCase = "electric_heat" | "gas_heat";

/**
 * One heating case, rounded as the report states it: kWh to the nearest 100, ccf to the nearest 10, dollars a year to the
 * nearest $10 and a month to the nearest $5. Every dollar figure is computed from the ROUNDED use × the price (a declared
 * derivation a reader can redo); the gas-heat total is the sum of its rounded electricity and gas; `gas_*` is null in the electric-heat case and the gas dollars null without a gas price.
 */
export interface EnergyCaseEstimate {
  heating: HeatingCase;
  kwh: EnergyUse;
  ccf: EnergyUse | null;
  electricity_usd_year: number;
  /** The electricity alone, a month (typical; to $5): the figure a monthly electric bill compares with. */
  electricity_usd_month: number;
  gas_usd_year: number | null;
  gas_usd_month: number | null;
  /** Electricity + gas, a year and a month (typical); null when the case needs a gas price it does not have. */
  total_usd_year: number | null;
  total_usd_month: number | null;
  /** The range of the total a year: each equation's low and high summed (the case's electricity and gas move together). */
  total_usd_year_low: number | null;
  total_usd_year_high: number | null;
}

const round = (v: number, step: number): number => Math.round(v / step) * step;
const roundUse = (u: EnergyUse, step: number): EnergyUse => ({ typical: round(u.typical, step), low: round(u.low, step), high: round(u.high, step) });
/** RECS reports gas in hundred cubic feet (ccf); EIA prices it per thousand (Mcf). */
export const CCF_PER_MCF = 10;

export function estimateCase(heating: HeatingCase, x: EnergyInputs, c: EnergyClimate, p: EnergyPrices, f: EnergyFormula = ENERGY_FORMULA): EnergyCaseEstimate {
  const kwh = roundUse(predictUse(heating === "electric_heat" ? "kwh_electric_heat" : "kwh_gas_heat", x, c, f), 100);
  const ccf = heating === "gas_heat" ? roundUse(predictUse("ccf_gas_heat", x, c, f), 10) : null;
  const elec = (k: number) => k * p.electricity_usd_per_kwh;
  const gas = (g: number) => (g / CCF_PER_MCF) * (p.gas_usd_per_mcf ?? NaN);
  const electricity_usd_year = round(elec(kwh.typical), 10);
  const electricity_usd_month = round(elec(kwh.typical) / 12, 5);
  if (ccf === null) {
    return {
      heating,
      kwh,
      ccf,
      electricity_usd_year,
      electricity_usd_month,
      gas_usd_year: null,
      gas_usd_month: null,
      total_usd_year: electricity_usd_year,
      total_usd_month: round(elec(kwh.typical) / 12, 5),
      total_usd_year_low: round(elec(kwh.low), 10),
      total_usd_year_high: round(elec(kwh.high), 10),
    };
  }
  if (p.gas_usd_per_mcf === null) {
    return { heating, kwh, ccf, electricity_usd_year, electricity_usd_month, gas_usd_year: null, gas_usd_month: null, total_usd_year: null, total_usd_month: null, total_usd_year_low: null, total_usd_year_high: null };
  }
  // the total is the sum of the two stated parts, so the electricity and the gas a reader sees add up to it (2026-10-20)
  const gas_usd_year = round(gas(ccf.typical), 10);
  const gas_usd_month = round(gas(ccf.typical) / 12, 5);
  return {
    heating,
    kwh,
    ccf,
    electricity_usd_year,
    electricity_usd_month,
    gas_usd_year,
    gas_usd_month,
    total_usd_year: electricity_usd_year + gas_usd_year,
    total_usd_month: electricity_usd_month + gas_usd_month,
    total_usd_year_low: round(elec(kwh.low) + gas(ccf.low), 10),
    total_usd_year_high: round(elec(kwh.high) + gas(ccf.high), 10),
  };
}


export function yearBandOf(yearBuilt: number | null): EnergyYearBand | null {
  if (yearBuilt === null || !Number.isFinite(yearBuilt) || yearBuilt < 1600) return null;
  if (yearBuilt < 1950) return "pre1950";
  if (yearBuilt < 1980) return "1950_1979";
  if (yearBuilt < 2000) return "1980_1999";
  return "2000_plus";
}

/** The smallest and largest living area the survey holds (RECS `SQFTEST` 240–15,000); outside it the formula is not applied. */
export const SQFT_MIN = 240;
export const SQFT_MAX = 15000;

/**
 * RentCast's cooling (copied from spatia-report energy.ts `coolingOf`): `coolingType` "Central" → central; another named type →
 * room units; `cooling === true` without a type → `any`; `cooling === false` → none; absent → unknown (the survey's share).
 */
export function coolingOf(f: { cooling?: boolean | null; coolingType?: string | null }): EnergyCooling | null {
  const t = typeof f.coolingType === "string" ? f.coolingType.trim() : "";
  if (/^none$/i.test(t)) return "none";
  if (/central/i.test(t)) return "central";
  if (t !== "") return "room";
  if (f.cooling === true) return "any";
  if (f.cooling === false) return "none";
  return null;
}

/** The heating fuel, only when RentCast's `heatingType` names one (copied from spatia-report energy.ts `heatingCaseOf`). */
export function heatingCaseOf(heatingType: unknown): HeatingCase | null {
  if (typeof heatingType !== "string") return null;
  if (/propane|oil/i.test(heatingType)) return null;
  if (/\bgas\b/i.test(heatingType)) return "gas_heat";
  if (/electric|heat\s*pump/i.test(heatingType)) return "electric_heat";
  return null;
}
