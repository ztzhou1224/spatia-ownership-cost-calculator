/**
 * The calculator: every input has an estimated default for the place, the user may change any of them, and every cost line may also
 * be set directly. `defaultsFor` makes the defaults; `calculate` makes the lines from the defaults merged with the user's changes.
 */
import national from "../data/national.generated.json";
import type { EnergyCooling, HeatingCase } from "./energy";
import { energyCost } from "./energy-cost";
import { floodInsurance, homeownersInsurance, type FloodZone } from "./insurance";
import { defaultPmiPct, monthlyPayment, pmiEndMonth } from "./mortgage";
import { flDistrictOf, propertyTax, type HomeType } from "./tax";
import type { Place } from "./types";

export interface Assumptions {
  price: number;
  downPct: number;
  ratePct: number;
  termYears: number;
  pmiPct: number;
  homeType: HomeType;
  sqft: number;
  bedrooms: number | null;
  yearBuilt: number | null;
  heating: HeatingCase;
  cooling: EnergyCooling | null;
  pool: boolean | null;
  liveInHome: boolean;
  floodZone: FloodZone;
  buyFlood: boolean;
  flDistrict: string | null;
  electricityUsdPerKwh: number;
  gasUsdPerMcf: number | null;
  hoaMonthly: number;
  waterMonthly: number;
  maintenancePct: number;
}

export type AssumptionKey = keyof Assumptions;

/** Where each default comes from, in the reader's words. */
export type DefaultSources = Partial<Record<AssumptionKey, string>>;

export const LINE_KEYS = ["loan", "pmi", "tax", "home_insurance", "flood_insurance", "hoa", "energy", "water", "maintenance"] as const;
export type LineKey = (typeof LINE_KEYS)[number];

export interface Line {
  key: LineKey;
  label: string;
  /** The yearly figure used (the user's, when set). */
  yearly: number;
  /** The estimate's tested range a year, when one exists (never for a figure the user set). */
  low: number | null;
  high: number | null;
  estimate: number | null;
  setByUser: boolean;
  source: string;
  notes: string[];
}

export interface Result {
  lines: Line[];
  monthly: number;
  yearly: number;
  /** The monthly total with each tested line at its low / high end; lines without a range at their figure. */
  monthlyLow: number;
  monthlyHigh: number;
  downPayment: number;
  loan: number;
}

export const NATIONAL = national as {
  generated: string;
  catalog_build: string;
  mortgage: { week_of: string; rate30_pct: number; rate15_pct: number; source: string };
  ca_voter_pct_median: number | null;
};

/** A typical living area by home type when the listing's is not entered (an assumption: enter the listing's area). */
export const TYPICAL_SQFT: Record<HomeType, number> = { house: 1800, townhouse: 1500, condo: 1100, mobile: 1200 };
/** The assumed yearly upkeep, a share of the price: the common 1 % rule. */
export const MAINTENANCE_PCT = 1;
/** Water, sewer and trash a month when the seller's bills are not known: an assumption, no national source is read. */
export const WATER_MONTHLY = 85;
/** Gas heat is the default where at least this many homes buy gas for each home that buys electricity (EIA's customer counts). */
export const GAS_SHARE_FOR_GAS_HEAT = 0.5;
export const DEFAULT_PRICE = 400_000;

export function defaultsFor(p: Place): { values: Assumptions; sources: DefaultSources } {
  const st = p.state;
  const c = p.county;
  const price = c?.area_tax?.median_value ?? DEFAULT_PRICE;
  const downPct = 20;
  const gasShare = st?.gas_share ?? 0;
  const heating: HeatingCase = st?.gas_usd_per_mcf !== null && st?.gas_usd_per_mcf !== undefined && gasShare >= GAS_SHARE_FOR_GAS_HEAT ? "gas_heat" : "electric_heat";
  const district = p.zipData.st === "FL" ? flDistrictOf(c) : null;
  const values: Assumptions = {
    price,
    downPct,
    ratePct: NATIONAL.mortgage.rate30_pct,
    termYears: 30,
    pmiPct: defaultPmiPct(downPct),
    homeType: "house",
    sqft: TYPICAL_SQFT.house,
    bedrooms: null,
    yearBuilt: null,
    heating,
    cooling: null,
    pool: null,
    liveInHome: true,
    floodZone: "outside",
    buyFlood: false,
    flDistrict: district?.code ?? null,
    electricityUsdPerKwh: st?.electricity_usd_per_kwh ?? 0.17,
    gasUsdPerMcf: st?.gas_usd_per_mcf ?? null,
    hoaMonthly: 0,
    waterMonthly: WATER_MONTHLY,
    maintenancePct: MAINTENANCE_PCT,
  };
  const sources: DefaultSources = {
    price: c?.area_tax?.median_value ? "The county's typical home value (Census ACS 5-year). Enter your price." : "A placeholder. Enter your price.",
    downPct: "20 %: the down payment that needs no mortgage insurance on a conventional loan.",
    ratePct: `${NATIONAL.mortgage.source}, 30-year fixed, week of ${NATIONAL.mortgage.week_of}.`,
    termYears: "The most common loan term.",
    pmiPct: "A typical yearly mortgage insurance rate for this down payment. A lender quotes yours.",
    homeType: "Choose the type of home.",
    sqft: "A typical size for this type of home. Enter the listing's living area.",
    bedrooms: "Not known: the survey's average is used.",
    yearBuilt: "Not known: the survey's mix of ages is used.",
    heating: heating === "gas_heat" ? "Gas: most homes in this state buy gas (EIA customer counts)." : "Electric: most homes in this state do not buy gas (EIA customer counts).",
    cooling: "Not known: the share of homes with air conditioning in this climate is used.",
    pool: "Not known: the survey's share is used.",
    liveInHome: "You will live in the home (applies homestead exemptions where modelled).",
    floodZone: "Outside FEMA's high-risk zone. Check the flood map for the address.",
    buyFlood: "Flood insurance is required only in the high-risk zone with a federally backed loan.",
    flDistrict: district ? `${district.name}: the district with the county's typical rate. Choose yours.` : undefined,
    electricityUsdPerKwh: st?.electricity_usd_per_kwh ? `EIA's ${st.electricity_year} state average residential price.` : "A national placeholder. Enter your utility's price.",
    gasUsdPerMcf: st?.gas_usd_per_mcf ? `EIA's ${st.gas_year} state average residential gas price, per thousand cubic feet.` : "Not published for this state.",
    hoaMonthly: "No public source. Enter the association's fee from the listing.",
    waterMonthly: "An assumption for a typical household. Ask for the seller's bills.",
    maintenancePct: "The common rule of 1 % of the price a year. Older homes often need more.",
  };
  return { values, sources };
}

/**
 * The defaults given the user's changes: some defaults follow another input (the size follows the home type, mortgage insurance the
 * down payment, flood insurance the flood zone). Returns the values used and the default of each.
 */
export function resolveAssumptions(p: Place, changed: Partial<Assumptions>): { values: Assumptions; defaults: Assumptions; sources: DefaultSources } {
  const base = defaultsFor(p);
  const defaults: Assumptions = { ...base.values };
  const sources = { ...base.sources };
  const pick = <K extends AssumptionKey>(k: K): Assumptions[K] => (k in changed ? (changed[k] as Assumptions[K]) : defaults[k]);
  defaults.sqft = TYPICAL_SQFT[pick("homeType")];
  defaults.pmiPct = defaultPmiPct(pick("downPct"));
  defaults.buyFlood = pick("floodZone") === "sfha";
  if (pick("floodZone") === "sfha") sources.buyFlood = "Included: a lender requires flood insurance in the high-risk zone.";
  const values = { ...defaults, ...changed } as Assumptions;
  return { values, defaults, sources };
}

const round10 = (v: number) => Math.round(v / 10) * 10;

export function calculate(p: Place, a: Assumptions, set: Partial<Record<LineKey, number>> = {}): Result {
  const st = p.zipData.st;
  const downPayment = (a.price * a.downPct) / 100;
  const loan = Math.max(a.price - downPayment, 0);
  const lines: Line[] = [];
  const push = (key: LineKey, label: string, est: { yearly: number; low: number | null; high: number | null } | null, source: string, notes: string[]) => {
    const user = set[key];
    const setByUser = typeof user === "number" && Number.isFinite(user);
    lines.push({
      key,
      label,
      yearly: setByUser ? user! : est?.yearly ?? 0,
      low: setByUser ? null : est?.low ?? null,
      high: setByUser ? null : est?.high ?? null,
      estimate: est?.yearly ?? null,
      setByUser,
      source: setByUser ? "Your figure" : source,
      notes: est || setByUser ? notes : ["No estimate for this place. Enter a figure."],
    });
  };

  const pay = monthlyPayment(loan, a.ratePct, a.termYears) * 12;
  push("loan", "Principal and interest", { yearly: pay, low: null, high: null }, `${a.ratePct} % for ${a.termYears} years on $${Math.round(loan).toLocaleString("en-US")}`, [
    `Down payment $${Math.round(downPayment).toLocaleString("en-US")} (${a.downPct} %).`,
    "Principal builds equity; it is a payment, not only a cost.",
  ]);

  const pmiYearly = a.downPct < 20 ? (loan * a.pmiPct) / 100 : 0;
  const endM = a.downPct < 20 ? pmiEndMonth(a.price, loan, a.ratePct, a.termYears) : 0;
  push("pmi", "Mortgage insurance", { yearly: pmiYearly, low: null, high: null }, a.downPct < 20 ? `${a.pmiPct} % of the loan a year` : "None at 20 % down or more", [
    a.downPct < 20 && endM ? `It ends automatically when the loan reaches 78 % of the price: about year ${Math.ceil(endM / 12)} on schedule.` : "No mortgage insurance at this down payment.",
  ]);

  const tax = propertyTax({ st, county: p.zipData.county, price: a.price, homeType: a.homeType, liveInHome: a.liveInHome, flDistrict: a.flDistrict }, p.county, NATIONAL.ca_voter_pct_median);
  push("tax", "Property tax", tax, tax?.source ?? "", tax ? [`Method: ${tax.method}; an effective rate of ${tax.effectivePct.toFixed(2)} %.`, ...tax.notes] : []);

  const hoi = homeownersInsurance(p.zipData, p.county);
  push("home_insurance", a.homeType === "condo" ? "Homeowners insurance (a condo policy usually costs less)" : "Homeowners insurance", hoi, hoi?.source ?? "", hoi?.notes ?? []);

  const flood = a.buyFlood ? floodInsurance(p.county, st, a.floodZone, a.liveInHome) : { yearly: 0, low: null, high: null, source: "Not included", notes: ["Not included. Turn it on to add the area's typical flood premium."] };
  push("flood_insurance", "Flood insurance", flood, flood?.source ?? "", flood?.notes ?? []);

  push("hoa", "HOA or condo fee", { yearly: a.hoaMonthly * 12, low: null, high: null }, `$${a.hoaMonthly} a month`, ["From the listing or the association. Ask what it covers (water, insurance, reserves) and about special assessments."]);

  const energy = energyCost({
    homeType: a.homeType,
    sqft: a.sqft,
    bedrooms: a.bedrooms,
    yearBuilt: a.yearBuilt,
    cooling: a.cooling,
    pool: a.pool,
    heating: a.heating,
    hdd: p.zipData.climate.hdd,
    cdd: p.zipData.climate.cdd,
    st,
    electricityUsdPerKwh: a.electricityUsdPerKwh,
    gasUsdPerMcf: a.gasUsdPerMcf,
  });
  push(
    "energy",
    "Electricity and gas",
    energy,
    "Spatia's formula fitted to EIA's 2020 Residential Energy Consumption Survey, at NOAA's climate normals and EIA's prices",
    energy
      ? [
          `About ${energy.kwh.toLocaleString("en-US")} kWh of electricity${energy.ccf !== null ? ` and ${energy.ccf.toLocaleString("en-US")} hundred cubic feet of gas` : ""} a year.`,
          `Climate at ${p.zipData.climate.station} (${p.zipData.climate.km} km away): ${p.zipData.climate.hdd.toLocaleString("en-US")} heating and ${p.zipData.climate.cdd.toLocaleString("en-US")} cooling degree days.`,
          "Most homes like this one fall in the range. It is not this home's bills: ask the seller for 12 months of bills.",
        ]
      : [],
  );

  push("water", "Water, sewer and trash", { yearly: a.waterMonthly * 12, low: null, high: null }, `$${a.waterMonthly} a month (assumption)`, ["No national source of water and sewer rates. Ask the seller or the utility."]);

  push("maintenance", "Maintenance and repairs", { yearly: (a.price * a.maintenancePct) / 100, low: null, high: null }, `${a.maintenancePct} % of the price a year`, [
    "A budget, not a bill: some years cost little, some need a roof or a water heater.",
  ]);

  const yearly = lines.reduce((s, l) => s + l.yearly, 0);
  const low = lines.reduce((s, l) => s + (l.low ?? l.yearly), 0);
  const high = lines.reduce((s, l) => s + (l.high ?? l.yearly), 0);
  return { lines, yearly, monthly: yearly / 12, monthlyLow: low / 12, monthlyHigh: high / 12, downPayment, loan };
}

export { round10 };
