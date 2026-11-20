import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { calculate, LINE_KEYS, resolveAssumptions, type Assumptions, type Line, type LineKey, type Result } from "./lib/calc";
import { trackChange, trackClosing, trackLine, trackReset } from "./lib/analytics";
import { closingCosts, type ClosingLine, type SetLines } from "./lib/closing";
import { gradeOf, GRADE_WORDS, STATE_NAMES } from "./lib/coverage";
import type { TxUnit } from "./lib/texas";
import type { Place } from "./lib/types";

export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const usd10 = (v: number) => usd(Math.round(v / 10) * 10);

export type Changed = Partial<Assumptions>;

/** The cost lines grouped for the breakdown bar. */
const GROUPS: { id: string; name: string; keys: LineKey[] }[] = [
  { id: "loan", name: "Mortgage", keys: ["loan", "pmi"] },
  { id: "tax", name: "Taxes and charges", keys: ["tax", "flat_charges"] },
  { id: "ins", name: "Insurance", keys: ["home_insurance", "flood_insurance"] },
  { id: "util", name: "Energy and water", keys: ["energy", "water"] },
  { id: "hoa", name: "HOA", keys: ["hoa"] },
  { id: "upkeep", name: "Upkeep", keys: ["maintenance"] },
];

export function Calculator(props: { place: Place; example: boolean; changed: Changed; setChanged: (f: (c: Changed) => Changed) => void; setLines: SetLines; setSetLines: (f: (s: SetLines) => SetLines) => void }) {
  const { place, changed, setChanged, setLines, setSetLines } = props;
  const { values, defaults, sources } = useMemo(() => resolveAssumptions(place, changed), [place, changed]);
  const result = useMemo(() => calculate(place, values, setLines), [place, values, setLines]);
  const closing = useMemo(() => closingCosts(place, values, result, setLines), [place, values, result, setLines]);
  const st = place.zipData.st;
  const [tab, setTab] = useState<"costs" | "inputs">("costs");
  const totalRef = useRef<HTMLDivElement>(null);
  const [totalVisible, setTotalVisible] = useState(true);
  useEffect(() => {
    const el = totalRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // the floating total shows only once the total card has scrolled ABOVE the screen, never before the visitor reaches it
    const io = new IntersectionObserver(([e]) => setTotalVisible(e.isIntersecting || e.boundingClientRect.top > 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const field = <K extends keyof Assumptions>(k: K) => ({
    value: values[k],
    isChanged: k in changed,
    source: sources[k],
    onChange: (v: Assumptions[K]) => {
      if (!props.example) trackChange(k, v, defaults[k]);
      setChanged((c) => ({ ...c, [k]: v }));
    },
    onReset: () => {
      if (!props.example) trackReset(k, defaults[k]);
      setChanged((c) => {
        const n = { ...c };
        delete n[k];
        return n;
      });
    },
    defaultLabel: defaults[k],
  });
  const districts = place.county?.fl_districts ?? [];
  const changedCount = Object.keys(changed).length + Object.keys(setLines).length;
  const lineProps = (l: Line) => ({
    line: l,
    onSet: (v: number) => {
      if (!props.example) trackLine(l.key, v / 12, l.estimate === null ? null : l.estimate / 12);
      setSetLines((s) => ({ ...s, [l.key]: v }));
    },
    onReset: () => {
      if (!props.example) trackLine(l.key, null, null);
      setSetLines((s) => {
        const n = { ...s };
        delete n[l.key];
        return n;
      });
    },
  });
  const closingProps = (l: ClosingLine) => ({
    line: l,
    onSet: (v: number) => {
      if (!props.example) trackClosing(l.key, v, l.estimate);
      setSetLines((s) => ({ ...s, [l.key]: v }));
    },
    onReset: () => {
      if (!props.example) trackClosing(l.key, null, null);
      setSetLines((s) => {
        const n = { ...s };
        delete n[l.key];
        return n;
      });
    },
  });
  const lines = LINE_KEYS.map((k) => result.lines.find((x) => x.key === k)!);
  const counted = lines.filter((l) => l.yearly > 0 || l.setByUser);
  const notCounted = lines.filter((l) => !(l.yearly > 0 || l.setByUser));
  const showInputs = () => {
    setTab("inputs");
    document.getElementById("estimate")?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="calc" data-tab={tab}>
      <div className="tabs" role="tablist" aria-label="Show">
        <button type="button" role="tab" id="tab-costs" aria-controls="pane-costs" aria-selected={tab === "costs"} onClick={() => setTab("costs")}>
          Costs
        </button>
        <button type="button" role="tab" id="tab-inputs" aria-controls="pane-inputs" aria-selected={tab === "inputs"} onClick={() => setTab("inputs")}>
          Inputs{changedCount > 0 ? ` (${changedCount} changed)` : ""}
        </button>
      </div>
      <div className="calc-grid">
        <aside className="calc-inputs pane" id="pane-inputs" role="tabpanel" aria-labelledby="tab-inputs" aria-label="Your inputs">
          <div className="inputs-head">
            <h3>Inputs</h3>
            {changedCount > 0 ? (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setChanged(() => ({}));
                  setSetLines(() => ({}));
                }}
              >
                Use every estimate ({changedCount} changed)
              </button>
            ) : (
              <span className="muted">Every figure is an estimate</span>
            )}
          </div>
          <Group title="Loan" open>
            <Num label="Price" prefix="$" step={5000} {...field("price")} />
            <Num label="Down payment" suffix="%" step={1} {...field("downPct")} />
            <div className="pair">
              <Num label="Interest rate" suffix="%" step={0.125} {...field("ratePct")} />
              <Num label="Loan term" suffix="years" step={5} {...field("termYears")} />
            </div>
            {values.downPct < 20 && <Num label="Mortgage insurance" suffix="% a year" step={0.05} {...field("pmiPct")} />}
          </Group>
          <Group title="Home" open>
            <Pills label="Type" options={[["house", "House"], ["townhouse", "Townhouse"], ["condo", "Condo"], ["mobile", "Manufactured"]]} {...field("homeType")} />
            <Num label="Living area" suffix="sq ft" step={50} {...field("sqft")} />
            <div className="pair">
              <OptNum label="Bedrooms" step={1} {...field("bedrooms")} />
              <OptNum label="Year built" step={1} {...field("yearBuilt")} />
            </div>
            <Select label="Heating" options={[["electric_heat", "Electric or heat pump"], ["gas_heat", "Natural gas"]]} {...field("heating")} />
            <Select label="Air conditioning" options={[[null, "Not known"], ["central", "Central"], ["room", "Room units"], ["any", "Yes, type not known"], ["none", "None"]]} {...field("cooling")} />
            <Select label="Pool" options={[[null, "Not known"], [true, "Yes"], [false, "No"]]} {...field("pool")} />
          </Group>
          <Group title="Tax and insurance">
            <Select label="Will you live in the home?" options={[[true, "Yes, my main home"], [false, "No"]]} {...field("liveInHome")} />
            <Select label="FEMA flood zone" options={[["outside", "Outside the high-risk zone"], ["sfha", "High-risk zone (A or V)"]]} {...field("floodZone")} />
            <Select label="Flood insurance" options={[[true, "Include"], [false, "Leave out"]]} {...field("buyFlood")} />
            {st === "TX" && (place.county?.tx_units?.length ?? 0) > 0 && (
              <TxUnits
                units={place.county!.tx_units!}
                value={values.txUnits}
                isChanged={"txUnits" in changed}
                source={sources.txUnits}
                onChange={(v) => field("txUnits").onChange(v)}
                onReset={field("txUnits").onReset}
              />
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
          <StateGrade st={st} />
        </aside>

        <div className="calc-results pane" id="pane-costs" role="tabpanel" aria-labelledby="tab-costs">
          <div className="total-card" ref={totalRef} id="estimate-total">
            <PlaceHeader place={place} example={props.example} />
            <div className="total-top">
              <p className="total-figure">
                {usd10(result.monthly)}
                <small> / month</small>
              </p>
              <div className="total-side">
                {Math.round(result.monthlyLow / 10) !== Math.round(result.monthlyHigh / 10) && (
                  <p>
                    Likely <b>{usd10(result.monthlyLow)}</b> to <b>{usd10(result.monthlyHigh)}</b>
                  </p>
                )}
                <p>
                  <b>{usd10(result.yearly)}</b> a year · <b>{usd(result.downPayment)}</b> down
                </p>
              </div>
            </div>
            <Breakdown result={result} />
            <p className="total-note">The likely range puts each tested line at the low or high end of its range. The one-time costs at closing are below, not in this total.</p>
          </div>
          <ul className="tiles">
            {counted.map((l) => (
              <LineTile key={`${place.zip}-${l.key}`} {...lineProps(l)} />
            ))}
          </ul>
          {notCounted.length > 0 && (
            <div className="not-counted">
              <h3>Not counted for this home</h3>
              <ul>
                {notCounted.map((l) => (
                  <NotCountedRow key={`${place.zip}-${l.key}`} {...lineProps(l)} />
                ))}
              </ul>
            </div>
          )}
          <section className="closing" aria-labelledby="closing-h">
            <div className="closing-head">
              <h3 id="closing-h">One time, at closing</h3>
              <p>
                <b>{usd10(closing.cashToClose)}</b> cash to close
              </p>
            </div>
            <ul>
              <li>
                <div className="closing-name">
                  <b>Down payment</b>
                  <span className="muted"> · {values.downPct} % of the price</span>
                </div>
                <span className="closing-fig">{usd(closing.downPayment)}</span>
              </li>
              {closing.lines.map((l) => (
                <ClosingRow key={`${place.zip}-${l.key}`} {...closingProps(l)} />
              ))}
            </ul>
            <p className="total-note">
              Closing costs {usd10(closing.total)} on top of the down payment. Not in the monthly total. Your lender's Loan Estimate gives the real figures.
            </p>
          </section>
        </div>
      </div>
      <div className={`sticky-total${totalVisible && tab === "costs" ? "" : " show"}`} aria-hidden={totalVisible && tab === "costs"}>
        <span>
          <b>{usd10(result.monthly)}</b> / month
        </span>
        {tab === "costs" ? (
          <button type="button" tabIndex={totalVisible ? -1 : 0} onClick={showInputs}>
            Change inputs
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setTab("costs");
              document.getElementById("estimate")?.scrollIntoView({ block: "start" });
            }}
          >
            See the costs
          </button>
        )}
      </div>
    </div>
  );
}

function PlaceHeader({ place, example }: { place: Place; example: boolean }) {
  const f = place.facts;
  const st = place.zipData.st;
  const chips: string[] = [];
  if (f?.roll?.useLabel) chips.push(f.roll.useLabel.replace(/^DOR \d+ — /, ""));
  else if (f?.property?.propertyType) chips.push(f.property.propertyType);
  const sqft = f?.roll?.livingSqft ?? f?.property?.squareFootage;
  if (sqft) chips.push(`${Math.round(sqft).toLocaleString("en-US")} sq ft`);
  const yb = f?.roll?.yearBuilt ?? f?.property?.yearBuilt;
  if (yb) chips.push(`Built ${yb}`);
  if (f?.floodZoneCode) chips.push(`FEMA zone ${f.floodZoneCode}`);
  if (f?.listing) chips.push(`Listed ${usd(f.listing.price)}`);
  if (f?.flatCharges?.amount) chips.push(`Flat charges ${usd(f.flatCharges.amount)}/yr`);
  return (
    <div className="place-head">
      <p className="place-label">
        {f ? f.label : STATE_NAMES[st] ?? st}
        {example && <span className="example-tag">Example</span>}
      </p>
      {chips.length > 0 ? (
        <ul className="chips" aria-label="From the records at this address">
          {chips.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : (
        <p className="place-sub">No county or property record matched this address; the estimates are the area's.</p>
      )}
      {example && <p className="place-sub">An example from public records. Search a street address above for your home.</p>}
    </div>
  );
}

function StateGrade({ st }: { st: string }) {
  const g = gradeOf(st);
  return (
    <p className="state-grade">
      <span className={`grade g${g}`}>{g}</span> Property tax in {STATE_NAMES[st] ?? st}: <b>{GRADE_WORDS[g].name}</b>. {GRADE_WORDS[g].text}{" "}
      <a href="#coverage">All states</a>
    </p>
  );
}

function Breakdown({ result }: { result: Result }) {
  const parts = GROUPS.map((g) => ({ ...g, yearly: g.keys.reduce((s, k) => s + (result.lines.find((l) => l.key === k)?.yearly ?? 0), 0) })).filter((p) => p.yearly > 0);
  const total = parts.reduce((s, p) => s + p.yearly, 0) || 1;
  return (
    <div className="breakdown">
      <div className="bar" role="img" aria-label={parts.map((p) => `${p.name} ${Math.round((p.yearly / total) * 100)}%`).join(", ")}>
        {parts.map((p) => (
          <span key={p.id} className={`seg s-${p.id}`} style={{ flexGrow: p.yearly }} />
        ))}
      </div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.id}>
            <i className={`s-${p.id}`} aria-hidden="true" />
            {p.name} <b>{usd10(p.yearly / 12)}</b>
          </li>
        ))}
      </ul>
    </div>
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
      {p.units.length > 30 && <input className="unit-filter" placeholder="Find a unit by name" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a taxing unit" />}
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
    </div>
  );
}

function Group({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="group" open={open}>
      <summary>{title}</summary>
      <div className="group-body">{children}</div>
    </details>
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

/** A number input that keeps what the visitor types (an empty box, a trailing dot) and passes on only a valid number. */
function NumberBox({ id, value, step, placeholder, onValue }: { id: string; value: number | null; step: number; placeholder?: string; onValue: (v: number | null) => void }) {
  const [text, setText] = useState(value === null || !Number.isFinite(value) ? "" : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value === null || !Number.isFinite(value) ? "" : String(value));
    }
  }, [value]);
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      min={0}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim();
        const n = t === "" ? null : Number(t);
        if (n === null || (Number.isFinite(n) && n >= 0)) {
          last.current = n;
          onValue(n);
        }
      }}
    />
  );
}

function Num(p: FieldProps<number> & { prefix?: string; suffix?: string; step: number }) {
  const id = idOf(p.label);
  return (
    <Shell label={p.label} id={id} isChanged={p.isChanged} source={p.source} onReset={p.onReset} defaultText={`${p.prefix ?? ""}${p.defaultLabel.toLocaleString("en-US")}${p.suffix ? ` ${p.suffix}` : ""}`}>
      {p.prefix && <span className="affix">{p.prefix}</span>}
      <NumberBox id={id} value={p.value} step={p.step} onValue={(v) => v !== null && p.onChange(v)} />
      {p.suffix && <span className="affix">{p.suffix}</span>}
    </Shell>
  );
}

function OptNum(p: FieldProps<number | null> & { prefix?: string; suffix?: string; step: number }) {
  const id = idOf(p.label);
  return (
    <Shell label={p.label} id={id} isChanged={p.isChanged} source={p.source} onReset={p.onReset} defaultText={p.defaultLabel === null ? "not known" : `${p.prefix ?? ""}${p.defaultLabel.toLocaleString("en-US")}`}>
      {p.prefix && <span className="affix">{p.prefix}</span>}
      <NumberBox id={id} value={p.value} step={p.step} placeholder="Not known" onValue={(v) => p.onChange(v)} />
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

/**
 * The "Enter my figure" control: a link, then a small form. A monthly line is typed a month (`once` false); a closing line is typed
 * as the one-time figure.
 */
function SetFigure({ line, once = false, onSet, onReset }: { line: { label: string; setByUser: boolean; estimate: number | null; current: number }; once?: boolean; onSet: (v: number) => void; onReset: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const shown = (v: number) => (once ? v : v / 12);
  if (editing)
    return (
      <form
        className="set"
        onSubmit={(e) => {
          e.preventDefault();
          const v = Number(draft.replace(/[$,\s]/g, ""));
          if (Number.isFinite(v) && v >= 0) onSet(once ? v : v * 12);
          setEditing(false);
        }}
      >
        <label>
          $<input autoFocus inputMode="decimal" aria-label={once ? `${line.label}, one time` : `${line.label} a month`} value={draft} onChange={(e) => setDraft(e.target.value)} />
          {once ? "" : "/mo"}
        </label>
        <button type="submit" className="btn-small">
          Set
        </button>
        <button type="button" className="link" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
    );
  if (line.setByUser)
    return (
      <button type="button" className="link" onClick={onReset}>
        Use the estimate{line.estimate !== null ? ` (${usd10(shown(line.estimate))}${once ? "" : "/mo"})` : ""}
      </button>
    );
  return (
    <button
      type="button"
      className="link"
      onClick={() => {
        setDraft(line.current > 0 ? String(Math.round(shown(line.current))) : "");
        setEditing(true);
      }}
    >
      Enter my figure
    </button>
  );
}

/** A monthly line as SetFigure reads it. */
const monthlyOf = (l: Line) => ({ label: l.label, setByUser: l.setByUser, estimate: l.estimate, current: l.yearly });

function How({ line }: { line: { source: string; notes: string[] } }) {
  return (
    <details className="how">
      <summary>How we got this</summary>
      {line.source && <p className="how-source">{line.source}</p>}
      <ul>
        {line.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

function LineTile({ line, onSet, onReset }: { line: Line; onSet: (v: number) => void; onReset: () => void }) {
  const hasRange = line.low !== null && line.high !== null && line.high > line.low;
  // the range bar: the low-to-high span on a scale from 0 to 1.25 × the high end, the figure as a tick
  const scale = hasRange ? line.high! * 1.25 : 1;
  return (
    <li className={`tile-card${line.setByUser ? " user" : ""}`}>
      <p className="tile-label">
        {line.label}
        {line.setByUser && <span className="tag">Your figure</span>}
      </p>
      <p className="tile-figure">
        {usd10(line.yearly / 12)}
        <small>/mo</small>
      </p>
      {hasRange && (
        <div className="range" role="img" aria-label={`Range ${usd10(line.low! / 12)} to ${usd10(line.high! / 12)} a month`}>
          <span className="range-span" style={{ left: `${(line.low! / scale) * 100}%`, width: `${((line.high! - line.low!) / scale) * 100}%` }} />
          <span className="range-tick" style={{ left: `${(Math.min(line.yearly, scale) / scale) * 100}%` }} />
        </div>
      )}
      <p className="tile-sub">
        {hasRange ? `Most ${usd10(line.low! / 12)} to ${usd10(line.high! / 12)}` : `${usd10(line.yearly)} a year`}
      </p>
      <SetFigure line={monthlyOf(line)} onSet={onSet} onReset={onReset} />
      <How line={line} />
    </li>
  );
}

/** A one-time line at closing: the figure, its tested range when one exists, the set control and how we got it. */
function ClosingRow({ line, onSet, onReset }: { line: ClosingLine; onSet: (v: number) => void; onReset: () => void }) {
  const hasRange = line.low !== null && line.high !== null && line.high > line.low;
  const known = line.estimate !== null || line.setByUser;
  return (
    <li className={line.setByUser ? "user" : undefined}>
      <div className="closing-name">
        <b>{line.label}</b>
        {line.setByUser && <span className="tag">Your figure</span>}
        {hasRange && <span className="muted"> · 8 in 10 pay {usd10(line.low!)} to {usd10(line.high!)}</span>}
        {!known && <span className="muted"> · {line.notes[0]}</span>}
      </div>
      <span className="closing-fig">{known ? usd10(line.amount) : "Not known"}</span>
      <div className="closing-actions">
        <SetFigure line={{ label: line.label, setByUser: line.setByUser, estimate: line.estimate, current: line.amount }} once onSet={onSet} onReset={onReset} />
        <How line={line} />
      </div>
    </li>
  );
}

function NotCountedRow({ line, onSet, onReset }: { line: Line; onSet: (v: number) => void; onReset: () => void }) {
  return (
    <li>
      <div>
        <b>{line.label}</b>
        <span className="muted"> · {line.notes[0] ?? line.source}</span>
      </div>
      <SetFigure line={monthlyOf(line)} onSet={onSet} onReset={onReset} />
    </li>
  );
}

/** A choice shown as buttons (few options). */
function Pills<T extends string>(p: FieldProps<T> & { options: Opt<T>[] }) {
  const text = p.options.find(([v]) => v === p.defaultLabel)?.[1] ?? String(p.defaultLabel);
  return (
    <div className={`field${p.isChanged ? " changed" : ""}`}>
      <span className="label" id={`${idOf(p.label)}-l`}>
        {p.label}
      </span>
      <div className="pills" role="group" aria-labelledby={`${idOf(p.label)}-l`}>
        {p.options.map(([v, t]) => (
          <button key={v} type="button" aria-pressed={p.value === v} onClick={() => v !== p.value && p.onChange(v)}>
            {t}
          </button>
        ))}
      </div>
      <p className="hint">
        {p.isChanged ? (
          <>
            Your choice. Estimate: {text}.{" "}
            <button type="button" className="link" onClick={p.onReset}>
              Use the estimate
            </button>
          </>
        ) : (
          p.source
        )}
      </p>
    </div>
  );
}
