/**
 * How strong the property-tax estimate is in each state (the study, docs/cost-to-own-study.html, measured 2026-11-19). The other
 * cost lines are national, so the tax decides the grade. Shown on the page as a tile map.
 */
export type Grade = "A" | "B" | "C" | "D";

export const GRADE_WORDS: Record<Grade, { name: string; text: string }> = {
  A: { name: "Tested", text: "A back-tested range for the tax in 27 counties, and the parcel's tax district and flat charges from an address." },
  B: { name: "Law and published rates", text: "The tax follows the state's rule and its published rates, without a tested range." },
  C: { name: "Area rate", text: "A sale does not change the taxed value, so the area's average rate is a fair start." },
  D: { name: "Area rate, likely low", text: "A sale ends an assessment cap, so a buyer usually pays more than the area's average." },
};

const D_STATES = ["AR", "DC", "GA", "MD", "MI", "NM", "OK", "SC", "WY"];

export function gradeOf(st: string): Grade {
  if (st === "FL") return "A";
  if (st === "CA" || st === "TX") return "B";
  if (D_STATES.includes(st)) return "D";
  return "C";
}

export const STATE_NAMES: Record<string, string> = {
  AK: "Alaska", AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California", CO: "Colorado", CT: "Connecticut", DC: "District of Columbia",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan", MN: "Minnesota", MO: "Missouri",
  MS: "Mississippi", MT: "Montana", NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NV: "Nevada", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia", VT: "Vermont", WA: "Washington",
  WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming",
};

/** A tile-grid map of the 50 states and DC: [state, column, row], 12 columns by 8 rows. */
export const TILES: [string, number, number][] = [
  ["AK", 0, 0], ["ME", 11, 0],
  ["VT", 10, 1], ["NH", 11, 1],
  ["WA", 1, 2], ["ID", 2, 2], ["MT", 3, 2], ["ND", 4, 2], ["MN", 5, 2], ["IL", 6, 2], ["WI", 7, 2], ["MI", 8, 2], ["NY", 9, 2], ["RI", 10, 2], ["MA", 11, 2],
  ["OR", 1, 3], ["NV", 2, 3], ["WY", 3, 3], ["SD", 4, 3], ["IA", 5, 3], ["IN", 6, 3], ["OH", 7, 3], ["PA", 8, 3], ["NJ", 9, 3], ["CT", 10, 3],
  ["CA", 1, 4], ["UT", 2, 4], ["CO", 3, 4], ["NE", 4, 4], ["MO", 5, 4], ["KY", 6, 4], ["WV", 7, 4], ["VA", 8, 4], ["MD", 9, 4], ["DE", 10, 4],
  ["AZ", 2, 5], ["NM", 3, 5], ["KS", 4, 5], ["AR", 5, 5], ["TN", 6, 5], ["NC", 7, 5], ["SC", 8, 5], ["DC", 9, 5],
  ["OK", 4, 6], ["LA", 5, 6], ["MS", 6, 6], ["AL", 7, 6], ["GA", 8, 6],
  ["HI", 0, 7], ["TX", 4, 7], ["FL", 9, 7],
];
