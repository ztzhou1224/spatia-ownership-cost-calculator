import type { AddressFacts } from "./lookup";
import type { TxUnit } from "./texas";

/** The data the calculator reads for one ZIP (built by `scripts/build-data.ts`; see `public/data/`). */

export interface ZipData {
  st: string;
  /** The county holding the largest share of the ZIP's land (Census 2020 ZCTA–county relationship). */
  county: string;
  lat: number;
  lon: number;
  /** Treasury FIO's average homeowners premium per policy in the ZIP, its latest year (HO-3 / HO-5, owner-occupied). */
  hoi: { usd: number; year: number } | null;
  /** NOAA's 1991–2020 normals at the nearest station with both figures. */
  climate: { station: string; hdd: number; cdd: number; km: number };
}

export interface FloodFigure {
  p25: number;
  p50: number;
  p75: number;
  n: number;
}

export interface FlDistrict {
  code: string;
  name: string;
  school: number;
  nonschool: number;
  parcels: number;
}

export interface CountyData {
  /** ACS 5-year: owners' median real estate taxes ÷ median home value, owner-weighted over the county's tracts. */
  area_tax: { rate_pct: number; tracts: number; owners: number; median_value?: number; scope?: "county" | "state" } | null;
  /** NFIP's new-business Risk Rating 2.0 premiums of similar homes, keyed `<zone_group>:<primary_residence>`. */
  flood: Record<string, FloodFigure> | null;
  fl_districts?: FlDistrict[];
  fl_default_district?: string;
  ca_voter_pct?: number;
  /** The median of the county's published ZIP premiums (Treasury FIO), for a ZIP Treasury does not publish. */
  hoi_county?: { usd: number; year: number; zips: number };
  /** Texas: the Comptroller's taxing units with value in the county (never summed over the county). */
  tx_units?: TxUnit[];
}

export interface StateData {
  electricity_usd_per_kwh: number | null;
  electricity_year: number | null;
  gas_usd_per_mcf: number | null;
  gas_year: number | null;
  gas_share: number | null;
}

export interface Place {
  zip: string;
  zipData: ZipData;
  county: CountyData | null;
  state: StateData | null;
  /** The address lookup's facts, when the user entered an address. */
  facts?: AddressFacts | null;
}
