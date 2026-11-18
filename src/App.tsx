import { useEffect, useMemo, useState, type ReactNode } from "react";
import { calculate, LINE_KEYS, NATIONAL, resolveAssumptions, type Assumptions, type Line, type LineKey } from "./lib/calc";
import { loadPlace } from "./lib/data";
import type { Place } from "./lib/types";

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const usd10 = (v: number) => usd(Math.round(v / 10) * 10);

type Changed = Partial<Assumptions>;

export function App() {
  const [zipInput, setZipInput] = useState(() => new URLSearchParams(location.search).get("zip") ?? "");
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<Changed>({});
  const [setLines, setSetLines] = useState<Partial<Record<LineKey, number>>>({});

  async function load(zip: string) {
    const r = await loadPlace(zip.trim());
    if (!r.ok) {
      setError(r.reason === "format" ? "Enter a 5-digit ZIP code." : "We have no data for this ZIP code.");
      return;
    }
    setError(null);
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
          <label htmlFor="zip">ZIP code</label>
          <input id="zip" inputMode="numeric" autoComplete="postal-code" maxLength={5} placeholder="33606" value={zipInput} onChange={(e) => setZipInput(e.target.value.replace(/\D/g, ""))} />
          <button type="submit">Estimate</button>
        </form>
        {error && <p className="error">{error}</p>}
      </header>
      {place && <Calculator place={place} changed={changed} setChanged={setChanged} setLines={setLines} setSetLines={setSetLines} />}
      <footer className="foot">
        Data: U.S. Census Bureau ACS and ZCTA files; U.S. Treasury FIO; FEMA NFIP; EIA (RECS 2020, Form 861, natural gas prices); NOAA climate normals; Florida DOR; California
        BOE and county rate books; {NATIONAL.mortgage.source}. Built {NATIONAL.generated} from Spatia's data service (build {NATIONAL.catalog_build.slice(0, 15)}). Estimates, not quotes.
      </footer>
    </div>
  );
}

function Calculator(props: { place: Place; changed: Changed; setChanged: (f: (c: Changed) => Changed) => void; setLines: Partial<Record<LineKey, number>>; setSetLines: (f: (s: Partial<Record<LineKey, number>>) => Partial<Record<LineKey, number>>) => void }) {
  const { place, changed, setChanged, setLines, setSetLines } = props;
  const { values, defaults, sources } = useMemo(() => resolveAssumptions(place, changed), [place, changed]);
  const result = useMemo(() => calculate(place, values, setLines), [place, values, setLines]);
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
          ZIP {place.zip} · {st} · county {place.zipData.county}
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
          <Select label="Air conditioning" options={[[null, "Not known"], ["central", "Central"], ["room", "Room units"], ["none", "None"]]} {...field("cooling")} />
          <Select label="Pool" options={[[null, "Not known"], [true, "Yes"], [false, "No"]]} {...field("pool")} />
        </Group>
        <Group title="You and the place">
          <Select label="Will you live in the home?" options={[[true, "Yes, my main home"], [false, "No"]]} {...field("liveInHome")} />
          <Select label="FEMA flood zone" options={[["outside", "Outside the high-risk zone"], ["sfha", "High-risk zone (A or V)"]]} {...field("floodZone")} />
          <Select label="Flood insurance" options={[[true, "Include"], [false, "Leave out"]]} {...field("buyFlood")} />
          {st === "FL" && districts.length > 0 && (
            <Select label="Tax district" options={districts.map((d) => [d.code, `${d.name} (${(d.school + d.nonschool).toFixed(2)} mills)`] as [string, string])} {...field("flDistrict")} />
          )}
        </Group>
        <Group title="Prices and other costs">
          <Num label="Electricity price" prefix="$" suffix="per kWh" step={0.01} {...field("electricityUsdPerKwh")} />
          {values.heating === "gas_heat" && <OptNum label="Gas price" prefix="$" suffix="per 1,000 cu ft" step={0.5} {...field("gasUsdPerMcf")} />}
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
