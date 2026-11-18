/** The loan: principal and interest, and private mortgage insurance (PMI) while the loan is above 80 % of the price. */

/** The monthly principal and interest of a fixed-rate loan. */
export function monthlyPayment(loan: number, ratePct: number, years: number): number {
  if (!(loan > 0) || !(years > 0)) return 0;
  const n = Math.round(years * 12);
  const r = ratePct / 100 / 12;
  if (r === 0) return loan / n;
  return (loan * r) / (1 - (1 + r) ** -n);
}

/**
 * The default yearly PMI rate, a share of the loan, by down payment. These are ASSUMPTIONS from the usual range of conventional
 * mortgage insurance (about 0.3 % to 1.5 % of the loan a year; it depends on the credit score, which the calculator does not ask).
 * A lender quotes the real rate. No PMI at 20 % down or more.
 */
export const PMI_BY_DOWN: readonly { minDownPct: number; ratePct: number }[] = [
  { minDownPct: 20, ratePct: 0 },
  { minDownPct: 15, ratePct: 0.3 },
  { minDownPct: 10, ratePct: 0.5 },
  { minDownPct: 5, ratePct: 0.7 },
  { minDownPct: 0, ratePct: 1.0 },
];

export function defaultPmiPct(downPct: number): number {
  return PMI_BY_DOWN.find((b) => downPct >= b.minDownPct)?.ratePct ?? 1.0;
}

/** The month PMI ends: the scheduled balance first reaches 78 % of the price (the Homeowners Protection Act's automatic end). */
export function pmiEndMonth(price: number, loan: number, ratePct: number, years: number): number | null {
  const target = price * 0.78;
  if (loan <= target) return 0;
  const pay = monthlyPayment(loan, ratePct, years);
  const r = ratePct / 100 / 12;
  let bal = loan;
  for (let m = 1; m <= years * 12; m++) {
    bal = bal * (1 + r) - pay;
    if (bal <= target) return m;
  }
  return null;
}
