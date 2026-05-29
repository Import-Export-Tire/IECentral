# FLAGGED FOR GEORGE — Falken (FAL) at R20 number mismatch

**Date flagged:** 2026-05-29
**Reporter:** Andy
**Affected reports:** Sales Dashboard, Sales by Day, Sales History

## The problem

Andy's Falken vendor report shows **R20 sold 417 Falken tires in May 2026**.
Our system (Sales Dashboard / Sales by Day / Sales History) shows **194
sold + 2 customer returns** for the same period.

## Root cause (per Andy)

> "He is using a different report to get us that number — ART24 report,
> not the OEAVAL report."

Our entire sales pipeline reads JMK's **OEA07V** (a.k.a. OEAVAL) files
from S3 (`s3://ietires-dunlop-jmk-uploads/jmk-uploads/YYYYMM/`). The
417 number is sourced from **ART24**, a different JMK report that we
do not currently ingest.

## What we verified about OEA07V before flagging

Using the new `diagnoseLocation` debug mode on
`/api/reports/sales-by-day`, OEA07V's R20 FAL May 2026 data contains:

| Transaction | Rows | Sum qty | Notes |
|-------------|------|---------|-------|
| Sld         | 125  | -417    | Gross sales |
| ReS         | 138  | +431    | Mostly "IMPORT EXPOR" — internal stock receipts mis-coded as customer returns |
| TrO         | 6    | -21     | Outgoing transfers — correctly filtered |

After our fixes (5/29 commits):
- 194 → counted as **sold** (Sld only, strict activity date in May)
- 2   → counted as **returns** (external-customer ReS only)

Widening to **April + May activity dates** brings sold to **413** — close
to but not equal to 417. This suggests ART24 uses a different posting
window (likely posting/invoice date instead of activity date) OR includes
transaction types we exclude.

## What's worth checking with JMK

1. **Get the ART24 file format / sample export.** Once we have a sample
   we can compare row-by-row against OEA07V for the same period to
   confirm what ART24 includes that OEA07V's Sld doesn't.

2. **Date-column question.** OEA07V column 18 (`ActivityDate`) is what
   we filter on. ART24 may use:
   - Invoice date
   - Posting date / accounting period
   - Ship date

3. **Transaction-type question.** OEA07V's `Sld` is what we count as
   "sold." ART24 may also include some `Adj/*` or other codes that we
   currently exclude.

4. **Brand-code question.** Falken's vendor portal might include
   sub-brands (Ohtsu `OX`, Sumitomo `SUM`) that we filter as separate
   brands. Checked at R20: `OX` 0 tires, `SUM` 2 tires — so this is
   not the gap source.

## What's in place to help debug

- `GET /api/reports/sales-by-day?diagnoseLocation=R20&startDate=...&endDate=...`
  returns a full pre-filter breakdown of: transaction codes, qty signs,
  brand mix, account patterns, product types, ReS customer breakdown,
  per-(brand × trn) totals, and samples of raw FAL Sld + ReS rows.
- `?skipDedup=true` bypasses our duplicate-row dedup (verified: not the cause).

## Recommended next step

When George has time, get a sample ART24 export covering R20 + FAL May
2026 and diff against our OEA07V extract. Once we know what extra rows
ART24 has, we can either (a) ingest ART24 in addition to OEA07V or
(b) loosen our OEA07V filters to capture the same scope.
