# Spatia ownership cost calculator (pilot)

What a home costs to own each month: the loan, mortgage insurance, property tax, homeowners and flood insurance, the HOA fee,
electricity and gas, water and upkeep. Enter the home's street address. Every input starts from an estimate for that home; change
any input, or type your own figure for any cost.

The method and the sources are in [docs/study.md](docs/study.md).

```bash
pnpm install
pnpm dev        # the app on http://localhost:5173/
pnpm test       # the estimate rules
pnpm build      # typecheck and the static site in dist/
pnpm data       # rebuild the data tables (needs a Spatia data-service token; see docs/study.md)
```

Live at https://cost.runspatia.com: one Cloudflare Worker (`workers/app.ts`, `wrangler.jsonc`) serves the static site and
`/api/lookup` (an address → Spatia's geocoder and data service). Deploy: `pnpm build && pnpm exec wrangler deploy`; the Worker's
secrets `SPATIA_CLIENT_ID` / `SPATIA_CLIENT_SECRET` are a spatia-auth service client (audience `geocode`). Locally, put them in
`.dev.vars` (git-ignored) and run `pnpm exec wrangler dev`.

The site's data: the data tables are JSON files under `public/data/` and `src/data/`, built by `scripts/build-data.ts`.
Two modules come from Spatia Home (`spatia-report`): the RECS energy formula (`src/lib/energy.ts`,
`src/data/energy-formula.generated.json`) and Florida's tax back-test (`src/data/fl-tax.generated.json`, trimmed by the build).
