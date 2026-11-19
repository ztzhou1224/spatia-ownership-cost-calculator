/** The visitor's choice on the privacy notice, kept in this browser only. Saving is on unless the visitor says no. */
export type Consent = "ok" | "no";
const KEY = "spatia-cost-consent";

export function consentOf(): Consent | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "ok" || v === "no" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(c: Consent): void {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* no storage: the notice shows again next time */
  }
}

/** Whether the page may save the visitor's inputs. */
export function mayRecord(): boolean {
  return consentOf() !== "no";
}
