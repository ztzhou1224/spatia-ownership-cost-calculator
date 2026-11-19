/**
 * The page's recorder (owner direction 2026-11-19): a snapshot when a place loads, another 2.5 s after the visitor stops changing
 * inputs, and a last one when the tab is hidden with unsent changes. Failures are silent: recording never blocks the calculator.
 */
import { useEffect, useRef } from "react";
import national from "../data/national.generated.json";
import type { Assumptions, LineKey, Result } from "./calc";
import { consentOf, mayRecord } from "./consent";
import { makePayload, type RecordKind } from "./record";
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

let seq = 0;
const session = typeof window === "undefined" ? "" : sessionId();

function send(body: string, beacon: boolean) {
  try {
    if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/record", new Blob([body], { type: "application/json" }));
    else void fetch("/api/record", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => undefined);
  } catch {
    /* recording never blocks the page */
  }
}

export function useRecorder(s: { place: Place; query: string; values: Assumptions; changed: Partial<Assumptions>; setLines: Partial<Record<LineKey, number>>; result: Result }) {
  const latest = useRef(s);
  latest.current = s;
  const dirty = useRef(false);
  const placeKey = `${s.place.zip}|${s.place.facts?.label ?? ""}`;
  const shotKey = JSON.stringify([s.changed, s.setLines]);

  const shoot = (kind: RecordKind, beacon = false) => {
    if (!mayRecord()) return;
    const c = latest.current;
    const body = JSON.stringify(
      makePayload({ session, seq: ++seq, kind, query: c.query, place: c.place, values: c.values, changed: Object.keys(c.changed) as (keyof Assumptions)[], setLines: c.setLines, result: c.result, build: (national as { catalog_build: string }).catalog_build.slice(0, 80) }),
    );
    dirty.current = false;
    send(body, beacon);
  };

  // a place loaded: sent at once when the visitor accepted on an earlier visit; for a first visit (no choice yet) it is held and
  // goes out with the first edit or when the tab is hidden, so a visitor who declines first is never saved
  useEffect(() => {
    if (consentOf() === "ok") shoot("load");
    else dirty.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey]);

  // the visitor changed something: one snapshot after 2.5 s of quiet
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    dirty.current = true;
    const t = setTimeout(() => shoot("edit"), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotKey]);

  // the tab is hidden with unsent changes
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && dirty.current) shoot("leave", true);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
