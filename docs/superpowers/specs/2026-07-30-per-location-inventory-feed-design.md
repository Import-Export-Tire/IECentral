# Per-location inventory feed — design

Status: approved for planning
Author: Andy Barrows (with Claude)
Date: 2026-07-30

## Problem

JMK will begin delivering inventory reports over the inbound SFTP server as one
file per location, named `<locationName>.csv`, arriving every 15 minutes at
:10, :25, :40 and :55 past the hour, into the `/inventory` logical folder
(`s3://ietires-dunlop-jmk-uploads/jmk-uploads/oeival/`).

Three problems follow from that:

1. **No history.** Every arrival reuses the same filename, so each one silently
   overwrites the last. There would be no historical record at all.
2. **No way to identify the current file.** Staff need to know which file to
   reference for a given point in time.
3. **Partial data would replace the full picture.** `_cache/latest.*` is
   rebuilt on every object created under that prefix and today holds the daily
   full `All IET-oeival` snapshot. A single-location file arriving every 15
   minutes would leave the cache holding one store's rows, breaking the
   inventory reports.

These per-location reports are intended to **replace** the daily manual uploads
(currently performed by hand every weekday), and the reports should update as
files arrive.

## Goals

- Preserve every arrival as a durable, timestamped historical record.
- Make "which file is current" unambiguous.
- Assemble the full inventory picture from the freshest file per location.
- Retire manual OEIVAL uploads once — and only once — the feed is producing data.
- Refresh the inventory reports on each arrival.
- Automate all of it, including archive organization and expiry.

## Non-goals

- Changing the outbound Dunlop reporting flow.
- Changing the OEA07V sales or hourly tires pipelines.
- Changing the cumulative tire-label index (`_cache/lookup.*`) semantics; it
  already merges by `itemId`, never shrinks, and anticipates partial uploads.
- Granting the SFTP role any read or delete access. It stays upload-only.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Target folder | `/inventory` → `jmk-uploads/oeival/` | Chosen by Andy. These are inventory reports and share the OEIVAL column layout. |
| Naming model | Stamped only; the plain `<LOC>.csv` is removed | Chosen by Andy. Exactly one canonical name per arrival. |
| Stamp format | `<LOC>_YYYYMMDD-HHMM.csv`, US Eastern | Matches the convention JMK's own tires feed already emits (`tires-20260729-130001`); sorts chronologically as text; reads as local wall-clock time. |
| Implementation shape | One Lambda, self-filtering by key pattern | S3 event filters support only prefix and suffix, so two functions would each receive every event and still have to self-filter — double the invocations for no reduction in logic. |
| Cache semantics | Per-location replace | These files collectively are the full picture; the union of freshest-per-location replaces the single full snapshot. |
| Manual upload retirement | Hidden from the UI only while the feed is live, admin override always available | Andy: must not block manual uploads until automatic ones start. Data-driven, so it reverts on its own if the feed dies. |
| Archive layout | `<LOC>/<YYYYMM>/<LOC>_<stamp>.csv` | A flat folder would grow ~480 files/day at five locations and become unbrowsable, defeating the goal of easy historical reference. |
| Retention | 90 days, via S3 lifecycle rule, configurable in the template | No manual filing or cleanup. |

## Architecture

Implemented as four phases in order. Phase 3 must not ship until phase 2 is
proven in production.

### Phase 1 — Arrival stamping

`oeival_processor` gains a mode dispatch as the first action in its handler,
selected purely by object name:

| Key under `jmk-uploads/oeival/` | Mode |
|---|---|
| `R20.csv` — bare name at prefix root | STAMP |
| `R20/202607/R20_20260729-1010.csv` — stamped, in archive layout | INGEST |
| `202607/All IET-oeival 072926.csv` — month folder | Existing full-snapshot behavior, unchanged |
| `_cache/…` | Skipped, as today (the cache write itself fires this notification) |
| Any other root-level file, e.g. `R20 ONLY.csv`, `helloworld.txt` | Skipped |

That last row is a deliberate **behavior change**. Today any root-level `.csv`
is processed as a full snapshot, because the path contains `oeival` and so
passes the existing substring check. Under per-location merge semantics that is
dangerous: a stray root file such as `IET-oeival R20 ONLY.csv` — a name that
matches neither pattern, having a space in it — would be treated as a full
snapshot and replace the entire cache with one location's rows. Full-snapshot
treatment therefore requires a month folder from here on, and unmatched
root-level files are skipped and logged rather than processed.

Location tokens are uppercased when building the stamped name and archive path,
so an arrival of `r20.csv` produces `R20/202607/R20_20260729-1010.csv`. Without
this, `R20` and `r20` would archive into separate folders and merge as two
distinct locations.

Patterns, anchored so they cannot overlap:

- STAMP: `^jmk-uploads/oeival/(?P<loc>[A-Za-z0-9]{2,8})\.csv$`
- INGEST: `^jmk-uploads/oeival/(?P<loc>[A-Za-z0-9]{2,8})/\d{6}/(?P=loc)_\d{8}-\d{4}(-\d{2})?\.csv$`
- FULL: `^jmk-uploads/oeival/\d{6}/[^/]+\.(csv|xlsx|xls)$`

All three are required. Dispatch is: FULL, then INGEST, then STAMP, else skip.
The distinction between INGEST and FULL is depth — INGEST is
`<LOC>/<YYYYMM>/<file>`, FULL is `<YYYYMM>/<file>` — so both must be matched
explicitly rather than letting either fall through to a default.

STAMP does exactly three things and no parsing: copy to the stamped key in the
archive layout, verify the copy, delete the original. The copy raises a fresh S3
event whose key matches INGEST, so parsing happens on the second pass. A stamped
name can never match the STAMP pattern, so the loop terminates structurally
rather than by a counter or marker.

The timestamp is derived from the event's `eventTime`, converted to
`America/New_York` and formatted `YYYYMMDD-HHMM`. Event time rather than
wall-clock "now" keeps the result deterministic across retries.

If the name already carries a stamp, STAMP is a no-op. Should JMK later begin
sending stamped names themselves, this step simply stops firing; nothing needs
to change.

Idempotency, required because S3 delivers at-least-once:

- Stamped key exists with the same ETag → treat the copy as done, retry only the
  delete.
- Stamped key exists with a different ETag → append `-01`, `-02` rather than
  overwrite.

### Phase 2 — Per-location cache merge

For INGEST arrivals, `_cache/latest.items.ndjson.gz` changes from whole-file
replacement to per-location replacement:

1. Parse the incoming file.
2. Collect the set of `location` values present in its rows.
3. Load existing cache items; drop every row whose `location` is in that set.
4. Append the incoming rows; write back.

**Locations come from the file's `location` column, not the filename.** The
filename is a hint only; content wins, and a mismatch is logged. A file named
`R20.csv` containing two locations therefore still behaves correctly, and data
correctness does not depend on JMK's naming discipline.

**Destructive-arrival guard:** if the file parses to zero rows, or yields no
`location` values, the merge aborts and drops nothing. Without this, one
truncated arrival would erase a store's inventory until the next good file.

Month-folder full snapshots keep replace-all semantics, so during transition a
manual `All IET-oeival` upload resets everything and per-location arrivals then
update slices on top of it.

`latest.meta.json` gains:

```json
"perLocation": {
  "R20": { "lastArrivalAt": "2026-07-29T14:10:00Z", "rowCount": 1234, "sourceKey": "jmk-uploads/oeival/R20/202607/R20_20260729-1010.csv" }
}
```

This powers both silent-location detection and the phase 3 cutover.

**Concurrency.** Multiple locations landing on the same tick means concurrent
read-modify-write against one S3 object, where the last writer wins and the
others are lost. Both mitigations are applied:

- Reserved concurrency of 1 on the processor, so arrivals serialize.
- Conditional `PutObject` with `If-Match` on the ETag, retried with bounded
  backoff if the race is lost.

Together these turn a silent data-loss bug into a retry.

One consequence worth accepting knowingly: reserved concurrency of 1 serializes
*all* work in this function, including the daily 174 MB full-snapshot upload
while manual uploads remain in use. A large snapshot can therefore delay
per-location merges for its duration. At a 15-minute cadence with small
per-location files this is acceptable, and it disappears once manual uploads are
retired. If it proves too slow in practice, the alternative is to drop reserved
concurrency and rely on the `If-Match` retry alone.

### Phase 3 — Manual upload cutover

"Is the feed live" is answered from data, not configuration: live if any
`perLocation.lastArrivalAt` falls within a 90-minute window. Given the
15-minute cadence, that tolerates several missed ticks without flapping.

`app/api/reports/upload-status/route.ts` already reports per-type freshness and
is the place to expose this. The upload page hides the OEAVAL 77 option while
the feed is live and shows it again automatically when it is not — no deploy
needed in either direction. An admin-only override remains available at all
times, with a warning that a full-snapshot upload resets per-location data.

### Phase 4 — Live reports

The inventory routes already read `_cache/latest.*`, so refreshing the cache on
each arrival delivers this. Added: a per-location freshness display so a silent
store is visible rather than quietly stale.

## Error handling

In every failure case the cache retains its previous contents. Nothing is
dropped without a good replacement in hand.

| Condition | Behavior |
|---|---|
| Unparseable CSV | Abort merge, cache untouched, log and emit metric. File remains archived and can be re-driven. |
| Zero rows, or no `location` values | Abort. Guard against a truncated arrival erasing a store. |
| Unknown location code | Ingest anyway and flag in meta. A new store must not break the feed. |
| Copy or delete fails during STAMP | S3 redelivery plus the ETag check retries safely. A stuck file is visible because it never leaves the prefix root. |
| Lost `If-Match` race | Bounded retry with backoff; on exhaustion fail loudly rather than drop silently. |
| Location goes silent | Surfaced per-location in the reports, plus an alarm. |

Three CloudWatch alarms: merge-aborts, stamp-failures, and feed-quiet. The last
doubles as the signal that manual uploads have reappeared in the UI.

## Testing

No Python test framework exists in `aws/` today (`test_sftp.py` is a handler,
not a test). This adds pytest under `aws/dunlop-reporter/lambdas/tests/` for the
parse-and-merge logic — pure functions, no AWS needed, and where the destructive
risk lives.

Unit fixtures: single location; multiple locations in one file; empty file;
header-order variation; missing `location` column; duplicate `itemId`s; unknown
location code.

Three cases specifically required because they are the production failure modes:

1. Replaying the same S3 event twice yields one stamped file and one merge.
2. Two concurrent merges both survive, via the `If-Match` retry.
3. End-to-end: upload a fixture as `R20.csv` over real SFTP, then assert the
   stamped key exists in the archive layout, the cache is correct, and the plain
   file is gone.

Feed-live threshold logic gets vitest coverage on the TS side (`npm test`).

## Infrastructure and permissions

- `s3:DeleteObject` on `jmk-uploads/oeival/*` for the processor's role. The SFTP
  role is untouched and stays upload-only.
- Reserved concurrency of 1 on `dunlop-oeival-processor`.
- S3 lifecycle rule expiring stamped archive files after 90 days.
- `tzdata` added to `aws/dunlop-reporter/lambdas/requirements.txt` — the Lambda
  Python runtime ships no IANA zone data, so `zoneinfo` would fail at runtime
  and the Eastern timestamp depends on it.
- Three CloudWatch alarms as above.

All of the above belong in `aws/dunlop-reporter/template.yaml`.

## Assumptions to confirm during implementation

These are assumptions with a resolution path, not open requirements. Neither
blocks planning.

1. **Location list.** The authoritative set of sending locations is not yet
   confirmed. `LOCATIONS` in `transform_and_upload.py` holds W07, W08, W09 and
   R10, while R20 appears elsewhere in the system. The design deliberately does
   not hardcode a list: locations are read from file content and tracked in
   `perLocation`, so an unexpected code is ingested and flagged rather than
   rejected. Confirming the list only improves silent-location alerting.
2. **Column layout.** These files are assumed to share the OEIVAL 77 layout that
   `HEADER_MAP` in `oeival_processor.py` already handles. The existing
   `IET-oeival R20 ONLY.csv` in S3 is a single-location sample and could not be
   read during design (the `ietires` profile lacks `GetObject`). Verify against
   the first real arrival, or against that sample with admin credentials, before
   writing the parser tests.

## Rollout order

1. Phase 1 and 2 behind the existing manual flow, which keeps running unchanged.
2. Verify against real arrivals: stamped keys correct, cache complete across all
   locations, no lost updates under concurrent ticks.
3. Phase 3 — cutover, which activates on its own once arrivals are flowing.
4. Phase 4 — freshness display.
