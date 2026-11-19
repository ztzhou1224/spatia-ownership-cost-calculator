import { useState } from "react";
import { consentOf, setConsent, type Consent } from "./lib/consent";

/** The notice at first visit (owner, 2026-11-19: the recording is said in the consent notice, not on the page). */
export function ConsentBanner() {
  const [consent, setLocal] = useState<Consent | null>(() => consentOf());
  if (consent) return null;
  const choose = (c: Consent) => {
    setConsent(c);
    setLocal(c);
  };
  return (
    <div className="consent" role="region" aria-label="Privacy notice">
      <p>
        We save what you enter in this calculator, including the address, to improve our estimates. We do not save your name, email or IP
        address. <a href="/privacy">Privacy</a>
      </p>
      <div className="consent-actions">
        <button type="button" className="consent-ok" onClick={() => choose("ok")}>
          Accept
        </button>
        <button type="button" className="link" onClick={() => choose("no")}>
          Do not save my inputs
        </button>
      </div>
    </div>
  );
}

/** `/privacy`. */
export function PrivacyPage() {
  const [consent, setLocal] = useState<Consent | null>(() => consentOf());
  const choose = (c: Consent) => {
    setConsent(c);
    setLocal(c);
  };
  return (
    <div className="page privacy-page">
      <p className="eyebrow">
        <a href="/">Spatia · Cost to own</a>
      </p>
      <h1>Privacy</h1>
      <p className="lead">Effective November 19, 2026.</p>
      <h2>What we save</h2>
      <p>
        When you use this calculator, we save what you enter and what the calculator shows: the address or ZIP code you type, the address we
        found, every input (for example the price, the down payment, the home's facts and the fees), the inputs and cost lines you change,
        and the totals. We save a new copy when a place loads, when you stop changing inputs, and when you leave the page.
      </p>
      <h2>What we do not save</h2>
      <p>We do not save your name, email address or IP address, and we do not set a cookie to follow you. A random number made by your browser tab links the copies of one visit; it ends when you close the tab.</p>
      <h2>Why</h2>
      <p>We use the saved inputs to improve the estimates: for example, the prices people look at and the insurance, tax and fee figures people type in. We do not sell them.</p>
      <h2>Who else sees the address</h2>
      <p>
        To read the flood zone, the county record and the property record, the address goes to Spatia's own geocoder and data service and to
        RentCast. The site runs on Cloudflare.
      </p>
      <h2>Your choice</h2>
      <p>
        {consent === "no" ? "You chose not to save your inputs on this browser." : "You can stop the saving on this browser at any time."}{" "}
        {consent === "no" ? (
          <button type="button" className="link" onClick={() => choose("ok")}>
            Save my inputs again
          </button>
        ) : (
          <button type="button" className="link" onClick={() => choose("no")}>
            Do not save my inputs
          </button>
        )}
      </p>
      <p>
        To ask about the saved data, or to ask us to delete it, write to <span className="mono">privacy@runspatia.com</span> with the address
        and the day you used the calculator.
      </p>
      <p>
        <a href="/">Back to the calculator</a>
      </p>
    </div>
  );
}
