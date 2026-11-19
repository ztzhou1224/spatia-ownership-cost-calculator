import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { calculate, LINE_KEYS, resolveAssumptions, type Assumptions, type Line, type LineKey, type Result } from "./lib/calc";
import { trackChange, trackLine, trackReset } from "./lib/analytics";
import { gradeOf, GRADE_WORDS, STATE_NAMES } from "./lib/coverage";
import type { TxUnit } from "./lib/texas";
import type { Place } from "./lib/types";

export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const usd10 = (v: number) => usd(Math.round(v / 10) * 10);

export type Changed = Partial<Assumptions>;
type SetLines = Partial<Record<LineKey, number>>;

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
  const st = place.zipData.st;
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

  return (
    <div className="calc">
      <PlaceHeader place={place} example={props.example} />
      <div className="calc-grid">
        <div className="calc-results">
          <div className="total-card" ref={totalRef}>
            <div className="total-top">
              <div>
                <p className="kicker">A month to own</p>
                <p className="total-figure">{usd10(result.monthly)}</p>
              </div>
              <div className="total-side">
                <p>
                  <b>{usd10(result.yearly)}</b> a year
                </p>
                <p>
                  <b>{usd(result.downPayment)}</b> down payment
                </p>
              </div>
            </div>
            <Breakdown result={result} />
            <p className="total-note">
              {Math.round(result.monthlyLow / 10) !== Math.round(result.monthlyHigh / 10)
                ? `With each tested line at the low or high end of its range: ${usd10(result.monthlyLow)} to ${usd10(result.monthlyHigh)} a month.`
                : "No tested range for this place."}{" "}
              Closing costs are not included.
            </p>
          </div>
          <ul className="lines">
            {LINE_KEYS.map((k) => {
              const l = result.lines.find((x) => x.key === k)!;
              return (
                <LineRow
                  key={`${place.zip}-${k}`}
                  line={l}
                  onSet={(v) => {
                    if (!props.example) trackLine(k, v / 12, l.estimate === null ? null : l.estimate / 12);
                    setSetLines((s) => ({ ...s, [k]: v }));
                  }}
                  onReset={() => {
                    if (!props.example) trackLine(k, null, null);
                    setSetLines((s) => {
                      const n = { ...s };
                      delete n[k];
                      return n;
                    });
                  }}
                />
              );
            })}
          </ul>
        </div>

        <aside className="calc-inputs" aria-label="Your inputs">
          <div className="inputs-head">
            <h3>Your inputs</h3>
            {changedCount > 0 && (
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
            )}
          </div>
          <Group title="The loan" open>
            <Num label="Price" prefix="$" step={5000} {...field("price")} />
            <Num label="Down payment" suffix="%" step={1} {...field("downPct")} />
            <Num label="Interest rate" suffix="%" step={0.125} {...field("ratePct")} />
            <Num label="Loan term" suffix="years" step={5} {...field("termYears")} />
            {values.downPct < 20 && <Num label="Mortgage insurance" suffix="% a year" step={0.05} {...field("pmiPct")} />}
          </Group>
          <Group title="The home" open>
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
      </div>
      <a href="#estimate-total" className={`sticky-total${totalVisible ? "" : " show"}`} aria-hidden={totalVisible} tabIndex={totalVisible ? -1 : 0}>
        <span>A month to own</span>
        <b>{usd10(result.monthly)}</b>
      </a>
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
    <div className="place-head" id="estimate-total">
      {example && <p className="example-tag">Example</p>}
      <h2>{f ? f.label : `ZIP ${place.zip}, ${STATE_NAMES[st] ?? st}`}</h2>
      {example ? (
        <p className="place-sub">This is an area estimate for one ZIP code. Search an address above to get your home's own figures.</p>
      ) : f ? (
        chips.length > 0 ? (
          <ul className="chips" aria-label="From the records at this address">
            {chips.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : (
          <p className="place-sub">No county or property record matched this address; the estimates are the area's.</p>
        )
      ) : (
        <p className="place-sub">An area estimate. Search the full address for the home's flood zone, facts and asking price.</p>
      )}
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

function LineRow({ line, onSet, onReset }: { line: Line; onSet: (v: number) => void; onReset: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const zero = line.yearly === 0 && !line.setByUser;
  const hasRange = line.low !== null && line.high !== null && line.high > line.low;
  // the range bar: the low-to-high span on a scale from 0 to 1.25 × the high end, the figure as a tick
  const scale = hasRange ? line.high! * 1.25 : 1;
  return (
    <li className={`line${zero ? " zero" : ""}${line.setByUser ? " user" : ""}`}>
      <div className="line-main">
        <span className="line-label">
          {line.label}
          {line.setByUser && <span className="tag">Your figure</span>}
        </span>
        <span className="line-figure">
          {usd10(line.yearly / 12)}
          <small>/mo</small>
        </span>
      </div>
      {hasRange && (
        <div className="range" aria-label={`Range ${usd10(line.low! / 12)} to ${usd10(line.high! / 12)} a month`}>
          <span className="range-span" style={{ left: `${(line.low! / scale) * 100}%`, width: `${((line.high! - line.low!) / scale) * 100}%` }} />
          <span className="range-tick" style={{ left: `${(line.yearly / scale) * 100}%` }} />
        </div>
      )}
      <div className="line-sub">
        <span>
          {usd10(line.yearly)} a year
          {hasRange && (
            <>
              {" "}
              · most {usd10(line.low! / 12)} to {usd10(line.high! / 12)}/mo
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
            <button type="submit" className="btn-small">
              Set
            </button>
            <button type="button" className="link" onClick={() => setEditing(false)}>
              Cancel
            </button>
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
      <details className="how">
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
