import { useEffect, useMemo, useState, type ReactNode } from "react";
import { calculate, LINE_KEYS, NATIONAL, resolveAssumptions, type Assumptions, type Line, type LineKey } from "./lib/calc";
import { loadAddress, loadPlace } from "./lib/data";
import { useServerEstimate } from "./lib/recorder";
import { ConsentBanner } from "./Privacy";
import type { TxUnit } from "./lib/texas";
import type { Place } from "./lib/types";

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const usd10 = (v: number) => usd(Math.round(v / 10) * 10);

type Changed = Partial<Assumptions>;

const ERRORS: Record<string, string> = {
  format: "Enter an address, or a 5-digit ZIP code.",
  unknown: "We have no data for this ZIP code.",
  not_found: "We could not find this address. Check it, or enter a ZIP code.",
  not_trusted: "We could not place this address on a building. Enter a ZIP code for the area's estimates.",
  unavailable: "The address lookup is not available now. Enter a ZIP code.",
  bad_request: "Enter an address, or a 5-digit ZIP code.",
  busy: "Too many lookups in a minute. Wait a moment, or enter a ZIP code.",
};

export function App() {
  const [zipInput, setZipInput] = useState(() => new URLSearchParams(location.search).get("zip") ?? "");
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<Changed>({});
  const [setLines, setSetLines] = useState<Partial<Record<LineKey, number>>>({});
  const [query, setQuery] = useState("");

  const [busy, setBusy] = useState(false);
  async function load(input: string) {
    const q = input.trim();
    setBusy(true);
    const r = /^\d{5}$/.test(q) ? await loadPlace(q) : await loadAddress(q);
    setBusy(false);
    if (!r.ok) {
      setError(ERRORS[r.reason]);
      return;
    }
    setError(null);
    setQuery(q);
    setPlace(r.place);
    setChanged((c) => ("price" in c ? { price: c.price } : {}));
    setSetLines({});
    const u = new URL(location.href);
    u.searchParams.set("zip", r.place.zip);
    history.replaceState(null, "", u);
  }
  useEffect(() => {
    if (/^\d{5}$/.test(zipInput)) void load(zipInput);
    // only on the first render: a ZIP in the link
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <header className="head">
        <p className="eyebrow">Spatia · pilot</p>
        <h1>What will this home cost to own?</h1>
        <p className="lead">Every figure starts from an estimate for the place. Change any input, or type your own figure for any cost.</p>
        <form
          className="zip"
          onSubmit={(e) => {
            e.preventDefault();
            void load(zipInput);
          }}
        >
          <label htmlFor="zip">Address or ZIP code</label>
          <input id="zip" autoComplete="street-address" maxLength={200} placeholder="2910 W Fair Oaks Ave, Tampa, FL" value={zipInput} onChange={(e) => setZipInput(e.target.value)} />
          <button type="submit" disabled={busy}>
            {busy ? "Looking up…" : "Estimate"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </header>
      {place && <Calculator place={place} query={query} changed={changed} setChanged={setChanged} setLines={setLines} setSetLines={setSetLines} />}
      <footer className="foot">
        Data: U.S. Census Bureau ACS and ZCTA files; U.S. Treasury FIO; FEMA NFIP; EIA (RECS 2020, Form 861, natural gas prices); NOAA climate normals; Florida DOR; California
        BOE and county rate books; {NATIONAL.mortgage.source}. Built {NATIONAL.generated} from Spatia's data service (build {NATIONAL.catalog_build.slice(0, 15)}). Estimates, not quotes.{" "}
        <a href="/privacy">Privacy</a>
      </footer>
      <ConsentBanner />
    </div>
  );
}

function Calculator(props: { place: Place; query: string; changed: Changed; setChanged: (f: (c: Changed) => Changed) => void; setLines: Partial<Record<LineKey, number>>; setSetLines: (f: (s: Partial<Record<LineKey, number>>) => Partial<Record<LineKey, number>>) => void }) {
  const { place, changed, setChanged, setLines, setSetLines } = props;
  // the Worker calculates (and saves) every combination; the page's own result shows until its answer arrives
  const local = useMemo(() => {
    const r = resolveAssumptions(place, changed);
    return { ...r, result: calculate(place, r.values, setLines) };
  }, [place, changed, setLines]);
  const server = useServerEstimate({ place, query: props.query, changed, setLines }).answer;
  const { values, defaults, sources, result } = server ?? local;
  const st = place.zipData.st;

  const field = <K extends keyof Assumptions>(k: K) => ({
    value: values[k],
    isChanged: k in changed,
    source: sources[k],
    onChange: (v: Assumptions[K]) => setChanged((c) => ({ ...c, [k]: v })),
    onReset: () =>
      setChanged((c) => {
        const n = { ...c };
        delete n[k];
        return n;
      }),
    defaultLabel: defaults[k],
  });

  const districts = place.county?.fl_districts ?? [];

  return (
    <main className="grid">
      <section className="inputs" aria-label="Inputs">
        <p className="where">
          {place.facts ? <strong>{place.facts.label}</strong> : <>ZIP {place.zip}</>} · {st} · county {place.zipData.county}
          {place.facts && (
            <>
              <br />
              From the address: FEMA flood zone {place.facts.floodZoneCode ?? "not mapped"}
              {place.facts.roll
                ? `; the county roll's ${place.facts.roll.useLabel ?? "record"}${place.facts.roll.justValue ? `, just value $${place.facts.roll.justValue.toLocaleString("en-US")} (${place.facts.roll.rollYear}; not a price)` : ""}`
                : st === "FL"
                  ? "; no single parcel on the county roll at this point"
                  : ""}
              {place.facts.flatCharges?.amount !== null && place.facts.flatCharges?.amount !== undefined
                ? `; flat charges on the county tax roll $${place.facts.flatCharges.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })} a year`
                : ""}
              {place.facts.listing ? `; listed for sale at $${place.facts.listing.price.toLocaleString("en-US")}${place.facts.listing.listedDate ? ` since ${place.facts.listing.listedDate}` : ""}` : ""}
              {place.facts.property
                ? `; RentCast's property record: ${place.facts.property.propertyType ?? "type not stated"}${place.facts.property.bedrooms !== null ? `, ${place.facts.property.bedrooms} bedrooms` : ""}${place.facts.property.squareFootage ? `, ${place.facts.property.squareFootage.toLocaleString("en-US")} sq ft` : ""}${place.facts.property.yearBuilt ? `, built ${place.facts.property.yearBuilt}` : ""}`
                : "; no RentCast property record matched this address"}
              .
            </>
          )}
        </p>
        <Group title="The loan">
          <Num label="Price" prefix="$" step={5000} {...field("price")} />
          <Num label="Down payment" suffix="%" step={1} {...field("downPct")} />
          <Num label="Interest rate" suffix="%" step={0.125} {...field("ratePct")} />
          <Num label="Loan term" suffix="years" step={5} {...field("termYears")} />
          {values.downPct < 20 && <Num label="Mortgage insurance" suffix="% a year" step={0.05} {...field("pmiPct")} />}
        </Group>
        <Group title="The home">
          <Select label="Type" options={[["house", "House"], ["townhouse", "Townhouse"], ["condo", "Condo"], ["mobile", "Manufactured home"]]} {...field("homeType")} />
          <Num label="Living area" suffix="sq ft" step={50} {...field("sqft")} />
          <OptNum label="Bedrooms" step={1} {...field("bedrooms")} />
          <OptNum label="Year built" step={1} {...field("yearBuilt")} />
          <Select label="Heating" options={[["electric_heat", "Electric or heat pump"], ["gas_heat", "Natural gas"]]} {...field("heating")} />
          <Select label="Air conditioning" options={[[null, "Not known"], ["central", "Central"], ["room", "Room units"], ["any", "Yes, type not known"], ["none", "None"]]} {...field("cooling")} />
          <Select label="Pool" options={[[null, "Not known"], [true, "Yes"], [false, "No"]]} {...field("pool")} />
        </Group>
        <Group title="You and the place">
          <Select label="Will you live in the home?" options={[[true, "Yes, my main home"], [false, "No"]]} {...field("liveInHome")} />
          <Select label="FEMA flood zone" options={[["outside", "Outside the high-risk zone"], ["sfha", "High-risk zone (A or V)"]]} {...field("floodZone")} />
          <Select label="Flood insurance" options={[[true, "Include"], [false, "Leave out"]]} {...field("buyFlood")} />
          {st === "TX" && (place.county?.tx_units?.length ?? 0) > 0 && (
            <TxUnits units={place.county!.tx_units!} value={values.txUnits} isChanged={"txUnits" in changed} source={sources.txUnits} onChange={(v) => setChanged((c) => ({ ...c, txUnits: v }))} onReset={field("txUnits").onReset} />
          )}
          {st === "FL" && districts.length > 0 && (
            <Select label="Tax district" options={districts.map((d) => [d.code, `${d.name} (${(d.school + d.nonschool).toFixed(2)} mills)`] as [string, string])} {...field("flDistrict")} />
          )}
        </Group>
        <Group title="Prices and other costs">
          <Num label="Electricity price" prefix="$" suffix="per kWh" step={0.01} {...field("electricityUsdPerKwh")} />
          {values.heating === "gas_heat" && <OptNum label="Gas price" prefix="$" suffix="per 1,000 cu ft" step={0.5} {...field("gasUsdPerMcf")} />}
          <Num label="Flat charges on the tax bill" prefix="$" suffix="a year" step={10} {...field("flatChargesYearly")} />
          <Num label="HOA or condo fee" prefix="$" suffix="a month" step={10} {...field("hoaMonthly")} />
          <Num label="Water, sewer, trash" prefix="$" suffix="a month" step={5} {...field("waterMonthly")} />
          <Num label="Maintenance" suffix="% of price a year" step={0.25} {...field("maintenancePct")} />
        </Group>
      </section>

      <section className="results" aria-label="Costs">
        <div className="total">
          <p className="total-label">A month to own</p>
          <p className="total-figure">{usd10(result.monthly)}</p>
          <p className="total-range">
            {Math.round(result.monthlyLow / 10) !== Math.round(result.monthlyHigh / 10) ? (
              <>
                With each tested line at the low or high end of its range: {usd10(result.monthlyLow)} to {usd10(result.monthlyHigh)} a month.
              </>
            ) : (
              <>No tested range for this place.</>
            )}{" "}
            {usd10(result.yearly)} a year. Cash at closing: {usd(result.downPayment)} down payment, plus closing costs.
          </p>
        </div>
        <ul className="lines">
          {LINE_KEYS.map((k) => {
            const l = result.lines.find((x) => x.key === k)!;
            return (
              <LineRow
                key={k}
                line={l}
                onSet={(v) => setSetLines((s) => ({ ...s, [k]: v }))}
                onReset={() =>
                  setSetLines((s) => {
                    const n = { ...s };
                    delete n[k];
                    return n;
                  })
                }
              />
            );
          })}
        </ul>
      </section>
    </main>
  );
}

const TX_GROUPS: [TxUnit["cls"], string][] = [
  ["county", "County"],
  ["school_district", "School district"],
  ["city", "City"],
  ["special_district", "Special districts (MUD, ESD, water, hospital, college)"],
];

function TxUnits(p: { units: TxUnit[]; value: string[]; isChanged: boolean; source?: string; onChange: (v: string[]) => void; onReset: () => void }) {
  const [filter, setFilter] = useState("");
  const toggle = (id: string, on: boolean) => p.onChange(on ? [...p.value, id] : p.value.filter((x) => x !== id));
  const rate = p.units.filter((u) => p.value.includes(u.id)).reduce((s, u) => s + u.rate, 0);
  return (
    <div className={`field${p.isChanged ? " changed" : ""}`}>
      <span className="label">Taxing units on the bill</span>
      <p className="hint">
        {p.value.length} chosen: ${rate.toFixed(4)} per $100 of value. {p.isChanged ? "" : p.source}{" "}
        {p.isChanged && (
          <button type="button" className="link" onClick={p.onReset}>
            Use the estimate
          </button>
        )}
      </p>
      {TX_GROUPS.map(([cls, title]) => {
        const list = p.units.filter((u) => u.cls === cls).filter((u) => cls === "county" || p.value.includes(u.id) || !filter || u.name.toLowerCase().includes(filter.toLowerCase()));
        if (!list.length) return null;
        const body = (
          <ul className="units">
            {list.map((u) => (
              <li key={u.id}>
                <label>
                  <input type="checkbox" checked={p.value.includes(u.id)} onChange={(e) => toggle(u.id, e.target.checked)} /> {u.name} <span className="affix">{u.rate.toFixed(4)}</span>
                </label>
              </li>
            ))}
          </ul>
        );
        return cls === "county" ? (
          <div key={cls}>{body}</div>
        ) : (
          <details key={cls} open={cls === "school_district"}>
            <summary>
              {title} ({p.units.filter((u) => u.cls === cls && p.value.includes(u.id)).length} of {p.units.filter((u) => u.cls === cls).length} chosen)
            </summary>
            {body}
          </details>
        );
      })}
      {p.units.length > 30 && <input className="unit-filter" placeholder="Find a unit by name" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a taxing unit" />}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

interface FieldProps<T> {
  label: string;
  value: T;
  isChanged: boolean;
  source?: string;
  onChange: (v: T) => void;
  onReset: () => void;
  defaultLabel: T;
}

function Shell({ label, id, isChanged, source, onReset, defaultText, children }: { label: string; id: string; isChanged: boolean; source?: string; onReset: () => void; defaultText: string; children: ReactNode }) {
  return (
    <div className={`field${isChanged ? " changed" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="control">{children}</div>
      <p className="hint">
        {isChanged ? (
          <>
            Your figure. Estimate: {defaultText}.{" "}
            <button type="button" className="link" onClick={onReset}>
              Use the estimate
            </button>
          </>
        ) : (
          source
        )}
      </p>
    </div>
  );
}

const idOf = (label: string) => `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

function Num(p: FieldProps<number> & { prefix?: string; suffix?: string; step: number }) {
  const id = idOf(p.label);
  return (
    <Shell label={p.label} id={id} isChanged={p.isChanged} source={p.source} onReset={p.onReset} defaultText={`${p.prefix ?? ""}${p.defaultLabel.toLocaleString("en-US")}${p.suffix ? ` ${p.suffix}` : ""}`}>
      {p.prefix && <span className="affix">{p.prefix}</span>}
      <input id={id} type="number" inputMode="decimal" step={p.step} min={0} value={Number.isFinite(p.value) ? p.value : ""} onChange={(e) => e.target.value !== "" && p.onChange(Number(e.target.value))} />
      {p.suffix && <span className="affix">{p.suffix}</span>}
    </Shell>
  );
}

function OptNum(p: FieldProps<number | null> & { prefix?: string; suffix?: string; step: number }) {
  const id = idOf(p.label);
  return (
    <Shell label={p.label} id={id} isChanged={p.isChanged} source={p.source} onReset={p.onReset} defaultText={p.defaultLabel === null ? "not known" : `${p.prefix ?? ""}${p.defaultLabel.toLocaleString("en-US")}`}>
      {p.prefix && <span className="affix">{p.prefix}</span>}
      <input id={id} type="number" inputMode="decimal" step={p.step} min={0} placeholder="Not known" value={p.value ?? ""} onChange={(e) => p.onChange(e.target.value === "" ? null : Number(e.target.value))} />
      {p.suffix && <span className="affix">{p.suffix}</span>}
    </Shell>
  );
}

type Opt<T> = [T, string];
function Select<T extends string | number | boolean | null>(p: FieldProps<T> & { options: Opt<T>[] }) {
  const id = idOf(p.label);
  const key = (v: T) => JSON.stringify(v);
  const text = p.options.find(([v]) => v === p.defaultLabel)?.[1] ?? String(p.defaultLabel);
  return (
    <Shell label={p.label} id={id} isChanged={p.isChanged} source={p.source} onReset={p.onReset} defaultText={text}>
      <select id={id} value={key(p.value)} onChange={(e) => p.onChange(p.options.find(([v]) => key(v) === e.target.value)![0])}>
        {p.options.map(([v, t]) => (
          <option key={key(v)} value={key(v)}>
            {t}
          </option>
        ))}
      </select>
    </Shell>
  );
}

function LineRow({ line, onSet, onReset }: { line: Line; onSet: (v: number) => void; onReset: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const zero = line.yearly === 0 && !line.setByUser;
  return (
    <li className={`line${zero ? " zero" : ""}`}>
      <div className="line-main">
        <span className="line-label">{line.label}</span>
        <span className="line-figure">{usd10(line.yearly / 12)}<small>/mo</small></span>
      </div>
      <div className="line-sub">
        <span>
          {usd10(line.yearly)} a year
          {line.low !== null && line.high !== null && (
            <>
              {" "}
              · most {usd10(line.low)} to {usd10(line.high)}
            </>
          )}
        </span>
        {editing ? (
          <form
            className="set"
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(draft.replace(/[$,\s]/g, ""));
              if (Number.isFinite(v) && v >= 0) onSet(v * 12);
              setEditing(false);
            }}
          >
            <label>
              $<input autoFocus inputMode="decimal" aria-label={`${line.label} a month`} value={draft} onChange={(e) => setDraft(e.target.value)} />
              /mo
            </label>
            <button type="submit">Set</button>
          </form>
        ) : line.setByUser ? (
          <button type="button" className="link" onClick={onReset}>
            Use the estimate{line.estimate !== null ? ` (${usd10(line.estimate / 12)}/mo)` : ""}
          </button>
        ) : (
          <button
            type="button"
            className="link"
            onClick={() => {
              setDraft(String(Math.round(line.yearly / 12)));
              setEditing(true);
            }}
          >
            Enter my figure
          </button>
        )}
      </div>
      <details>
        <summary>{line.source || "How we got this"}</summary>
        <ul>
          {line.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    </li>
  );
}
