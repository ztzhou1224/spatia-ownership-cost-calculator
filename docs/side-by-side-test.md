# Side-by-side test: the new owner's property tax in Florida

Date: 2026-11-20. Owner direction 2026-11-20 (item 1 of the comparison with other calculators: "start with 1 and 2").

## Question

How close is this calculator's property tax to a buyer's real first bill, and how close are the methods that other calculators
use?

## The test

- **Sales:** every Florida sale in 2024 on the 2025 roll (spatia-data `fl_parcels`): qualification code 01 or 02, improved, one
  parcel, a house (DOR use 001) or a condominium (004), not built in 2024 or later, $50,000 or more. The same rules as Spatia
  Home's back-test.
- **Cases:** no exemption (taxable value = just value) and homestead only ($25,000 off every levy and the additional exemption off
  the non-school levies, no portability). Other sales are left out.
- **Truth:** the bill's ad valorem part: the buyer's 2025 school and non-school taxable values × the parcel's 2025 mills
  (spatia-data `fl_parcel_tax_district`). Flat charges are left out on both sides. These are real 2025 rates, not a forecast.
- **241,010 sales** in 63 of the 67 counties (3,090 left out for a rate that is not settled, 49,419 for another exemption case).
- The calculator's k (the first just value ÷ the price) was measured on **2025** sales and **2026** values. This test uses
  **2024** sales and **2025** values, so it is a test on a different year.

## The three methods

| Method | What it does | Who uses it |
|---|---|---|
| **Ours** | k × the price, the parcel's district mills, less the homestead exemptions when the buyer lives in the home (`src/lib/tax.ts`) | This calculator, with an address |
| **County rate** | The price × the county's effective rate (Census ACS: owners' median tax ÷ median value) | The method Zillow's property tax calculator describes. Zillow's own rate table is not public, so the rate here is the Census rate. |
| **Flat 1.25 %** | The price × 1.25 % | The default of one generic calculator in a published review |

## Result

All 241,010 sales:

| Method | Median estimate ÷ bill | Median error | Within 10 % | Within 20 % | 90th-percentile error | More than 20 % too low |
|---|---|---|---|---|---|---|
| **Ours** | **1.00** | **6 %** | **69 %** | **90 %** | **20 %** | **4 %** |
| County rate | 0.60 | 40 % | 4 % | 11 % | 53 % | 88 % |
| Flat 1.25 % | 0.97 | 18 % | 29 % | 55 % | 49 % | 21 % |

By case and type:

| Group | Sales | Ours: median error / within 20 % | County rate: median ÷ bill / within 20 % | Flat 1.25 %: median ÷ bill / within 20 % |
|---|---|---|---|---|
| No exemption | 157,418 | 6 % / 90 % | 0.57 / 8 % | 0.92 / 53 % |
| Homestead | 83,592 | 6 % / 90 % | 0.66 / 18 % | 1.06 / 58 % |
| Houses | 187,143 | 6 % / 90 % | 0.60 / 11 % | 0.98 / 58 % |
| Condominiums | 53,867 | 6 % / 91 % | 0.60 / 13 % | 0.95 / 45 % |

**Our range:** the calculator shows a range on 48 % of these sales (the back-test groups that passed every bar). The bill is
inside it on 82 % of them (the target is 8 in 10).

## What it shows

1. **The county rate method is too low for a new owner, almost every time.** The median estimate is 60 % of the bill, and 88 %
   of the estimates are more than 20 % too low. The reason: Florida caps the taxed value of a home until it sells. The county's
   effective rate is what current owners pay on capped values. A buyer pays on the full value. California and Texas have the
   same kind of rule, so the same error is likely there.
2. **A flat national rate is right on average in Florida, by chance, and wrong for each home.** Its median is close to the bill
   (0.97), but only 55 % of the estimates are within 20 %, because rates differ from one district to the next.
3. **Our method is within 20 % for 9 in 10 buyers,** in each case and type, on a year it was not fitted on.

## Limits

- **This test does not use the real Zillow or Redfin pages.** It tests the methods they describe. Zillow refuses automated
  access, Redfin does not describe its method, and the test keeps no address to type into them. Some sites use the last owner's
  tax bill; that method is not tested here (it needs the 2024 roll).
- Florida only: Florida publishes the rolls and the sale prices. No other state in the calculator has this test.
- The homestead exemption in our method is the 2026 amount ($26,411 more off the non-school levies); the 2025 amount was
  smaller, so our homestead figures are a few dollars low.
- The truth leaves out flat charges (waste, special districts). The calculator shows those on their own line.
- The test measures the property tax only. Insurance, energy and the other lines are not in it.

## Reproduce

```bash
# CLOUDFLARE_R2_* in the environment (spatia-data's published layers)
uv run --with duckdb python scripts/side-by-side/extract-fl.py .cache/side-by-side-fl.json
pnpm exec tsx scripts/side-by-side/evaluate.ts .cache/side-by-side-fl.json
```

The extract keeps no owner, name, address or parcel id. Its output stays in `.cache/` (not committed).
