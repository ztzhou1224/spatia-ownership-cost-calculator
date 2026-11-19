/**
 * Google Analytics through Spatia's Google Tag Manager container (owner, 2026-11-19: "Let's put every filed change on sentry or
 * google analytics I want to see which field user changed most"). The same container as Home and Crime (`GTM-N3B62N2R`, its GA4 tag
 * set up in the container), loaded by a production build on cost.runspatia.com only.
 *
 * Events carry the NAME of what changed, never a value, an address or a ZIP code:
 *   - `change_<field>` (e.g. `change_down_pct`) when the visitor changes an input, at most once per field per 1.5 s of typing;
 *   - `reset_<field>` when the visitor goes back to the estimate;
 *   - `set_line_<line>` / `reset_line_<line>` for a cost line the visitor types or clears;
 *   - `search_address` / `search_zip` for a search.
 * Each also carries `field` (or `line`) as a parameter. The page address Google gets has no query (`page_location` without `?zip=`).
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

/** One event (a no-op outside production on cost.runspatia.com). */
export function track(name: string, params: Record<string, string> = {}): void {
  if (!enabled) return;
  gtag("event", name.slice(0, 40), params);
}

const lastSent = new Map<string, number>();
/** A field change: once per field per 1.5 s, so typing "450000" is one event, not six. */
export function trackChange(field: string): void {
  const now = Date.now();
  const prev = lastSent.get(field) ?? 0;
  lastSent.set(field, now);
  if (now - prev < 1500) return;
  track(`change_${snake(field)}`, { field: snake(field) });
}

export function trackReset(field: string): void {
  lastSent.delete(field);
  track(`reset_${snake(field)}`, { field: snake(field) });
}
