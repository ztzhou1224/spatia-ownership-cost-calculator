/**
 * The one-time costs at closing, apart from the monthly total (owner 2026-11-20, item 2 of the comparison). Three lines, each one the
 * user can set:
 *
 *   lender_title   what buyers in the state paid the lender and for the title and other services on a loan of this size: HMDA's
 *                  "total loan costs" (the Closing Disclosure's section D), the median; the 10th–90th percentile range only where the
 *                  year before's range held the latest year's loans (`scripts/build-data.ts` stage `closing`)
 *   mortgage_tax   the taxes on the mortgage that state law sets (Florida: the documentary stamp tax on the note and the nonrecurring
 *                  intangible tax); Texas has none; elsewhere not modelled
 *   prepaids       the first bills paid ahead and the escrow deposit: an assumption, made from the monthly lines
 *
 * Cash to close = the down payment + these lines. Never a quote: the lender's Loan Estimate gives the real figures.
 */
import closing from "../data/closing.generated.json";
import type { Assumptions, LineKey, Result } from "./calc";
import type { Place } from "./types";

export const CLOSING_KEYS = ["lender_title", "mortgage_tax", "prepaids"] as const;
export type ClosingKey = (typeof CLOSING_KEYS)[number];
/** The figures the user typed: a monthly line's yearly figure, or a closing line's one-time figure. */
export type SetLines = Partial<Record<LineKey | ClosingKey, number>>;

export interface ClosingLine {
  key: ClosingKey;
  label: string;
  /** The one-time figure used (the user's, when set). */
  amount: number;
  low: number | null;
  high: number | null;
  estimate: number | null;
  setByUser: boolean;
  source: string;
  notes: string[];
}

export interface Closing {
  lines: ClosingLine[];
  /** The lines' sum: what closing costs on top of the down payment. */
  total: number;
  downPayment: number;
  cashToClose: number;
}

interface ClosingRow { band: string; n: number; p10: number; p50: number; p90: number; tested: { n: number; coverage: number } | null; passed: boolean }
interface ClosingFile {
  year: number;
  tested_on: string;
  bands: { name: string; low: number; high: number | null }[];
  states: Record<string, ClosingRow[]>;
}
const FILE = closing as unknown as ClosingFile;

/** Florida's taxes on a new mortgage: $0.35 per $100 of the note (Fla. Stat. § 201.08) and 2 mills on the loan (§ 199.133). */
export const FL_NOTE_STAMP_PCT = 0.35;
export const FL_INTANGIBLE_PCT = 0.2;
/** The escrow deposit and prepaid interest: assumptions (lenders' common practice; RESPA caps the escrow cushion at two months). */
export const ESCROW_TAX_MONTHS = 3;
export const ESCROW_INSURANCE_MONTHS = 2;
export const PREPAID_INTEREST_DAYS = 15;

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

/** The state's HMDA row for the loan's size band, or null. */
export function lenderTitleRow(st: string, loan: number): ClosingRow | null {
  const band = FILE.bands.find((b) => loan >= b.low && (b.high === null || loan < b.high));
  return FILE.states[st]?.find((r) => r.band === band?.name) ?? null;
}

export function closingCosts(p: Place, a: Assumptions, r: Result, set: Partial<Record<ClosingKey, number>> = {}): Closing {
  const st = p.zipData.st;
  const loan = r.loan;
  const lines: ClosingLine[] = [];
  const push = (key: ClosingKey, label: string, est: { amount: number; low: number | null; high: number | null } | null, source: string, notes: string[]) => {
    const user = set[key];
    const setByUser = typeof user === "number" && Number.isFinite(user);
    lines.push({
      key,
      label,
      amount: setByUser ? user! : est?.amount ?? 0,
      low: setByUser ? null : est?.low ?? null,
      high: setByUser ? null : est?.high ?? null,
      estimate: est?.amount ?? null,
      setByUser,
      source: setByUser ? "Your figure" : source,
      notes: est || setByUser ? notes : [...notes, "No estimate for this place. Enter a figure."],
    });
  };

  // 1. The lender, the title and the other services.
  if (loan <= 0) {
    push("lender_title", "Lender, title and other services", { amount: 0, low: null, high: null }, "No loan", ["No loan: no lender fees. Title and settlement fees still apply: ask the title company."]);
  } else {
    const row = lenderTitleRow(st, loan);
    const tested = !!row?.passed;
    push(
      "lender_title",
      "Lender, title and other services",
      row ? { amount: row.p50, low: tested ? row.p10 : null, high: tested ? row.p90 : null } : null,
      `HMDA ${FILE.year}: the median "total loan costs" of ${row ? row.n.toLocaleString("en-US") : "the"} conventional purchase loans of this size in the state`,
      [
        "What buyers paid the lender (origination charges and discount points) and for the services on the loan (appraisal, credit report, lender's title insurance, settlement fee), from the Closing Disclosures that lenders report under HMDA.",
        "Before lender credits and seller credits. An FHA or VA loan has other fees.",
        tested
          ? `8 in 10 of these loans paid ${usd(row!.p10)} to ${usd(row!.p90)}. Tested: the same range of the year before held ${Math.round(row!.tested!.coverage * 100)} % of ${row!.tested!.n.toLocaleString("en-US")} loans in ${FILE.year}.`
          : "No tested range for this state and loan size.",
        "The owner's title policy is not in this figure; who pays it differs by state and county.",
      ],
    );
  }

  // 2. Taxes on the mortgage that state law sets.
  if (st === "FL") {
    const stamps = (loan * FL_NOTE_STAMP_PCT) / 100;
    const intangible = (loan * FL_INTANGIBLE_PCT) / 100;
    push("mortgage_tax", "Taxes on the mortgage", { amount: stamps + intangible, low: null, high: null }, "Florida Statutes § 201.08 and § 199.133", [
      `The documentary stamp tax on the note, $0.35 per $100 of the loan (${usd(stamps)}), and the intangible tax, 0.2 % of the loan (${usd(intangible)}). Both are set by law.`,
      "The documentary stamp tax on the deed (70 cents per $100 of the price, 60 cents in Miami-Dade) is usually the seller's in Florida; it is not in this figure.",
      "Recording fees are not in this figure.",
    ]);
  } else if (st === "TX") {
    push("mortgage_tax", "Taxes on the mortgage", { amount: 0, low: null, high: null }, "Texas has no transfer tax and no mortgage tax", ["Recording fees are not in this figure."]);
  } else {
    push("mortgage_tax", "Taxes on the mortgage or the transfer", null, "Not modelled for this state", [
      st === "CA"
        ? "California's transfer taxes (county and city) are usually the seller's, but the custom differs by county. Ask the title company."
        : "Transfer and mortgage recording taxes, and who pays them, differ by state and county. Ask the title company.",
    ]);
  }

  // 3. Prepaid bills and the escrow deposit (an assumption from the monthly lines).
  const yearly = (k: string) => r.lines.find((l) => l.key === k)?.yearly ?? 0;
  const insurance = yearly("home_insurance") + yearly("flood_insurance");
  const tax = yearly("tax") + yearly("flat_charges");
  const interest = (loan * (a.ratePct / 100) * PREPAID_INTEREST_DAYS) / 365;
  const escrow = loan > 0 ? (tax * ESCROW_TAX_MONTHS) / 12 + (insurance * ESCROW_INSURANCE_MONTHS) / 12 : 0;
  push("prepaids", "Prepaid bills and escrow deposit", { amount: insurance + escrow + (loan > 0 ? interest : 0), low: null, high: null }, "An assumption made from the monthly lines", [
    `The first year of insurance (${usd(insurance)})${loan > 0 ? `, ${ESCROW_TAX_MONTHS} months of property tax and ${ESCROW_INSURANCE_MONTHS} months of insurance into the escrow account (${usd(escrow)}), and ${PREPAID_INTEREST_DAYS} days of interest (${usd(interest)})` : ""}.`,
    "Not an extra cost: it pays bills you would pay anyway, ahead. The months differ with the closing date and the tax due dates.",
  ]);

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total, downPayment: r.downPayment, cashToClose: r.downPayment + total };
}
