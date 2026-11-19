import { useEffect, useState } from "react";
import { Calculator, type Changed } from "./Calculator";
import example from "./data/example-address.json";
import { track } from "./lib/analytics";
import { NATIONAL, type LineKey } from "./lib/calc";
import { gradeOf, GRADE_WORDS, STATE_NAMES, TILES, type Grade } from "./lib/coverage";
import { loadAddress, loadPlace } from "./lib/data";
import type { AddressFacts } from "./lib/lookup";
import type { Place } from "./lib/types";

const ERRORS: Record<string, string> = {
  empty: "Enter the street address of the home.",
  zip: "Enter the home's street address. A ZIP code alone is not enough: the costs depend on the home.",
  unknown: "We have no data for this address's ZIP code.",
  not_found: "We could not find this address. Check the street, the city and the state.",
  not_trusted: "We could not place this address on a building. Try the full street address with the city and state.",
  unavailable: "The address lookup is not available now. Try again in a minute.",
  bad_request: "Enter the street address of the home.",
  busy: "Too many lookups in a minute. Wait a moment and try again.",
  format: "Enter the street address of the home.",
};

/** The page opens on this address, marked as an example: public records only (`scripts/record-example.ts`). */
const EXAMPLE = example.facts as AddressFacts;
const TRY: string[] = ["2910 W Fair Oaks Ave, Tampa, FL", "1023 W Gore St, Orlando, FL"];

export function App() {
  const [input, setInput] = useState("");
  const [place, setPlace] = useState<Place | null>(null);
  const [isExample, setIsExample] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<Changed>({});
  const [setLines, setSetLines] = useState<Partial<Record<LineKey, number>>>({});
  const [busy, setBusy] = useState(false);

  async function search(raw: string) {
    const q = raw.trim();
    if (!q) return setError(ERRORS.empty);
    if (/^\d{5}(-\d{4})?$/.test(q)) return setError(ERRORS.zip);
    setBusy(true);
    setError(null);
    track("search_address");
    const r = await loadAddress(q);
    setBusy(false);
    if (!r.ok) return setError(ERRORS[r.reason]);
    setPlace(r.place);
    // a price the visitor typed is kept from one real address to the next, unless the new home has its own asking price
    setChanged((c) => (!isExample && "price" in c && !r.place.facts?.listing ? { price: c.price } : {}));
    setIsExample(false);
    setSetLines({});
    document.getElementById("estimate")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  useEffect(() => {
    void loadPlace(EXAMPLE.zip, EXAMPLE).then((r) => r.ok && setPlace((p) => p ?? r.place));
  }, []);

  return (
    <>
      <a className="skip" href="#estimate">
        Skip to the estimate
      </a>
      <div className="band">
        <header className="site-head">
          <div className="wrap head-row">
            <a href="#top" className="brand" aria-label="Spatia Cost to Own, to the top">
              <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
                <rect width="28" height="28" rx="7" fill="#2dd4bf" />
                <path d="M7 14.5 14 8l7 6.5V21H7z" fill="none" stroke="#0c2a28" strokeWidth="2" strokeLinejoin="round" />
              </svg>
              <span>Spatia Cost to Own</span>
            </a>
            <nav aria-label="On this page">
              <a href="#estimate">Estimate</a>
              <a href="#how">How it works</a>
              <a href="#coverage">Coverage</a>
              <a href="#faq">Questions</a>
            </nav>
          </div>
        </header>
        <section className="hero" id="top">
          <div className="wrap hero-row">
            <div className="hero-text">
              <h1>The monthly cost of a U.S. home, worked out in the open</h1>
              <p>Loan, property tax, insurance, energy and upkeep. Every figure starts as an estimate with a source, and you can change any of them.</p>
            </div>
            <div className="hero-search">
              <form
                className="search"
                role="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search(input);
                }}
              >
                <label htmlFor="q" className="sr-only">
                  Street address of the home
                </label>
                <input id="q" autoComplete="street-address" maxLength={200} placeholder="Street address, city, state" value={input} onChange={(e) => setInput(e.target.value)} />
                <button type="submit" disabled={busy}>
                  {busy ? "Looking up…" : "Estimate"}
                </button>
              </form>
              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : (
                <p className="try">
                  Try{" "}
                  {TRY.map((t, i) => (
                    <span key={t}>
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          setInput(t);
                          void search(t);
                        }}
                      >
                        {t}
                      </button>
                      {i < TRY.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>
        </section>
      </div>

      <main>
        <section id="estimate" className="estimate" aria-label="The estimate">
          <div className="wrap">
            {place ? (
              <Calculator place={place} example={isExample} changed={changed} setChanged={setChanged} setLines={setLines} setSetLines={setSetLines} />
            ) : (
              <div className="loading" aria-live="polite">
                Loading the example…
              </div>
            )}
          </div>
        </section>

        <section id="how" className="section">
          <div className="wrap">
            <h2>How it works</h2>
            <ol className="steps">
              <li>
                <h3>We read the records for the address</h3>
                <p>FEMA's flood zone, the county tax roll where it is published, RentCast's property record and the home's active listing.</p>
              </li>
              <li>
                <h3>We estimate each cost</h3>
                <p>Each line has its own method and source: the state's tax rules and rates, Treasury's insurance averages, FEMA's flood premiums and a formula fitted to EIA's energy survey.</p>
              </li>
              <li>
                <h3>You make it yours</h3>
                <p>Change any input, or type a real quote or bill over any line. The total follows at once. A changed figure shows the estimate beside it.</p>
              </li>
            </ol>
            <div className="sources-grid">
              {SOURCES.map(([line, from]) => (
                <div key={line}>
                  <h3>{line}</h3>
                  <p>{from}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="coverage" className="section alt">
          <div className="wrap">
            <CoverageMap />
          </div>
        </section>

        <section id="faq" className="section">
          <div className="wrap narrow">
            <h2>Questions</h2>
            {FAQ.map(([q, a]) => (
              <details key={q} className="faq">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-foot">
        <div className="wrap foot-grid">
          <div>
            <p className="foot-brand">Spatia Cost to Own</p>
            <p>Estimates, not quotes. A lender, an insurer and the county give the real figures.</p>
            <p className="foot-links">
              <a href="https://home.runspatia.com">Spatia Home: the full report on a home</a>
              <a href="https://crime.runspatia.com">Spatia Crime</a>
              <a href="https://runspatia.com">runspatia.com</a>
            </p>
          </div>
          <div className="foot-data">
            <p>
              Data: U.S. Census Bureau (ACS, ZCTA files); U.S. Treasury Federal Insurance Office; FEMA NFIP; EIA (RECS 2020, Form 861, natural gas prices); NOAA climate normals; Florida
              Department of Revenue; California BOE and county rate books; Texas Comptroller; RentCast; {NATIONAL.mortgage.source}.
            </p>
            <p>
              Data built {NATIONAL.generated} from Spatia's data service (build {NATIONAL.catalog_build.slice(0, 15)}). Mortgage rate of the week of {NATIONAL.mortgage.week_of}.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

const SOURCES: [string, string][] = [
  ["Loan", "The asking price when the home is listed, Freddie Mac's weekly 30-year rate, 20 % down."],
  ["Property tax", "Florida's rolls and district rates, California's 1 % levy, Texas's taxing units, or the area's rate."],
  ["Insurance", "Treasury's ZIP Code premiums and FEMA's flood premiums for similar homes."],
  ["Energy", "A formula fitted to EIA's 2020 survey, NOAA's climate normals and EIA's state prices."],
  ["Fees", "The HOA fee from the property record or listing, and the county's flat charges in Florida."],
  ["Upkeep", "1 % of the price a year for repairs, and a typical water and trash bill."],
];

const FAQ: [string, string][] = [
  ["Is this a quote?", "No. These are estimates from public records and published rates. A lender quotes the loan, an insurer the premium, and the county sends the tax bill."],
  ["Why is the property tax different from the listing?", "A listing shows the seller's bill. In many states a sale changes the taxed value, and the seller's exemptions do not pass to you. The estimate is for a new owner."],
  ["Where does the price come from?", "When the home is listed for sale, the asking price. Otherwise the area's typical home value. Type the price you will pay for your own figure."],
  ["Why do I need a full address?", "The costs depend on the home: its size, its flood zone, its tax district and its asking price. A ZIP code holds many different homes."],
  ["What does the range on a line mean?", "Where a back-test measured it, 8 in 10 real figures fell inside the range. A line without a range has no tested spread."],
  ["What is not included?", "Closing costs, the mortgage interest tax deduction, home price changes and the return you give up on the down payment."],
  ["Is it free?", "Yes. No account and no sign-up. For the full report on a home, with its flood, hazard and neighborhood records, see Spatia Home."],
];

function CoverageMap() {
  const [pick, setPick] = useState<string | null>(null);
  const counts = TILES.reduce<Record<Grade, number>>((c, [st]) => ({ ...c, [gradeOf(st)]: c[gradeOf(st)] + 1 }), { A: 0, B: 0, C: 0, D: 0 });
  const g = pick ? gradeOf(pick) : null;
  return (
    <div className="coverage">
      <div className="coverage-text">
        <h2>Sharper in some states</h2>
        <p className="section-lead">
          Every state gets a full estimate. The property tax decides how close it gets: Florida's tax line is tested on real bills, California and Texas read the rates at the address, and
          elsewhere we use the county's typical rate from the Census.
        </p>
        <div className="pick" aria-live="polite">
          {pick && g ? (
            <>
              <p className="pick-grade">
                <span className={`grade g${g}`}>{g}</span> {STATE_NAMES[pick]}: {GRADE_WORDS[g].name}
              </p>
              <p>{GRADE_WORDS[g].text}</p>
            </>
          ) : (
            <p className="pick-hint">Select a state on the map to see what its grade means.</p>
          )}
        </div>
      </div>
      <div>
        <div className="tilemap" role="group" aria-label="Estimate grade by state">
          {TILES.map(([st, x, y]) => (
            <button
              key={st}
              type="button"
              className={`tile g${gradeOf(st)}${pick === st ? " picked" : ""}`}
              style={{ gridColumn: x + 1, gridRow: y + 1 }}
              aria-label={`${STATE_NAMES[st]}: ${GRADE_WORDS[gradeOf(st)].name}`}
              aria-pressed={pick === st}
              onClick={() => setPick(pick === st ? null : st)}
            >
              {st}
            </button>
          ))}
        </div>
        <ul className="map-legend">
          {(Object.keys(GRADE_WORDS) as Grade[]).map((k) => (
            <li key={k}>
              <i className={`tile g${k}`} aria-hidden="true" />
              {k} · {GRADE_WORDS[k].name} · {counts[k]}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
