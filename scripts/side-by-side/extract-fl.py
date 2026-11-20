"""Florida 2024 sales with each buyer's 2025 bill, for the side-by-side test (docs/side-by-side-test.md).

Reads spatia-data's published fl_parcels (the 2025 roll) and fl_parcel_tax_district (the parcel's district and the 2025 mills)
from R2 (CLOUDFLARE_R2_* in the environment). Roll columns only: no owner, name, address or parcel id leaves this script.

  uv run --with duckdb python scripts/side-by-side/extract-fl.py .cache/side-by-side-fl.json

The sale rules are the Home back-test's (spatia-report scripts/experiments/tax-backtest-fl): qualification 01 / 02, improved (I),
one parcel, DOR use 001 / 004, not built in 2024 or later. The cases are its two: no exemption (taxable = just value) and homestead
only ($25,000 off every levy and the additional exemption off the non-school levies, no portability).
"""
import duckdb, json, os, sys

c = duckdb.connect()
c.execute("INSTALL httpfs; LOAD httpfs; SET enable_progress_bar=false")
ep = os.environ["CLOUDFLARE_R2_ENDPOINT"].replace("https://", "")
c.execute(f"CREATE SECRET (TYPE s3, KEY_ID '{os.environ['CLOUDFLARE_R2_ACCESS_KEY_ID']}', SECRET '{os.environ['CLOUDFLARE_R2_SECRET_ACCESS_KEY']}', ENDPOINT '{ep}', URL_STYLE 'path', REGION 'auto')")
b = "s3://" + os.environ["CLOUDFLARE_R2_BUCKET"] + "/layers/state/FL/"

rows = c.execute(f"""
WITH s AS (
  SELECT county_fips, parcel_id, dor_uc, jv, av_sd, av_nsd, tv_sd, tv_nsd, act_yr_blt, sale_prc1 AS price, sale_mo1 AS mo
  FROM '{b}fl_parcels.parquet'
  WHERE asmnt_yr = 2025 AND sale_yr1 = 2024 AND CAST(qual_cd1 AS VARCHAR) IN ('01', '02', '1', '2') AND vi_cd1 = 'I'
    AND trim(coalesce(m_par_sal1, '')) = '' AND dor_uc IN ('001', '004') AND coalesce(act_yr_blt, 0) < 2024
    AND sale_prc1 >= 50000 AND jv > 0
), t AS (
  SELECT county_fips, parcel_id, tax_auth_cd, school_millage, nonschool_millage, rate_status
  FROM '{b}fl_parcel_tax_district.parquet'
)
SELECT s.county_fips, s.dor_uc, s.price, s.mo, s.jv, s.av_sd, s.av_nsd, s.tv_sd, s.tv_nsd, t.tax_auth_cd, t.school_millage, t.nonschool_millage, t.rate_status
FROM s JOIN t USING (county_fips, parcel_id)
""").fetchall()

out, skipped = [], {"rate": 0, "case": 0}
for (county, uc, price, mo, jv, av_sd, av_nsd, tv_sd, tv_nsd, auth, school, nonschool, rate_status) in rows:
    if school is None or nonschool is None or rate_status not in ("printed", "total_from_county_millage_chart"):
        skipped["rate"] += 1
        continue
    ex_sd, ex_nsd = av_sd - tv_sd, av_nsd - tv_nsd
    if av_sd == jv and av_nsd == jv and ex_sd == 0 and ex_nsd == 0:
        case = "none"
    elif av_sd == jv and av_nsd == jv and ex_sd == 25000 and 25000 <= ex_nsd <= 25000 + 25722:
        case = "homestead"
    else:
        skipped["case"] += 1
        continue
    truth = (tv_sd * school + tv_nsd * nonschool) / 1000
    out.append({"county": str(county), "type": uc, "price": float(price), "mo": mo, "case": case, "district": str(auth), "truth": round(truth, 2)})

json.dump({"rows": out, "skipped": skipped, "read": len(rows)}, open(sys.argv[1], "w"))
print(len(rows), "read;", len(out), "kept;", skipped)
