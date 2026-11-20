# Ownership cost calculator — pilot study

Date: 2026-11-18. Status: pilot.

## Goal

Show what a home costs to own each month: the loan, mortgage insurance, property tax, homeowners and flood insurance, the HOA
fee, energy, water and upkeep. Every input has an estimated default for the place. The user can change any input, or type their
own figure for any cost line.

## What each line is, and where its default comes from

| Line | Method | Source of the default | Range |
|---|---|---|---|
| Principal and interest | Standard amortised payment | The asking price on RentCast's active listing (else the county's typical value); Freddie Mac PMMS 30-year rate, latest week; 20 % down; 30 years | None (exact for the inputs) |
| Mortgage insurance | Loan × a yearly rate, until the loan is 78 % of the price | An assumed rate by down payment (`mortgage.ts` `PMI_BY_DOWN`); a lender quotes the real one | None |
| Property tax | See "Property tax" below | Florida DOR rolls and district rates; California's 1 % levy and rate books; Census ACS | Florida only, where the back-test passed |
| Homeowners insurance | The ZIP's average premium per policy, brought to date with a national premium index | U.S. Treasury FIO, ZIP, latest year (2022); BLS PPI of homeowners insurance premiums (`PCU9241269241262`), the year's average to the latest final month | None |
| Flood insurance | The county's median new NFIP premium of similar homes (zone × main home) | FEMA NFIP policies (spatia-data `nfip_premiums_similar_homes`) | The state's back-test, 10th–90th percentile |
| HOA fee | The user's figure | None: no public source | None |
| Electricity and gas | Spatia Home's RECS 2020 formula (`energy.ts`, copied unchanged) | NOAA 1991–2020 normals at the nearest station; EIA-861 state price; EIA state gas price | The formula's 10th–90th percentile |
| Water, sewer, trash | A fixed monthly assumption | None: no national source of rates | None |
| Maintenance | 1 % of the price a year | The common rule | None |

## Homeowners insurance

Treasury's ZIP average is from 2022. Since 2026-11-20 (owner: "6. yes", the study's next step 4) the default is that figure × the
change in the Bureau of Labor Statistics' producer price index of homeowners insurance premiums, from the 2022 average to the
latest final month (`src/data/hoi-index.generated.json`, `scripts/build-data.ts` stage `hoi-index`). In June 2026 the step is
+28 %. The line states both: Treasury's figure as published, then the index step. The index is national: it does not show that
premiums rose more in some states than in others.

## One-time costs at closing

Since 2026-11-20 (owner: "start with 1 and 2"), a block apart from the monthly total: the down payment and three lines, each one
the user can set. Cash to close = the down payment + the lines.

| Line | Method | Source | Range |
|---|---|---|---|
| Lender, title and other services | The median "total loan costs" (the Closing Disclosure's section D: origination charges, points, appraisal, lender's title insurance, settlement) of loans in the state and the loan's size band | FFIEC HMDA data browser (CFPB): originated conventional first-lien purchase loans, one-unit site-built homes the borrower lives in, latest year (`src/data/closing.generated.json`, stage `closing`) | The 10th–90th percentile, only where the year before's range held ≥ 75 % of the latest year's loans (≥ 100 loans) |
| Taxes on the mortgage | Florida: $0.35 per $100 of the note (Fla. Stat. § 201.08) + 0.2 % of the loan (§ 199.133). Texas: none. Elsewhere: not modelled ("not known") | State law | None |
| Prepaid bills and escrow deposit | The first year of insurance + 3 months of tax and 2 months of insurance into escrow + 15 days of interest | An assumption made from the monthly lines | None |

Not in the block: the deed's transfer tax (usually the seller's in Florida and California), the owner's title policy, recording
fees, lender and seller credits.

## Property tax

The estimate has two parts (the study with the owner, 2026-11-18):

1. **The taxable value after the sale.** State law sets the rule; each county applies it.
   - California: the sale resets the assessed value to the price (Prop 13). The value is exact.
   - Florida: the sale removes the cap. The first value after the sale is the appraiser's just value. The calculator uses k × the
     price, where k is the county's median ratio of the 2026 just value to the 2025 sale price, per type of home (Spatia Home's
     statewide back-test, `tax-backtest-fl.generated.json`).
   - Elsewhere: the price at the area's effective rate.
2. **The rate.** Rates are published, so they are read, not modelled.
   - Florida: each tax district's 2025 school and non-school mills (spatia-data `fl_tax_district_rates`). The default district is
     the one at the county's parcel-weighted median rate. The user can choose the district.
   - California: 1 % plus the voter-approved rate. The county's typical rate area where its rate book is read, else the median of
     the counties that are read.
   - Elsewhere: the area's effective rate: owners' median real estate taxes ÷ median home value (Census ACS 5-year, tract figures
     weighted by owner-occupied homes, per county). In a state that caps the taxed value until a sale, a new owner usually pays
     more than this rate.
3. **Exemptions** are case by case. The calculator applies Florida's homestead exemptions when the buyer will live in the home.
   Other states' exemptions are not modelled yet.
4. **Flat charges** are their own line ("Flat charges on the tax bill"), never inside the property tax. Florida, with an
   address: the parcel's 2025 non-ad-valorem assessments on the county tax roll (spatia-data `fl_parcel_tax_district`
   `nav_total_usd`; a county file with no row for the parcel is "not known", never zero). Other states and a ZIP alone: $0
   with a note to read the seller's bill (California's Mello-Roos included). The user can enter the figure.

### Why the Florida range applies here and not in Home

Home's report has only the listing price, so a house's k × price groups ship no figure there (owner ruling D1, 2026-11-17). The
calculator's input is the price the buyer pays. The back-test measured those groups on the SALE price, so the calculator shows a
range wherever the group passed every bar (`passed` in `fl-tax.generated.json`). The range assumes the district is right: with
the default district, the error can be larger.

## Known limits of the pilot

- Treasury's homeowners figure is from 2022, brought to date with a NATIONAL index. It is the ZIP's average, not this home's.
- The location is a ZIP code. A ZIP can cross county and district lines; the calculator takes the county with most of the ZIP's
  land.
- Texas: the Comptroller's rates per taxing unit (`src/lib/texas.ts`; spatia-data `tx_property_tax_rates`, promoted to stable
  2026-11-18, `docs/texas-promotion.md`). The default units are the county, the school district at the address and the postal
  city; special districts are the user's to tick. Texas does not publish sale prices, so the figure has no tested range.
- No tax deduction, no appreciation, no opportunity cost of the down payment (owner 2026-11-20: not wanted), no rent comparison
  (owner 2026-11-20: not wanted). Closing costs outside Florida and Texas have no tax line.
- The address lookup (`/api/lookup`, the Worker) answers only a rooftop-grade point from Spatia's geocoder. It reads FEMA's flood
  zone everywhere; in Florida the county roll's use, living area, year built and the parcel's tax district; in Texas the school
  district at the point; and, in every state, RentCast's property record (owner direction 2026-11-18: "Use rentcast property
  info for better estimation"): the type, living area, bedrooms, year built, heating fuel, cooling, pool and HOA fee become
  defaults (the Florida roll wins where it has the fact), and the current owner's latest tax bill is a note on the tax line.
  Only allowlisted fields are read (`src/lib/rentcast.ts`); no owner field, zoning or APN. Each lookup can cost one RentCast
  call: the Worker allows 10 lookups a minute per visitor (Cloudflare's rate limiter); there is no daily cap.
  Since the same day (owner: "Use asking price from rentcast") the lookup also reads RentCast's ACTIVE sale listing for the
  address (`/v1/listings/sale`, a second call): its asking price is the price default (else the county's typical value), and
  its HOA fee fills the fee when the property record has none. Never the listing agent, office or MLS fields.

## Next steps (for the owner)

1. Done 2026-11-18: the address lookup (the Worker at cost.runspatia.com).
2. Done 2026-11-18: Texas's rates per taxing unit. Later: the Comptroller's property value study as the value ratio.
3. More states with a roll back-test, or the state's sales-ratio study as the value ratio.
4. Done 2026-11-20: Treasury's 2022 premiums brought to date with BLS's national premium index. Later: a state index, if one is
   published.
5. Done 2026-11-20: the one-time costs at closing (HMDA and Florida's statutes). Later: transfer and recording taxes of more states.

The side-by-side test of the property tax against the methods of other calculators: `docs/side-by-side-test.md` (2026-11-20).

## Rebuilding the data

```bash
eval "$(../spatia-report/.claude/skills/query-token/query-token.sh env "cost calculator data")"
pnpm data
pnpm data --only hoi-index,closing   # only the BLS index and HMDA's closing costs: no token needed
```

The build caches each read under `.cache/`. If the token expires (15 minutes), mint a new one and run again.
