/** Energy: Spatia Home's RECS 2020 formula (`energy.ts`, copied), at the climate normals and the state's published prices. */
import { estimateCase, type EnergyCooling, type EnergyHousing, type EnergyInputs, type HeatingCase, SQFT_MAX, SQFT_MIN, yearBandOf } from "./energy";
import type { HomeType } from "./tax";

const HOUSING: Record<HomeType, EnergyHousing> = { house: "detached", townhouse: "attached", condo: "apartment_5_plus", mobile: "mobile" };

export interface EnergyAssumptions {
  homeType: HomeType;
  sqft: number;
  bedrooms: number | null;
  yearBuilt: number | null;
  cooling: EnergyCooling | null;
  pool: boolean | null;
  heating: HeatingCase;
  hdd: number;
  cdd: number;
  st: string;
  electricityUsdPerKwh: number;
  gasUsdPerMcf: number | null;
}

export interface EnergyFigure {
  yearly: number;
  low: number;
  high: number;
  electricityYearly: number;
  gasYearly: number | null;
  kwh: number;
  ccf: number | null;
}

export function energyCost(a: EnergyAssumptions): EnergyFigure | null {
  if (!(a.sqft >= SQFT_MIN && a.sqft <= SQFT_MAX) || !(a.electricityUsdPerKwh > 0)) return null;
  const inputs: EnergyInputs = { housing: HOUSING[a.homeType], sqft: a.sqft, yearBand: yearBandOf(a.yearBuilt), bedrooms: a.bedrooms, cooling: a.cooling, pool: a.pool };
  const heating = a.heating === "gas_heat" && a.gasUsdPerMcf === null ? "electric_heat" : a.heating;
  const e = estimateCase(heating, inputs, { hdd: a.hdd, cdd: a.cdd, state: a.st }, { electricity_usd_per_kwh: a.electricityUsdPerKwh, gas_usd_per_mcf: a.gasUsdPerMcf });
  if (e.total_usd_year === null || e.total_usd_year_low === null || e.total_usd_year_high === null) return null;
  return { yearly: e.total_usd_year, low: e.total_usd_year_low, high: e.total_usd_year_high, electricityYearly: e.electricity_usd_year, gasYearly: e.gas_usd_year, kwh: e.kwh.typical, ccf: e.ccf?.typical ?? null };
}
