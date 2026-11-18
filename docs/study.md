# Ownership cost calculator — pilot study

Date: 2026-11-18. Status: pilot.

## Goal

Show what a home costs to own each month: the loan, mortgage insurance, property tax, homeowners and flood insurance, the HOA
fee, energy, water and upkeep. Every input has an estimated default for the place. The user can change any input, or type their
own figure for any cost line.

## What each line is, and where its default comes from

| Line | Method | Source of the default | Range |
|---|---|---|---|
| Principal and interest | Standard amortised payment | Freddie Mac PMMS 30-year rate, latest week; 20 % down; 30 years | None (exact for the inputs) |
| Mortgage insurance | Loan × a yearly rate, until the loan is 78 % of the price | An assumed rate by down payment (`mortgage.ts` `PMI_BY_DOWN`); a lender quotes the real one | None |
| Property tax | See "Property tax" below | Florida DOR rolls and district rates; California's 1 % levy and rate books; Census ACS | Florida only, where the back-test passed |
| Homeowners insurance | The ZIP's average premium per policy, as published | U.S. Treasury FIO, ZIP, latest year (2022) | None |
| Flood insurance | The county's median new NFIP premium of similar homes (zone × main home) | FEMA NFIP policies (spatia-data `nfip_premiums_similar_homes`) | The state's back-test, 10th–90th percentile |
| HOA fee | The user's figure | None: no public source | None |
| Electricity and gas | Spatia Home's RECS 2020 formula (`energy.ts`, copied unchanged) | NOAA 1991–2020 normals at the nearest station; EIA-861 state price; EIA state gas price | The formula's 10th–90th percentile |
| Water, sewer, trash | A fixed monthly assumption | None: no national source of rates | None |
| Maintenance | 1 % of the price a year | The common rule | None |

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
4. **Flat charges** (waste, special districts, Mello-Roos) are not in the figure yet.

### Why the Florida range applies here and not in Home

Home's report has only the listing price, so a house's k × price groups ship no figure there (owner ruling D1, 2026-11-17). The
calculator's input is the price the buyer pays. The back-test measured those groups on the SALE price, so the calculator shows a
range wherever the group passed every bar (`passed` in `fl-tax.generated.json`). The range assumes the district is right: with
the default district, the error can be larger.

## Known limits of the pilot

- Treasury's homeowners figure is from 2022. Premiums have risen since in many states. It is the ZIP's average, not this home's.
- The location is a ZIP code. A ZIP can cross county and district lines; the calculator takes the county with most of the ZIP's
  land.
- Texas: the path over the Comptroller's rates per taxing unit is built (`src/lib/texas.ts`) and waits for spatia-data to promote
  `tx_property_tax_rates` (`docs/texas-promotion.md`). Until then Texas uses the area rate.
- No closing costs, no tax deduction, no appreciation, no opportunity cost of the down payment.
- The address lookup (`/api/lookup`, the Worker) answers only a rooftop-grade point from Spatia's geocoder. It reads FEMA's flood
  zone everywhere; in Florida the county roll's use, living area, year built and the parcel's tax district; in Texas the school
  district at the point. Other states' home facts are the user's inputs.

## Next steps (for the owner)

1. Done 2026-11-18: the address lookup (the Worker at cost.runspatia.com).
2. Texas: promote the rate layer in spatia-data (`docs/texas-promotion.md`); later, the Comptroller's property value study as the
   value ratio.
3. More states with a roll back-test, or the state's sales-ratio study as the value ratio.
4. A dated index for Treasury's 2022 premiums, only if a published index supports it.

## Rebuilding the data

```bash
eval "$(../spatia-report/.claude/skills/query-token/query-token.sh env "cost calculator data")"
pnpm data
```

The build caches each read under `.cache/`. If the token expires (15 minutes), mint a new one and run again.
