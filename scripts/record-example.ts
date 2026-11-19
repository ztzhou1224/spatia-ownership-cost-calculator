/**
 * Records the page's example address: one call to the live lookup, then RentCast's parts (the property record and the listing) are
 * removed, so the stored example holds only public records (the geocoder's label, FEMA's zone, Florida's roll, its tax district and
 * its flat charges). Run: `pnpm tsx scripts/record-example.ts` (about $0.12 of RentCast calls on the live Worker).
 */
import { writeFileSync } from "node:fs";
import type { LookupAnswer } from "../src/lib/lookup";

const ADDRESS = "1023 W Gore St, Orlando, FL";
const ORIGIN = process.env.LOOKUP_ORIGIN ?? "https://cost.runspatia.com";

const r = await fetch(`${ORIGIN}/api/lookup?address=${encodeURIComponent(ADDRESS)}`);
const a = (await r.json()) as LookupAnswer;
if (!a.ok) throw new Error(`lookup refused: ${a.reason}`);
const facts = { ...a.facts, property: null, listing: null };
const out = {
  note: "Recorded by scripts/record-example.ts from the live lookup; RentCast's property record and listing removed. Never hand-edit.",
  recorded: new Date().toISOString().slice(0, 10),
  facts,
};
writeFileSync(new URL("../src/data/example-address.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(`example: ${facts.label}`);
