# Request to spatia-data: promote `tx_property_tax_rates` (pilot → stable)

Date: 2026-11-18. From: the ownership cost calculator. Owner direction the same day: "Go on Texas".

## What the calculator reads

- Layer `tx_property_tax_rates` (version 2025, the Comptroller's preliminary "Working" edition), keyed by county `GEOID`, columns
  `GEOID`, `unit_id`, `unit_class`, `unit_name`, `total_rate`, `school_district_geoid`, `market_value`, `taxable_value`,
  `taxable_value_mo`, `rates_reported`.
- Layer `us_school_districts_unified` (`covers` at a trusted geocode), `GEOID`: the school district at the address.

## How it follows the layer's notes

- It never sums a county's rows. The default units are: every `county` row; the ONE school district whose `school_district_geoid`
  equals the unified district covering the address (else the county's largest by value, which the page says to change); and, only
  with an address, the ONE city unit whose name is the geocoder's postal city (the page says a postal city can lie outside the city
  limits). Special districts are never a default: the user ticks the ones on the bill.
- Per-unit arithmetic only: price × `total_rate` / 100, with the $140,000 school homestead exemption on the school row only.
- A row with `rates_reported = false` is not offered.

## The pilot read (with `with_pilot`, build `20261118T160706Z-96862b47-00c564+24fdfb6278b8`, local preview only)

| Check | Result |
|---|---|
| Counties read | 254 of 254 |
| Rows | 5,734 (county slices) |
| Exactly one `county` row per county | 254 of 254 |
| School-district rows with a `school_district_geoid` | 1,549 of 1,549 |
| Rows with `rates_reported = false` | 310 (left out) |
| 1503 W 9th St, Austin: unified district at the point | `4808940`, matches the Austin ISD row (`227-901-02`, 0.9252) |

Nothing from the pilot is published: `public/data/county/TX.json` is built without it, and the build reads Texas only when the
catalog stops withholding the layer.

## What happens after promotion

`pnpm data` in this repo reads the layer, writes the Texas units into `public/data/county/TX.json`, and the Texas tax line
changes from the area rate to the units' rates. No code change is needed.

## Status (2026-11-18)

- Promotion LANDED on spatia-data `main` (`63bcf52`): `maturity="stable"`, the layer's owner file
  (`kb/layers/parcel/tx_property_tax_rates/MEMORY.md`) records the evidence and the owner's words. The gate passed.
- One step remains: the metadata write to the bucket, run from a spatia-data checkout at `origin/main`:
  `uv run spatia-data refresh-metadata --only tx_property_tax_rates --apply` (dry run: "manifest tx_property_tax_rates:
  maturity pilot → stable", no sidecar or parquet change).
- Then, once the query box serves a build with the layer stable: `pnpm data` here, `pnpm build`, and
  `CLOUDFLARE_API_TOKEN=… pnpm exec wrangler deploy`.
