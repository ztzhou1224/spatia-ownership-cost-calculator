/**
 * Google Analytics through Spatia's Google Tag Manager container (owner, 2026-11-19: "Let's put every filed change on sentry or
 * google analytics I want to see which field user changed most"). The same container as Home and Crime (`GTM-N3B62N2R`, its GA4 tag
 * set up in the container), loaded by a production build on cost.runspatia.com only.
 *
 * Events carry what changed and the value it changed to (owner, the same day: "And to what number. Also recording the value"),
 * never the address or the ZIP code:
 *   - `change_<field>` (e.g. `change_down_pct`), 1.5 s after the visitor stops changing the field, with `field`, `new_value` (text),
 *     `new_value_num` (a number field only) and `default_value` (the estimate it replaced);
 *   - `reset_<field>` when the visitor goes back to the estimate, with the estimate as `new_value`;
 *   - `set_line_<line>` with the monthly figure typed (`new_value`, `new_value_num`, `default_value`) / `reset_line_<line>`;
 *   - `search_address` for a search (no query text).
 * The page address Google gets has no query (`page_location` without `?zip=`).
 */
export const GTM_ID = "GTM-N3B62N2R";
export const GTM_HOST = "cost.runspatia.com";

type TagWindow = Window & { dataLayer?: unknown[] };

let enabled = false;

/** `downPct` → `down_pct`; `home_insurance` stays. GA4 event names: letters, digits and underscores, at most 40 characters. */
export function snake(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 30);
}

function gtag(..._args: unknown[]): void {
  const w = window as TagWindow;
  (w.dataLayer = w.dataLayer || []).push(arguments);
}

export function initAnalytics(): void {
  if (!import.meta.env.PROD || typeof window === "undefined" || location.hostname !== GTM_HOST) return;
  enabled = true;
  const w = window as TagWindow;
  w.dataLayer = w.dataLayer || [];
  // the page address without its query; ads personalization off, as on Spatia's other sites
  gtag("set", { page_location: `${location.origin}${location.pathname}`, page_referrer: document.referrer ? new URL(document.referrer).origin : "", allow_ad_personalization_signals: false });
  w.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  document.head.appendChild(s);
}

/** A value as GA4 takes it: a string of at most 100 characters; a list joined by commas; "not known" for null. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined) return "not known";
  if (Array.isArray(v)) return v.join(",").slice(0, 100);
  return String(v).slice(0, 100);
}

/** One event (a no-op outside production on cost.runspatia.com). */
export function track(name: string, params: Record<string, string | number> = {}): void {
  if (!enabled) return;
  gtag("event", name.slice(0, 40), params);
}

/** The value params: `new_value` (text, every field), `new_value_num` (numbers only) and the estimate it replaced. */
function valueParams(value: unknown, estimate: unknown): Record<string, string | number> {
  const p: Record<string, string | number> = { new_value: valueText(value), default_value: valueText(estimate) };
  if (typeof value === "number" && Number.isFinite(value)) p.new_value_num = value;
  return p;
}

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => void }>();
/**
 * A field change, sent 1.5 s after the visitor stops changing that field, with the value it ended at: typing "450000" is one event
 * with 450000, not six. A change still waiting when the tab is hidden is sent then.
 */
export function trackChange(field: string, value: unknown, estimate: unknown): void {
  clearTimeout(pending.get(field)?.timer);
  const send = () => {
    pending.delete(field);
    track(`change_${snake(field)}`, { field: snake(field), ...valueParams(value, estimate) });
  };
  pending.set(field, { timer: setTimeout(send, 1500), send });
}

if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    for (const p of [...pending.values()]) {
      clearTimeout(p.timer);
      p.send();
    }
  });

/** Back to the estimate: a waiting change of the field is dropped; the event carries the estimate. */
export function trackReset(field: string, estimate: unknown): void {
  clearTimeout(pending.get(field)?.timer);
  pending.delete(field);
  track(`reset_${snake(field)}`, { field: snake(field), new_value: valueText(estimate) });
}

/** A cost line the visitor typed (a month, as they typed it), or cleared. */
export function trackLine(line: string, monthly: number | null, estimateMonthly: number | null): void {
  if (monthly === null) track(`reset_line_${line}`, { line });
  else track(`set_line_${line}`, { line, new_value: valueText(Math.round(monthly)), new_value_num: Math.round(monthly), default_value: valueText(estimateMonthly === null ? null : Math.round(estimateMonthly)) });
}
