/**
 * The page's link to the Worker's calculator (owner, 2026-11-19: "every calculation needs to go through backend"). Each change of
 * the place, the inputs or the set lines is posted to `POST /api/estimate` 300 ms after the last one; the Worker calculates, saves
 * the combination and answers. The page shows the Worker's answer; its own result (the same code) shows only until the answer
 * arrives, or when the Worker cannot be reached.
 */
import { useEffect, useRef, useState } from "react";
import type { Assumptions, LineKey } from "./calc";
import { consentOf } from "./consent";
import type { EstimateAnswer, EstimateRequest } from "./record";
import type { Place } from "./types";

function sessionId(): string {
  try {
    const got = sessionStorage.getItem("spatia-cost-session");
    if (got) return got;
    const id = crypto.randomUUID();
    sessionStorage.setItem("spatia-cost-session", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export const session = typeof window === "undefined" ? "" : sessionId();
let seq = 0;

/** Delete this visit's saved calculations (the visitor chose "Do not save my inputs"). */
export function forgetSession(): void {
  void fetch("/api/forget", { method: "POST", body: JSON.stringify({ session }), headers: { "Content-Type": "application/json" } }).catch(() => undefined);
}

export type ServerEstimate = Extract<EstimateAnswer, { ok: true }>;

export function useServerEstimate(s: { place: Place; query: string; changed: Partial<Assumptions>; setLines: Partial<Record<LineKey, number>> }): { answer: ServerEstimate | null; key: string } {
  const key = JSON.stringify([s.place.zip, s.place.facts?.label ?? "", s.changed, s.setLines]);
  const [state, setState] = useState<{ answer: ServerEstimate | null; key: string }>({ answer: null, key: "" });
  const latest = useRef(s);
  latest.current = s;
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const c = latest.current;
      const consent = consentOf();
      const body: EstimateRequest = { session, seq: ++seq, query: c.query, zip: c.place.zip, facts: c.place.facts ?? null, changed: c.changed, setLines: c.setLines, record: consent === "no" ? "no" : consent === "ok" ? "yes" : "pending" };
      try {
        const r = await fetch("/api/estimate", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, signal: ctrl.signal });
        const a = (await r.json()) as EstimateAnswer;
        if (a.ok) setState({ answer: a, key });
      } catch {
        /* the page keeps its own result */
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { answer: null, key };
}
