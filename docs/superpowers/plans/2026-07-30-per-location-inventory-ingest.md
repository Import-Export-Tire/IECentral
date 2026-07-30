# Per-location Inventory Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp each per-location inventory file arriving over SFTP with an Eastern date-time, archive it, and merge it into the reporting cache per location so the union of freshest-per-location files is the full inventory picture.

**Architecture:** One Lambda (`dunlop-oeival-processor`) self-dispatches on object key into three modes — FULL (existing month-folder snapshot behavior), STAMP (rename an arrival, no parsing), INGEST (parse a stamped file and merge it into the cache by location). Two new pure modules hold the logic worth testing: key classification and the streaming per-location merge. The handler stays thin glue.

**Tech Stack:** Python 3.12 Lambda (SAM), boto3, gzipped NDJSON in S3, pytest for the new unit tests.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-30-per-location-inventory-feed-design.md`. It is authoritative; this plan implements Phases 1 and 2 only.
- Stamp format: `<LOC>_YYYYMMDD-HHMM.csv`, timezone `America/New_York`, derived from the S3 event's `eventTime` (never wall-clock `now`).
- Archive layout: `jmk-uploads/oeival/<LOC>/<YYYYMM>/<LOC>_<stamp>.csv`. Location tokens are always uppercased.
- The plain `<LOC>.csv` is deleted after a verified copy. Stamped-only is the intended end state.
- Locations are read from the file's `location` column. The filename is a hint only; content wins.
- **Destructive-arrival guard:** if a file parses to zero rows, or yields no `location` values, abort and change nothing. This is the most important behavior in the plan.
- In every failure case `_cache/latest.*` retains its previous contents.
- `_cache/lookup.*` semantics are unchanged (cumulative union by `itemId`, never shrinks).
- Cache writes use conditional `PutObject` with `If-Match` and bounded retry.
- Reserved concurrency of 1 on the processor.
- Do NOT touch: the OEA07V sales pipeline, the hourly tires pipeline, the outbound Dunlop flow, or the SFTP role (stays upload-only).
- Phases 3 and 4 from the spec (manual-upload cutover, per-location freshness UI) are deliberately out of scope — the spec gates them on Phase 2 being proven against real arrivals. They get their own plan.

## File Structure

| File | Responsibility |
|---|---|
| Create `aws/dunlop-reporter/lambdas/oeival_keys.py` | Pure key classification and stamped-name construction. No AWS calls. |
| Create `aws/dunlop-reporter/lambdas/oeival_merge.py` | Pure streaming per-location merge of gzipped NDJSON, plus the abort guard. No AWS calls. |
| Modify `aws/dunlop-reporter/lambdas/oeival_processor.py` | Handler dispatch; STAMP and INGEST wiring. Existing parse/lookup code reused as-is. |
| Modify `aws/dunlop-reporter/lambdas/requirements.txt` | Add `tzdata`. |
| Create `aws/dunlop-reporter/lambdas/tests/test_oeival_keys.py` | Unit tests for classification and stamping. |
| Create `aws/dunlop-reporter/lambdas/tests/test_oeival_merge.py` | Unit tests for merge and guard. |
| Create `aws/dunlop-reporter/lambdas/tests/test_oeival_processor_modes.py` | Handler tests against a stub S3 client. |
| Create `aws/dunlop-reporter/lambdas/tests/requirements-dev.txt` | `pytest` for local runs. |
| Modify `aws/dunlop-reporter/template.yaml` | Reserved concurrency, `s3:PutObjectTagging`, tag-based lifecycle rule, log metric filters and alarms. |

The two new modules exist so the risky logic is testable without AWS. The handler keeps only orchestration.

---

### Task 1: Key classification and Eastern stamping

**Files:**
- Create: `aws/dunlop-reporter/lambdas/oeival_keys.py`
- Create: `aws/dunlop-reporter/lambdas/tests/test_oeival_keys.py`
- Create: `aws/dunlop-reporter/lambdas/tests/requirements-dev.txt`
- Modify: `aws/dunlop-reporter/lambdas/requirements.txt`

**Interfaces:**
- Consumes: nothing.
- Produces: `classify(key: str) -> tuple[str, str | None]` returning one of `"FULL"`, `"INGEST"`, `"STAMP"`, `"SKIP"` plus an uppercased location or `None`; `stamp_from_event_time(event_time: str) -> str` returning `"YYYYMMDD-HHMM"`; `archive_key(loc: str, stamp: str, dedupe: int = 0) -> str`; module constant `PREFIX = "jmk-uploads/oeival/"`.

- [ ] **Step 1: Create the dev requirements file**

```
# aws/dunlop-reporter/lambdas/tests/requirements-dev.txt
pytest>=8.0.0
```

- [ ] **Step 2: Add tzdata to the Lambda requirements**

The Lambda Python runtime ships no IANA zone database, so `zoneinfo` raises `ZoneInfoNotFoundError` at runtime without this. Append to `aws/dunlop-reporter/lambdas/requirements.txt` so it reads:

```
paramiko>=3.4.0
boto3>=1.34.0
tzdata>=2024.1
```

- [ ] **Step 3: Write the failing tests**

Create `aws/dunlop-reporter/lambdas/tests/test_oeival_keys.py`:

```python
import pytest

from oeival_keys import PREFIX, archive_key, classify, stamp_from_event_time


@pytest.mark.parametrize(
    "key,expected_mode,expected_loc",
    [
        # STAMP — bare location name at the prefix root
        (PREFIX + "R20.csv", "STAMP", "R20"),
        (PREFIX + "r20.csv", "STAMP", "R20"),          # uppercased
        (PREFIX + "W08.csv", "STAMP", "W08"),
        # INGEST — already stamped, in archive layout
        (PREFIX + "R20/202607/R20_20260729-1010.csv", "INGEST", "R20"),
        (PREFIX + "R20/202607/R20_20260729-1010-01.csv", "INGEST", "R20"),
        # FULL — month-folder snapshot, existing behavior
        (PREFIX + "202607/All IET-oeival 072926.csv", "FULL", None),
        (PREFIX + "202606/IET-oeival R20 ONLY.csv", "FULL", None),
        (PREFIX + "202607/snapshot.xlsx", "FULL", None),
        # SKIP
        (PREFIX + "_cache/latest.items.ndjson.gz", "SKIP", None),
        (PREFIX + "_cache/latest.meta.json", "SKIP", None),
        (PREFIX + "helloworld.txt", "SKIP", None),
        (PREFIX + "IET-oeival R20 ONLY.csv", "SKIP", None),   # space -> not a location token
        (PREFIX + "R20.txt", "SKIP", None),                   # wrong extension
        (PREFIX + "R20/202607/W08_20260729-1010.csv", "SKIP", None),  # folder/name mismatch
        ("jmk-uploads/sftp-sales/R20.csv", "SKIP", None),     # different prefix entirely
    ],
)
def test_classify(key, expected_mode, expected_loc):
    assert classify(key) == (expected_mode, expected_loc)


def test_stamp_from_event_time_converts_utc_to_eastern():
    # 14:10Z on 2026-07-29 is 10:10 EDT
    assert stamp_from_event_time("2026-07-29T14:10:03.000Z") == "20260729-1010"


def test_stamp_from_event_time_handles_offset_form():
    assert stamp_from_event_time("2026-07-29T14:10:03+00:00") == "20260729-1010"


def test_stamp_from_event_time_winter_is_est():
    # 14:10Z on 2026-01-15 is 09:10 EST
    assert stamp_from_event_time("2026-01-15T14:10:03Z") == "20260115-0910"


def test_archive_key_layout():
    assert archive_key("R20", "20260729-1010") == PREFIX + "R20/202607/R20_20260729-1010.csv"


def test_archive_key_dedupe_suffix():
    assert archive_key("R20", "20260729-1010", dedupe=1) == PREFIX + "R20/202607/R20_20260729-1010-01.csv"


def test_archive_key_output_is_ingest_classified():
    # A stamped key must never re-classify as STAMP, or stamping would loop.
    k = archive_key("R20", "20260729-1010")
    assert classify(k) == ("INGEST", "R20")
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd aws/dunlop-reporter/lambdas
python3 -m pip install -r tests/requirements-dev.txt
python3 -m pytest tests/test_oeival_keys.py -v
```

Expected: collection error — `ModuleNotFoundError: No module named 'oeival_keys'`.

- [ ] **Step 5: Write the implementation**

Create `aws/dunlop-reporter/lambdas/oeival_keys.py`:

```python
"""Key classification for the OEIVAL processor.

Pure functions — no AWS calls — so the dispatch rules are unit-testable.

Three shapes of object live under jmk-uploads/oeival/:

  FULL    202607/All IET-oeival 072926.csv        full snapshot (manual upload)
  STAMP   R20.csv                                 fresh SFTP arrival, needs a stamp
  INGEST  R20/202607/R20_20260729-1010.csv        stamped, ready to merge

S3 event filters support only prefix and suffix, so the function receives every
event and decides here. Dispatch order is FULL, INGEST, STAMP, else SKIP: FULL
and INGEST differ only in depth, so both must match explicitly rather than
letting either fall through.
"""

import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

PREFIX = "jmk-uploads/oeival/"
EASTERN = ZoneInfo("America/New_York")

FULL_RE = re.compile(r"^jmk-uploads/oeival/\d{6}/[^/]+\.(?:csv|xlsx|xls)$", re.IGNORECASE)
INGEST_RE = re.compile(
    r"^jmk-uploads/oeival/(?P<loc>[A-Za-z0-9]{2,8})/\d{6}/(?P=loc)_\d{8}-\d{4}(?:-\d{2})?\.csv$"
)
STAMP_RE = re.compile(r"^jmk-uploads/oeival/(?P<loc>[A-Za-z0-9]{2,8})\.csv$", re.IGNORECASE)

FULL = "FULL"
INGEST = "INGEST"
STAMP = "STAMP"
SKIP = "SKIP"


def classify(key: str) -> "tuple[str, str | None]":
    """Return (mode, location). Location is uppercased; None for FULL and SKIP."""
    if "_cache" in key:
        return SKIP, None
    if FULL_RE.match(key):
        return FULL, None
    m = INGEST_RE.match(key)
    if m:
        return INGEST, m.group("loc").upper()
    m = STAMP_RE.match(key)
    if m:
        return STAMP, m.group("loc").upper()
    return SKIP, None


def stamp_from_event_time(event_time: str) -> str:
    """'2026-07-29T14:10:03.000Z' -> '20260729-1010' in US Eastern.

    Event time rather than 'now' keeps the stamp identical across S3's
    at-least-once redeliveries.
    """
    iso = event_time.replace("Z", "+00:00")
    dt = datetime.fromisoformat(iso)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(EASTERN).strftime("%Y%m%d-%H%M")


def archive_key(loc: str, stamp: str, dedupe: int = 0) -> str:
    """-> jmk-uploads/oeival/<LOC>/<YYYYMM>/<LOC>_<stamp>[-NN].csv"""
    loc = loc.upper()
    month = stamp[:6]
    suffix = f"-{dedupe:02d}" if dedupe else ""
    return f"{PREFIX}{loc}/{month}/{loc}_{stamp}{suffix}.csv"
```

Note the `INGEST_RE` is deliberately case-sensitive so the `(?P=loc)` backreference enforces that folder and filename agree exactly; `archive_key` always uppercases, so real keys match.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd aws/dunlop-reporter/lambdas
python3 -m pytest tests/test_oeival_keys.py -v
```

Expected: 21 passed (15 parametrized `classify` cases plus 6 named tests). Verified — this exact code and test file were run during planning.

- [ ] **Step 7: Commit**

```bash
git add aws/dunlop-reporter/lambdas/oeival_keys.py \
        aws/dunlop-reporter/lambdas/tests/test_oeival_keys.py \
        aws/dunlop-reporter/lambdas/tests/requirements-dev.txt \
        aws/dunlop-reporter/lambdas/requirements.txt
git commit -m "feat(oeival): classify object keys and build Eastern-stamped archive names"
```

---

### Task 2: Streaming per-location merge

**Files:**
- Create: `aws/dunlop-reporter/lambdas/oeival_merge.py`
- Create: `aws/dunlop-reporter/lambdas/tests/test_oeival_merge.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `MergeAborted(Exception)`; `locations_of(items: list[dict]) -> set[str]`; `merge_items_ndjson(existing_gz: bytes | None, incoming: list[dict]) -> tuple[bytes, dict]`. The returned dict has keys `totalRows` (int), `filters` (dict with `locations`, `brands`, `productTypes`, `dclasses` — each a sorted list of str), `replacedLocations` (sorted list of str), `perLocationCounts` (dict of str to int).

Why streaming: the live `latest.items.ndjson.gz` is ~13 MB gzipped. Deserializing every row into a dict list and holding it alongside the output would risk the 2048 MB ceiling. This reads the existing cache line by line, writes surviving lines straight through, and only accumulates the small filter sets.

- [ ] **Step 1: Write the failing tests**

Create `aws/dunlop-reporter/lambdas/tests/test_oeival_merge.py`:

```python
import gzip
import io
import json

import pytest

from oeival_merge import MergeAborted, locations_of, merge_items_ndjson


def gz(items):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as f:
        for it in items:
            f.write(json.dumps(it).encode("utf-8"))
            f.write(b"\n")
    return buf.getvalue()


def ungz(blob):
    with gzip.GzipFile(fileobj=io.BytesIO(blob), mode="rb") as f:
        return [json.loads(line) for line in f if line.strip()]


def item(loc, item_id, brand="FAL", pt="T", dclass="A"):
    return {
        "location": loc,
        "itemId": item_id,
        "manufacturerName": brand,
        "productType": pt,
        "dclass": dclass,
        "qtyOnHand": 1,
    }


def test_replaces_only_the_incoming_location():
    existing = gz([item("R20", "OLD1"), item("W08", "KEEP1"), item("W09", "KEEP2")])
    blob, stats = merge_items_ndjson(existing, [item("R20", "NEW1")])
    rows = ungz(blob)
    assert sorted(r["itemId"] for r in rows) == ["KEEP1", "KEEP2", "NEW1"]
    assert stats["replacedLocations"] == ["R20"]
    assert stats["totalRows"] == 3


def test_replaces_every_location_present_in_the_file():
    existing = gz([item("R20", "OLD1"), item("W08", "OLD2"), item("W09", "KEEP1")])
    blob, stats = merge_items_ndjson(existing, [item("R20", "NEW1"), item("W08", "NEW2")])
    rows = ungz(blob)
    assert sorted(r["itemId"] for r in rows) == ["KEEP1", "NEW1", "NEW2"]
    assert stats["replacedLocations"] == ["R20", "W08"]


def test_first_run_with_no_existing_cache():
    blob, stats = merge_items_ndjson(None, [item("R20", "NEW1")])
    assert [r["itemId"] for r in ungz(blob)] == ["NEW1"]
    assert stats["totalRows"] == 1


def test_unknown_location_is_ingested_not_rejected():
    existing = gz([item("W08", "KEEP1")])
    blob, stats = merge_items_ndjson(existing, [item("ZZ99", "NEW1")])
    rows = ungz(blob)
    assert sorted(r["itemId"] for r in rows) == ["KEEP1", "NEW1"]
    assert stats["replacedLocations"] == ["ZZ99"]


def test_duplicate_item_ids_within_a_location_are_all_kept():
    # OEIVAL rows are per location+item; duplicates are data, not an error.
    blob, stats = merge_items_ndjson(None, [item("R20", "DUP"), item("R20", "DUP")])
    assert len(ungz(blob)) == 2
    assert stats["perLocationCounts"] == {"R20": 2}


def test_empty_incoming_aborts_and_changes_nothing():
    existing = gz([item("R20", "OLD1")])
    with pytest.raises(MergeAborted):
        merge_items_ndjson(existing, [])


def test_incoming_with_no_location_values_aborts():
    existing = gz([item("R20", "OLD1")])
    with pytest.raises(MergeAborted):
        merge_items_ndjson(existing, [item("", "NEW1")])


def test_corrupt_existing_lines_are_skipped_not_fatal():
    good = gz([item("W08", "KEEP1")])
    corrupt = good + b"not-gzip-json"
    blob, stats = merge_items_ndjson(corrupt, [item("R20", "NEW1")])
    assert sorted(r["itemId"] for r in ungz(blob)) == ["KEEP1", "NEW1"]


def test_filters_are_computed_from_the_merged_set_not_just_incoming():
    existing = gz([item("W08", "KEEP1", brand="DUN", pt="TL", dclass="B")])
    _, stats = merge_items_ndjson(existing, [item("R20", "NEW1", brand="FAL", pt="T", dclass="A")])
    assert stats["filters"]["locations"] == ["R20", "W08"]
    assert stats["filters"]["brands"] == ["DUN", "FAL"]
    assert stats["filters"]["productTypes"] == ["T", "TL"]
    assert stats["filters"]["dclasses"] == ["A", "B"]


def test_locations_of_uppercases_and_ignores_blanks():
    assert locations_of([item("r20", "A"), item("", "B"), item("W08", "C")]) == {"R20", "W08"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd aws/dunlop-reporter/lambdas
python3 -m pytest tests/test_oeival_merge.py -v
```

Expected: collection error — `ModuleNotFoundError: No module named 'oeival_merge'`.

- [ ] **Step 3: Write the implementation**

Create `aws/dunlop-reporter/lambdas/oeival_merge.py`:

```python
"""Per-location merge of the OEIVAL reporting snapshot.

The snapshot used to be replaced wholesale on every upload. Once inventory
arrives as one file per location every 15 minutes, that would leave the cache
holding a single store. This merges instead: rows for the locations present in
the incoming file are replaced, every other location is preserved.

Streaming by design. The live cache is ~13 MB gzipped; materialising it as a
list of dicts alongside the output would threaten the 2048 MB function ceiling.
Existing rows are read one line at a time and written straight through.
"""

import gzip
import io
import json
from typing import Any


class MergeAborted(Exception):
    """Raised when the incoming file cannot be trusted to replace anything.

    The caller must leave the cache untouched. This is the guard that stops a
    truncated or empty arrival from erasing a store's inventory.
    """


def locations_of(items: "list[dict[str, Any]]") -> "set[str]":
    """Uppercased, non-blank location values present in these rows."""
    out: "set[str]" = set()
    for it in items:
        loc = str(it.get("location", "") or "").strip().upper()
        if loc:
            out.add(loc)
    return out


class _Filters:
    """Accumulates the dropdown values while streaming, so no second pass."""

    def __init__(self) -> None:
        self.locations: "set[str]" = set()
        self.brands: "set[str]" = set()
        self.product_types: "set[str]" = set()
        self.dclasses: "set[str]" = set()

    def add(self, row: "dict[str, Any]") -> None:
        if row.get("location"):
            self.locations.add(str(row["location"]).strip().upper())
        if row.get("manufacturerName"):
            self.brands.add(str(row["manufacturerName"]))
        if row.get("productType"):
            self.product_types.add(str(row["productType"]))
        if row.get("dclass"):
            self.dclasses.add(str(row["dclass"]))

    def as_dict(self) -> "dict[str, list[str]]":
        return {
            "locations": sorted(self.locations),
            "brands": sorted(self.brands),
            "productTypes": sorted(self.product_types),
            "dclasses": sorted(self.dclasses),
        }


def merge_items_ndjson(
    existing_gz: "bytes | None",
    incoming: "list[dict[str, Any]]",
) -> "tuple[bytes, dict[str, Any]]":
    """Merge incoming rows into the existing gzipped NDJSON cache by location.

    Returns (gzipped_ndjson, stats). Raises MergeAborted if the incoming file
    has no rows or no usable location values.
    """
    if not incoming:
        raise MergeAborted("incoming file parsed to zero rows")

    replace = locations_of(incoming)
    if not replace:
        raise MergeAborted("incoming file has no location values")

    filters = _Filters()
    per_location: "dict[str, int]" = {}
    total = 0

    out_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=out_buf, mode="wb", compresslevel=6) as out:

        def emit(row: "dict[str, Any]") -> None:
            nonlocal total
            out.write(json.dumps(row, separators=(",", ":")).encode("utf-8"))
            out.write(b"\n")
            filters.add(row)
            loc = str(row.get("location", "") or "").strip().upper()
            if loc:
                per_location[loc] = per_location.get(loc, 0) + 1
            total += 1

        # Surviving rows from the existing cache, streamed line by line.
        if existing_gz:
            try:
                with gzip.GzipFile(fileobj=io.BytesIO(existing_gz), mode="rb") as src:
                    for raw in src:
                        line = raw.strip()
                        if not line:
                            continue
                        try:
                            row = json.loads(line)
                        except Exception:
                            continue  # tolerate a corrupt line rather than lose the cache
                        loc = str(row.get("location", "") or "").strip().upper()
                        if loc in replace:
                            continue  # superseded by the incoming file
                        emit(row)
            except Exception as e:
                # A truncated gzip tail is recoverable: keep whatever we read.
                print(f"merge: existing cache read ended early ({e}); keeping rows read so far")

        for row in incoming:
            emit(row)

    stats = {
        "totalRows": total,
        "filters": filters.as_dict(),
        "replacedLocations": sorted(replace),
        "perLocationCounts": per_location,
    }
    return out_buf.getvalue(), stats
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd aws/dunlop-reporter/lambdas
python3 -m pytest tests/test_oeival_merge.py -v
```

Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add aws/dunlop-reporter/lambdas/oeival_merge.py \
        aws/dunlop-reporter/lambdas/tests/test_oeival_merge.py
git commit -m "feat(oeival): streaming per-location merge with destructive-arrival guard"
```

---

### Task 3: STAMP mode — rename an arrival, idempotently

**Files:**
- Modify: `aws/dunlop-reporter/lambdas/oeival_processor.py`
- Create: `aws/dunlop-reporter/lambdas/tests/test_oeival_processor_modes.py`

**Interfaces:**
- Consumes: `classify`, `stamp_from_event_time`, `archive_key` from Task 1.
- Produces: `stamp_arrival(s3_client, bucket: str, key: str, loc: str, event_time: str) -> dict` returning `{"stamped": <new_key>, "deduped": <int>}`; module constant `ARCHIVE_TAG = "lifecycle=location-archive"`.

STAMP does three things and never parses: copy, verify, delete. The copy raises a fresh event that classifies as INGEST, so parsing happens on the second pass. A stamped name can never match `STAMP_RE`, so the loop terminates structurally.

- [ ] **Step 1: Write the failing tests**

Create `aws/dunlop-reporter/lambdas/tests/test_oeival_processor_modes.py`:

```python
import pytest
from botocore.exceptions import ClientError

import oeival_processor as op


def client_error(code, op_name="HeadObject"):
    """Build the ClientError shape boto3 actually raises.

    This matters: boto3's S3 client has no exceptions.PreconditionFailed, and
    head_object raises ClientError('404') rather than NoSuchKey. Stubbing the
    modelled classes instead would let broken production code pass its tests.
    """
    return ClientError({"Error": {"Code": code, "Message": code}}, op_name)


class StubS3:
    """Minimal stand-in for the boto3 S3 client.

    Objects is a dict of key -> (body_bytes, etag). Records every call so tests
    can assert on ordering, which is what makes the idempotency behavior
    observable.
    """

    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.calls = []

    def head_object(self, Bucket, Key):
        self.calls.append(("head", Key))
        if Key not in self.objects:
            raise client_error("404", "HeadObject")
        body, etag = self.objects[Key]
        return {"ETag": etag, "ContentLength": len(body)}

    def copy_object(self, Bucket, Key, CopySource, **kwargs):
        self.calls.append(("copy", CopySource["Key"], Key, kwargs.get("Tagging")))
        body, etag = self.objects[CopySource["Key"]]
        self.objects[Key] = (body, etag)
        return {"CopyObjectResult": {"ETag": etag}}

    def delete_object(self, Bucket, Key):
        self.calls.append(("delete", Key))
        self.objects.pop(Key, None)
        return {}


def test_stamp_copies_then_deletes_the_original():
    s3 = StubS3({"jmk-uploads/oeival/R20.csv": (b"a,b\n1,2\n", '"etag1"')})
    out = op.stamp_arrival(s3, "bucket", "jmk-uploads/oeival/R20.csv", "R20", "2026-07-29T14:10:03Z")

    assert out["stamped"] == "jmk-uploads/oeival/R20/202607/R20_20260729-1010.csv"
    assert out["deduped"] == 0
    assert "jmk-uploads/oeival/R20.csv" not in s3.objects
    assert out["stamped"] in s3.objects
    kinds = [c[0] for c in s3.calls]
    assert kinds.index("copy") < kinds.index("delete"), "must copy before deleting"


def test_stamp_applies_the_lifecycle_tag():
    s3 = StubS3({"jmk-uploads/oeival/R20.csv": (b"x", '"e"')})
    op.stamp_arrival(s3, "bucket", "jmk-uploads/oeival/R20.csv", "R20", "2026-07-29T14:10:03Z")
    copy_call = next(c for c in s3.calls if c[0] == "copy")
    assert copy_call[3] == op.ARCHIVE_TAG


def test_stamp_is_idempotent_when_target_exists_with_same_etag():
    # S3 redelivered the event after the copy but before the delete.
    src = "jmk-uploads/oeival/R20.csv"
    dst = "jmk-uploads/oeival/R20/202607/R20_20260729-1010.csv"
    s3 = StubS3({src: (b"x", '"same"'), dst: (b"x", '"same"')})
    out = op.stamp_arrival(s3, "bucket", src, "R20", "2026-07-29T14:10:03Z")

    assert out["stamped"] == dst
    assert out["deduped"] == 0
    assert [c[0] for c in s3.calls].count("copy") == 0, "must not re-copy"
    assert src not in s3.objects, "must still retry the delete"


def test_stamp_dedupes_when_target_exists_with_different_etag():
    src = "jmk-uploads/oeival/R20.csv"
    dst = "jmk-uploads/oeival/R20/202607/R20_20260729-1010.csv"
    s3 = StubS3({src: (b"newer", '"different"'), dst: (b"older", '"original"')})
    out = op.stamp_arrival(s3, "bucket", src, "R20", "2026-07-29T14:10:03Z")

    assert out["stamped"] == "jmk-uploads/oeival/R20/202607/R20_20260729-1010-01.csv"
    assert out["deduped"] == 1
    assert s3.objects[dst] == (b"older", '"original"'), "must not overwrite the earlier file"


def test_stamped_output_classifies_as_ingest():
    from oeival_keys import classify

    s3 = StubS3({"jmk-uploads/oeival/R20.csv": (b"x", '"e"')})
    out = op.stamp_arrival(s3, "bucket", "jmk-uploads/oeival/R20.csv", "R20", "2026-07-29T14:10:03Z")
    assert classify(out["stamped"]) == ("INGEST", "R20")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd aws/dunlop-reporter/lambdas
python3 -m pytest tests/test_oeival_processor_modes.py -v
```

Expected: FAIL with `AttributeError: module 'oeival_processor' has no attribute 'stamp_arrival'`.

- [ ] **Step 3: Write the implementation**

In `aws/dunlop-reporter/lambdas/oeival_processor.py`, add to the imports near the top (after `import boto3`):

```python
from oeival_keys import FULL, INGEST, SKIP, STAMP, archive_key, classify, stamp_from_event_time
from oeival_merge import MergeAborted, merge_items_ndjson
```

Add these constants and the error helper next to the existing `*_KEY` constants:

```python
from botocore.exceptions import ClientError

# Stamped arrivals carry this tag so the S3 lifecycle rule can expire them
# without touching the month-folder snapshots or the _cache objects. A
# path-prefix rule cannot express that distinction.
ARCHIVE_TAG = "lifecycle=location-archive"

# How many same-minute collisions to try before giving up.
MAX_DEDUPE = 20


def _is_error(exc: Exception, *codes: str) -> bool:
    """True when exc is a botocore ClientError carrying one of these codes.

    boto3's S3 client does NOT expose s3.exceptions.PreconditionFailed, and
    head_object raises ClientError with code '404' rather than NoSuchKey — so
    catching the modelled exception classes would miss both cases.
    """
    if not isinstance(exc, ClientError):
        return False
    return exc.response.get("Error", {}).get("Code") in codes
```

Add the function above `handler`:

```python
def stamp_arrival(s3_client, bucket: str, key: str, loc: str, event_time: str) -> dict:
    """Copy a bare <LOC>.csv arrival to its stamped archive key, then delete it.

    No parsing happens here. The copy raises a fresh S3 event that classifies as
    INGEST, and that invocation does the merge.

    Idempotent because S3 delivers at-least-once: if the target already exists
    with the same ETag the copy is treated as done and only the delete is
    retried; if it exists with a different ETag the name is deduped rather than
    overwriting a genuinely different file.
    """
    stamp = stamp_from_event_time(event_time)
    src_etag = s3_client.head_object(Bucket=bucket, Key=key)["ETag"]

    dedupe = 0
    while dedupe <= MAX_DEDUPE:
        target = archive_key(loc, stamp, dedupe)
        try:
            existing_etag = s3_client.head_object(Bucket=bucket, Key=target)["ETag"]
        except Exception as e:
            if not _is_error(e, "404", "NoSuchKey", "NotFound"):
                raise
            s3_client.copy_object(
                Bucket=bucket,
                Key=target,
                CopySource={"Bucket": bucket, "Key": key},
                Tagging=ARCHIVE_TAG,
                TaggingDirective="REPLACE",
            )
            s3_client.delete_object(Bucket=bucket, Key=key)
            return {"stamped": target, "deduped": dedupe}

        if existing_etag == src_etag:
            # Already copied on an earlier delivery; finish the job.
            s3_client.delete_object(Bucket=bucket, Key=key)
            return {"stamped": target, "deduped": dedupe}

        dedupe += 1  # same minute, different content

    raise RuntimeError(f"stamp: exhausted {MAX_DEDUPE} dedupe slots for {loc} at {stamp}")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd aws/dunlop-reporter/lambdas
python3 -m pytest tests/test_oeival_processor_modes.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add aws/dunlop-reporter/lambdas/oeival_processor.py \
        aws/dunlop-reporter/lambdas/tests/test_oeival_processor_modes.py
git commit -m "feat(oeival): idempotent STAMP mode with lifecycle tagging"
```

---

### Task 4: INGEST mode — conditional cache write and per-location meta

**Files:**
- Modify: `aws/dunlop-reporter/lambdas/oeival_processor.py`
- Modify: `aws/dunlop-reporter/lambdas/tests/test_oeival_processor_modes.py`

**Interfaces:**
- Consumes: `merge_items_ndjson`, `MergeAborted` from Task 2; existing `parse_csv_stream`, `update_lookup_index`, `_now_iso` already in the module.
- Produces: `write_merged_cache(s3_client, bucket: str, items: list[dict], loc: str, source_key: str, source_modified: str) -> dict` returning the stats dict from `merge_items_ndjson` plus `{"itemsBytes": int, "attempts": int}`; `HEAL_MIN_INTERVAL_SECONDS = 3600`.

Two behaviors beyond the merge itself. First, the conditional write: concurrent arrivals both read-modify-write one object, so the `PutObject` carries `If-Match` on the ETag read at the start and retries the whole merge on a 412. Second, `perLocation` in meta, which is what the deferred Phase 3 cutover will read.

- [ ] **Step 1: Write the failing tests**

Append to `aws/dunlop-reporter/lambdas/tests/test_oeival_processor_modes.py`:

```python
import datetime
import gzip
import io
import json

from oeival_merge import MergeAborted


class StubS3Cache(StubS3):
    """Adds get/put with If-Match semantics and an optional forced conflict."""

    def __init__(self, objects=None, conflict_times=0):
        super().__init__(objects)
        self.conflict_times = conflict_times

    def get_object(self, Bucket, Key):
        self.calls.append(("get", Key))
        if Key not in self.objects:
            raise client_error("NoSuchKey", "GetObject")
        body, etag = self.objects[Key]
        return {"Body": io.BytesIO(body), "ETag": etag,
                "LastModified": datetime.datetime(2026, 7, 29, 14, 10)}

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.calls.append(("put", Key, kwargs.get("IfMatch")))
        if self.conflict_times > 0 and kwargs.get("IfMatch") is not None:
            self.conflict_times -= 1
            # Simulate another invocation winning the race.
            self.objects[Key] = (self.objects.get(Key, (b"", ""))[0], '"raced"')
            raise client_error("PreconditionFailed", "PutObject")
        self.objects[Key] = (Body, '"written"')
        return {}


def _gz_rows(rows):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as f:
        for r in rows:
            f.write(json.dumps(r).encode("utf-8"))
            f.write(b"\n")
    return buf.getvalue()


def _row(loc, item_id):
    return {"location": loc, "itemId": item_id, "manufacturerName": "FAL",
            "productType": "T", "dclass": "A", "qtyOnHand": 1}


def test_ingest_merges_and_writes_meta_with_per_location():
    s3 = StubS3Cache({op.ITEMS_KEY: (_gz_rows([_row("W08", "KEEP")]), '"e1"')})
    stats = op.write_merged_cache(
        s3, "bucket", [_row("R20", "NEW")], "R20",
        "jmk-uploads/oeival/R20/202607/R20_20260729-1010.csv", "2026-07-29T14:10:00Z",
    )
    assert stats["totalRows"] == 2
    assert stats["replacedLocations"] == ["R20"]

    meta_body, _ = s3.objects[op.META_KEY]
    meta = json.loads(meta_body)
    assert meta["perLocation"]["R20"]["rowCount"] == 1
    assert meta["perLocation"]["R20"]["sourceKey"].endswith("R20_20260729-1010.csv")
    assert meta["perLocation"]["W08"]["rowCount"] == 1
    assert meta["filters"]["locations"] == ["R20", "W08"]


def test_ingest_carries_forward_untouched_locations_in_meta():
    prior_meta = json.dumps({
        "perLocation": {"W08": {"lastArrivalAt": "2026-07-29T13:10:00Z",
                                "rowCount": 1, "sourceKey": "old/W08.csv"}}
    }).encode("utf-8")
    s3 = StubS3Cache({
        op.ITEMS_KEY: (_gz_rows([_row("W08", "KEEP")]), '"e1"'),
        op.META_KEY: (prior_meta, '"m1"'),
    })
    op.write_merged_cache(s3, "bucket", [_row("R20", "NEW")], "R20", "k.csv", "2026-07-29T14:10:00Z")
    meta = json.loads(s3.objects[op.META_KEY][0])
    assert meta["perLocation"]["W08"]["lastArrivalAt"] == "2026-07-29T13:10:00Z"
    assert meta["perLocation"]["R20"]["lastArrivalAt"] == "2026-07-29T14:10:00Z"


def test_ingest_uses_if_match_on_the_items_write():
    s3 = StubS3Cache({op.ITEMS_KEY: (_gz_rows([_row("W08", "KEEP")]), '"e1"')})
    op.write_merged_cache(s3, "bucket", [_row("R20", "NEW")], "R20", "k.csv", "2026-07-29T14:10:00Z")
    items_put = next(c for c in s3.calls if c[0] == "put" and c[1] == op.ITEMS_KEY)
    assert items_put[2] == '"e1"'


def test_ingest_retries_the_whole_merge_after_a_lost_race():
    s3 = StubS3Cache({op.ITEMS_KEY: (_gz_rows([_row("W08", "KEEP")]), '"e1"')}, conflict_times=1)
    stats = op.write_merged_cache(s3, "bucket", [_row("R20", "NEW")], "R20", "k.csv",
                                  "2026-07-29T14:10:00Z")
    assert stats["attempts"] == 2
    assert [c[0] for c in s3.calls].count("get") >= 2, "must re-read before retrying"


def test_ingest_abort_leaves_the_cache_untouched():
    original = _gz_rows([_row("W08", "KEEP")])
    s3 = StubS3Cache({op.ITEMS_KEY: (original, '"e1"')})
    with pytest.raises(MergeAborted):
        op.write_merged_cache(s3, "bucket", [], "R20", "k.csv", "2026-07-29T14:10:00Z")
    assert s3.objects[op.ITEMS_KEY][0] == original
    assert not any(c[0] == "put" for c in s3.calls)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd aws/dunlop-reporter/lambdas
python3 -m pytest tests/test_oeival_processor_modes.py -v
```

Expected: the five new tests FAIL with `AttributeError: module 'oeival_processor' has no attribute 'write_merged_cache'`; the five from Task 3 still pass.

- [ ] **Step 3: Write the implementation**

Add to `aws/dunlop-reporter/lambdas/oeival_processor.py`, next to `MAX_DEDUPE`:

```python
import time  # add to the imports at the top of the module

# Cache-write race handling and heal-call throttling.
MAX_PUT_ATTEMPTS = 5
HEAL_MIN_INTERVAL_SECONDS = 3600
```

Add above `handler`:

```python
def _read_json_key(s3_client, bucket: str, key: str) -> dict:
    """Read a small JSON object, returning {} when absent or unreadable."""
    try:
        res = s3_client.get_object(Bucket=bucket, Key=key)
        return json.loads(res["Body"].read())
    except Exception:
        return {}


def write_merged_cache(
    s3_client,
    bucket: str,
    items: "list[dict[str, Any]]",
    loc: str,
    source_key: str,
    source_modified: str,
) -> dict:
    """Merge these rows into latest.items by location and refresh latest.meta.

    Raises MergeAborted (leaving both objects untouched) when the incoming file
    cannot be trusted. Uses If-Match so a lost race retries the whole merge
    against the winner's data rather than clobbering it.
    """
    last_error = None
    for attempt in range(1, MAX_PUT_ATTEMPTS + 1):
        existing_gz = None
        etag = None
        try:
            res = s3_client.get_object(Bucket=bucket, Key=ITEMS_KEY)
            existing_gz = res["Body"].read()
            etag = res["ETag"]
        except Exception as e:
            if not _is_error(e, "404", "NoSuchKey", "NotFound"):
                raise
            pass  # first run — no cache yet

        # Raises MergeAborted before anything is written.
        merged_gz, stats = merge_items_ndjson(existing_gz, items)

        put_kwargs = {
            "Bucket": bucket,
            "Key": ITEMS_KEY,
            "Body": merged_gz,
            "ContentType": "application/x-ndjson",
            "ContentEncoding": "gzip",
        }
        if etag is not None:
            put_kwargs["IfMatch"] = etag

        try:
            s3_client.put_object(**put_kwargs)
        except Exception as e:
            if not _is_error(e, "PreconditionFailed", "ConditionalRequestConflict"):
                raise
            last_error = e
            print(f"cache write lost a race (attempt {attempt}); re-reading and retrying")
            time.sleep(0.2 * attempt)  # bounded backoff
            continue

        meta = _read_json_key(s3_client, bucket, META_KEY)
        per_location = dict(meta.get("perLocation") or {})
        for loc_key, count in stats["perLocationCounts"].items():
            if loc_key in stats["replacedLocations"]:
                per_location[loc_key] = {
                    "lastArrivalAt": source_modified,
                    "rowCount": count,
                    "sourceKey": source_key,
                }
            elif loc_key not in per_location:
                # Present in the cache but never seen arrive — record what we know.
                per_location[loc_key] = {
                    "lastArrivalAt": None,
                    "rowCount": count,
                    "sourceKey": None,
                }
            else:
                per_location[loc_key] = {**per_location[loc_key], "rowCount": count}

        new_meta = {
            "fileKey": source_key,
            "fileName": source_key.rsplit("/", 1)[-1],
            "fileDate": source_modified,
            "totalRows": stats["totalRows"],
            "filters": stats["filters"],
            "itemsKey": ITEMS_KEY,
            "itemsBytes": len(merged_gz),
            "generatedAt": _now_iso(),
            "perLocation": per_location,
            "lastHealAt": meta.get("lastHealAt"),
        }
        s3_client.put_object(
            Bucket=bucket,
            Key=META_KEY,
            Body=json.dumps(new_meta, separators=(",", ":")).encode("utf-8"),
            ContentType="application/json",
        )
        return {**stats, "itemsBytes": len(merged_gz), "attempts": attempt}

    raise RuntimeError(f"cache write failed after {MAX_PUT_ATTEMPTS} attempts: {last_error}")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd aws/dunlop-reporter/lambdas
python3 -m pytest tests/test_oeival_processor_modes.py -v
```

Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add aws/dunlop-reporter/lambdas/oeival_processor.py \
        aws/dunlop-reporter/lambdas/tests/test_oeival_processor_modes.py
git commit -m "feat(oeival): per-location cache write with If-Match retry and perLocation meta"
```

---

### Task 5: Handler dispatch

**Files:**
- Modify: `aws/dunlop-reporter/lambdas/oeival_processor.py:302-399` (the `handler` function)
- Modify: `aws/dunlop-reporter/lambdas/tests/test_oeival_processor_modes.py`

**Interfaces:**
- Consumes: `classify` (Task 1), `stamp_arrival` (Task 3), `write_merged_cache` (Task 4).
- Produces: `handler(event, _context) -> dict` with a `results` list, one entry per S3 record.

Three changes to the existing handler. It processes only `event["Records"][0]` today and silently ignores the rest — with 15-minute batches that becomes a data-loss path, so it loops. The `"oeival" not in key` substring check is replaced by `classify`. And the heal call is throttled, because at four arrivals per location per hour it would otherwise hammer `iecentral.com`.

- [ ] **Step 1: Write the failing tests**

Append to `aws/dunlop-reporter/lambdas/tests/test_oeival_processor_modes.py`:

```python
def _event(*keys, event_time="2026-07-29T14:10:03.000Z"):
    return {"Records": [
        {"eventTime": event_time,
         "s3": {"bucket": {"name": "bucket"}, "object": {"key": k}}}
        for k in keys
    ]}


def test_handler_routes_bare_name_to_stamp(monkeypatch):
    seen = {}
    monkeypatch.setattr(op, "stamp_arrival",
                        lambda *a, **k: seen.setdefault("stamp", a[3]) or {"stamped": "x", "deduped": 0})
    out = op.handler(_event("jmk-uploads/oeival/R20.csv"), None)
    assert seen["stamp"] == "R20"
    assert out["results"][0]["mode"] == "STAMP"


def test_handler_routes_stamped_name_to_ingest(monkeypatch):
    calls = {}
    monkeypatch.setattr(op, "_load_rows", lambda *a, **k: ([_row("R20", "A")], "2026-07-29T14:10:00Z"))
    monkeypatch.setattr(op, "write_merged_cache",
                        lambda *a, **k: calls.setdefault("loc", a[3]) or {"totalRows": 1, "attempts": 1,
                                                                         "perLocationCounts": {"R20": 1},
                                                                         "replacedLocations": ["R20"]})
    monkeypatch.setattr(op, "update_lookup_index", lambda items: {"lookupCount": 1})
    monkeypatch.setattr(op, "_maybe_heal", lambda *a, **k: None)
    out = op.handler(_event("jmk-uploads/oeival/R20/202607/R20_20260729-1010.csv"), None)
    assert calls["loc"] == "R20"
    assert out["results"][0]["mode"] == "INGEST"


def test_handler_skips_cache_and_unmatched_keys():
    out = op.handler(_event("jmk-uploads/oeival/_cache/latest.meta.json",
                            "jmk-uploads/oeival/helloworld.txt",
                            "jmk-uploads/oeival/IET-oeival R20 ONLY.csv"), None)
    assert [r["mode"] for r in out["results"]] == ["SKIP", "SKIP", "SKIP"]


def test_handler_processes_every_record_not_just_the_first(monkeypatch):
    stamped = []
    monkeypatch.setattr(op, "stamp_arrival",
                        lambda *a, **k: stamped.append(a[3]) or {"stamped": "x", "deduped": 0})
    op.handler(_event("jmk-uploads/oeival/R20.csv",
                      "jmk-uploads/oeival/W08.csv",
                      "jmk-uploads/oeival/W09.csv"), None)
    assert stamped == ["R20", "W08", "W09"]


def test_handler_reports_abort_without_raising(monkeypatch):
    import oeival_merge

    monkeypatch.setattr(op, "_load_rows", lambda *a, **k: ([], "2026-07-29T14:10:00Z"))

    def boom(*a, **k):
        raise oeival_merge.MergeAborted("incoming file parsed to zero rows")

    monkeypatch.setattr(op, "write_merged_cache", boom)
    out = op.handler(_event("jmk-uploads/oeival/R20/202607/R20_20260729-1010.csv"), None)
    assert out["results"][0]["aborted"].startswith("incoming file parsed")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd aws/dunlop-reporter/lambdas
python3 -m pytest tests/test_oeival_processor_modes.py -v
```

Expected: the five new tests FAIL — `handler` returns the old single-record shape and `_load_rows` / `_maybe_heal` do not exist.

- [ ] **Step 3: Replace the handler**

Replace the whole `handler` function in `aws/dunlop-reporter/lambdas/oeival_processor.py` (currently lines 302-399) with:

```python
def _load_rows(bucket: str, key: str) -> "tuple[list[dict[str, Any]], str]":
    """Fetch and parse an inventory file. Returns (rows, last_modified_iso)."""
    obj = s3.get_object(Bucket=bucket, Key=key)
    last_modified = obj["LastModified"].isoformat()
    key_lower = key.lower()
    if key_lower.endswith(".csv"):
        return parse_csv_stream(obj["Body"]), last_modified
    # XLSX would need openpyxl in a layer; every OEIVAL we see is CSV.
    raise ValueError(f"unsupported extension: {key}")


def _maybe_heal(bucket: str) -> None:
    """Ask IECentral to backfill brand-less adjustments, at most hourly.

    Unthrottled this fired once per upload, which was fine for one daily file
    and is not fine at four arrivals per location per hour.
    """
    from datetime import datetime, timezone

    meta = _read_json_key(s3, bucket, META_KEY)
    last = meta.get("lastHealAt")
    if last:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(last)).total_seconds()
            if age < HEAL_MIN_INTERVAL_SECONDS:
                return
        except Exception:
            pass

    try:
        import urllib.request
        heal_url = os.environ.get("IECENTRAL_URL", "https://www.iecentral.com") + "/api/reports/heal-adjustment-brands"
        req = urllib.request.Request(heal_url, data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"heal-adjustment-brands: {resp.status} {resp.read()[:200]}")
        fresh = _read_json_key(s3, bucket, META_KEY)
        fresh["lastHealAt"] = _now_iso()
        s3.put_object(Bucket=bucket, Key=META_KEY,
                      Body=json.dumps(fresh, separators=(",", ":")).encode("utf-8"),
                      ContentType="application/json")
    except Exception as e:
        print(f"heal-adjustment-brands call failed (non-fatal): {e}")


def _handle_full(bucket: str, key: str) -> dict:
    """Month-folder snapshot: replace the reporting cache wholesale, as before."""
    items, last_modified = _load_rows(bucket, key)
    filters = build_filters(items)

    items_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=items_buf, mode="wb", compresslevel=6) as gz:
        for it in items:
            gz.write(json.dumps(it, separators=(",", ":")).encode("utf-8"))
            gz.write(b"\n")
    items_bytes = items_buf.getvalue()
    s3.put_object(Bucket=bucket, Key=ITEMS_KEY, Body=items_bytes,
                  ContentType="application/x-ndjson", ContentEncoding="gzip")

    per_location: "dict[str, dict[str, Any]]" = {}
    for it in items:
        loc = str(it.get("location", "") or "").strip().upper()
        if loc:
            entry = per_location.setdefault(loc, {"lastArrivalAt": last_modified,
                                                  "rowCount": 0, "sourceKey": key})
            entry["rowCount"] += 1

    meta = {
        "fileKey": key,
        "fileName": key.rsplit("/", 1)[-1],
        "fileDate": last_modified,
        "totalRows": len(items),
        "filters": filters,
        "itemsKey": ITEMS_KEY,
        "itemsBytes": len(items_bytes),
        "generatedAt": _now_iso(),
        "perLocation": per_location,
        "lastHealAt": _read_json_key(s3, bucket, META_KEY).get("lastHealAt"),
    }
    s3.put_object(Bucket=bucket, Key=META_KEY,
                  Body=json.dumps(meta, separators=(",", ":")).encode("utf-8"),
                  ContentType="application/json")

    try:
        print(f"lookup index: {update_lookup_index(items)}")
    except Exception as e:
        print(f"lookup index update failed (non-fatal): {e}")

    _maybe_heal(bucket)
    return {"totalRows": len(items), "itemsBytes": len(items_bytes)}


def handler(event, _context):
    from urllib.parse import unquote_plus

    results = []
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])
        event_time = record.get("eventTime", _now_iso())
        mode, loc = classify(key)
        entry = {"key": key, "mode": mode}

        try:
            if mode == SKIP:
                pass
            elif mode == STAMP:
                entry.update(stamp_arrival(s3, bucket, key, loc, event_time))
            elif mode == INGEST:
                items, last_modified = _load_rows(bucket, key)
                stats = write_merged_cache(s3, bucket, items, loc, key, last_modified)
                entry.update({k: stats[k] for k in ("totalRows", "attempts", "replacedLocations")})
                try:
                    print(f"lookup index: {update_lookup_index(items)}")
                except Exception as e:
                    print(f"lookup index update failed (non-fatal): {e}")
                _maybe_heal(bucket)
            elif mode == FULL:
                entry.update(_handle_full(bucket, key))
        except MergeAborted as e:
            # MERGE_ABORT is matched by a CloudWatch metric filter — do not reword.
            print(f"MERGE_ABORT key={key} reason={e}")
            entry["aborted"] = str(e)
        except Exception as e:
            print(f"STAMP_FAIL key={key} mode={mode} error={e}"
                  if mode == STAMP else f"PROCESS_FAIL key={key} mode={mode} error={e}")
            raise

        results.append(entry)

    return {"results": results}
```

- [ ] **Step 4: Run the whole suite**

```bash
cd aws/dunlop-reporter/lambdas
python3 -m pytest tests/ -v
```

Expected: 46 passed — 21 in `test_oeival_keys.py`, 10 in `test_oeival_merge.py`, 15 in `test_oeival_processor_modes.py`.

- [ ] **Step 5: Commit**

```bash
git add aws/dunlop-reporter/lambdas/oeival_processor.py \
        aws/dunlop-reporter/lambdas/tests/test_oeival_processor_modes.py
git commit -m "feat(oeival): dispatch handler across FULL/STAMP/INGEST and process every record"
```

---

### Task 6: Infrastructure — concurrency, tagging, lifecycle, alarms

**Files:**
- Modify: `aws/dunlop-reporter/template.yaml:31-36` (`JmkUploadsBucket`)
- Modify: `aws/dunlop-reporter/template.yaml` (`LambdaExecutionRole`, `DunlopReporterS3Access` action list)
- Modify: `aws/dunlop-reporter/template.yaml:476-487` (`OeivalProcessorFunction`)

**Interfaces:**
- Consumes: `ARCHIVE_TAG = "lifecycle=location-archive"` from Task 3, and the `MERGE_ABORT` / `STAMP_FAIL` log prefixes from Task 5.
- Produces: no code interface. `s3:DeleteObject` is already granted and needs no change.

- [ ] **Step 1: Add the tag-based lifecycle rule to the bucket**

Replace the `JmkUploadsBucket` resource with:

```yaml
  JmkUploadsBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: ietires-dunlop-jmk-uploads
      LifecycleConfiguration:
        Rules:
          # Expire per-location SFTP arrivals after 90 days. Filtered by TAG, not
          # prefix: the archive lives at jmk-uploads/oeival/<LOC>/<YYYYMM>/ and
          # lifecycle prefixes cannot wildcard mid-path, so the narrowest literal
          # prefix would be jmk-uploads/oeival/ — which would also expire the
          # month-folder snapshots and the _cache objects the reports read.
          - Id: ExpireLocationArchive
            Status: Enabled
            ExpirationInDays: 90
            TagFilters:
              - Key: lifecycle
                Value: location-archive
      Tags:
        - Key: Project
          Value: DunlopReporter
```

- [ ] **Step 2: Grant PutObjectTagging**

In `LambdaExecutionRole`, policy `DunlopReporterS3Access`, add to the `Action` list (which already contains `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`):

```yaml
                  - s3:PutObjectTagging
```

- [ ] **Step 3: Set reserved concurrency on the processor**

Add to `OeivalProcessorFunction` `Properties`, after `MemorySize: 2048`:

```yaml
      # Arrivals for several locations land on the same :10/:25/:40/:55 tick and
      # all read-modify-write one cache object. Serialising them makes the
      # If-Match retry in write_merged_cache a rare path instead of the norm.
      ReservedConcurrentExecutions: 1
```

- [ ] **Step 4: Add metric filters and alarms**

Append these resources to the template:

```yaml
  MergeAbortMetricFilter:
    Type: AWS::Logs::MetricFilter
    Properties:
      LogGroupName: /aws/lambda/dunlop-oeival-processor
      FilterPattern: '"MERGE_ABORT"'
      MetricTransformations:
        - MetricNamespace: DunlopReporter
          MetricName: OeivalMergeAborts
          MetricValue: "1"
          DefaultValue: 0

  StampFailMetricFilter:
    Type: AWS::Logs::MetricFilter
    Properties:
      LogGroupName: /aws/lambda/dunlop-oeival-processor
      FilterPattern: '"STAMP_FAIL"'
      MetricTransformations:
        - MetricNamespace: DunlopReporter
          MetricName: OeivalStampFailures
          MetricValue: "1"
          DefaultValue: 0

  MergeAbortAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: dunlop-oeival-merge-aborts
      AlarmDescription: An arrival was rejected by the destructive-arrival guard; that location is stale.
      Namespace: DunlopReporter
      MetricName: OeivalMergeAborts
      Statistic: Sum
      Period: 900
      EvaluationPeriods: 1
      Threshold: 1
      ComparisonOperator: GreaterThanOrEqualToThreshold
      TreatMissingData: notBreaching

  StampFailAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: dunlop-oeival-stamp-failures
      AlarmDescription: A per-location arrival could not be stamped and is stuck at the prefix root.
      Namespace: DunlopReporter
      MetricName: OeivalStampFailures
      Statistic: Sum
      Period: 900
      EvaluationPeriods: 1
      Threshold: 1
      ComparisonOperator: GreaterThanOrEqualToThreshold
      TreatMissingData: notBreaching

  FeedQuietAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: dunlop-oeival-feed-quiet
      AlarmDescription: No processor invocations in 90 minutes; the per-location feed has stopped.
      Namespace: AWS/Lambda
      MetricName: Invocations
      Dimensions:
        - Name: FunctionName
          Value: dunlop-oeival-processor
      Statistic: Sum
      Period: 5400
      EvaluationPeriods: 1
      Threshold: 1
      ComparisonOperator: LessThanThreshold
      TreatMissingData: breaching
```

- [ ] **Step 5: Validate the template**

```bash
cd aws/dunlop-reporter
sam validate --lint
```

Expected: `template.yaml is a valid SAM Template`. Fix any lint findings before continuing.

- [ ] **Step 6: Commit**

```bash
git add aws/dunlop-reporter/template.yaml
git commit -m "chore(oeival): reserved concurrency, tag-based archive expiry, ingest alarms"
```

---

### Task 7: Verify against the live server

Nothing here is provable by unit tests: this is where "as long as it works" gets settled. Requires Andy's SSO credentials (the `ietires` profile is denied on Secrets Manager and CloudWatch), and `sam deploy` needs them too — the static `ie-pricing-deploy` profile gets AccessDenied on CloudFormation.

**Files:**
- Create: `aws/dunlop-reporter/tests/e2e_location_arrival.py`

**Interfaces:**
- Consumes: the deployed stack.
- Produces: a runnable end-to-end check. No importable interface.

- [ ] **Step 1: Deploy**

```bash
cd aws/dunlop-reporter
sam build
sam deploy --stack-name dunlop-reporter --region us-east-1 \
  --capabilities CAPABILITY_NAMED_IAM --resolve-s3 --no-confirm-changeset
```

Expected: `UPDATE_COMPLETE`.

- [ ] **Step 2: Write the end-to-end check**

Create `aws/dunlop-reporter/tests/e2e_location_arrival.py`:

```python
"""End-to-end: upload a fixture as <LOC>.csv over real SFTP and assert the
stamping, archiving, and per-location merge all happened.

Run with admin AWS credentials in the environment:
    python3 aws/dunlop-reporter/tests/e2e_location_arrival.py
"""

import gzip
import io
import json
import sys
import time

import boto3
import paramiko

BUCKET = "ietires-dunlop-jmk-uploads"
HOST = "s-949f7c15b1f64d43a.server.transfer.us-east-1.amazonaws.com"
LOC = "ZZ99"  # deliberately not a real store, so no report is affected
CSV = (
    "Location,Product Type,Item Id,Description,Manufacturer Name,Qty On Hand,Avg Cost\n"
    f"{LOC},T,E2ETEST1,E2E TEST TIRE,FAL,7,42.00\n"
)

s3 = boto3.client("s3", region_name="us-east-1")
sec = boto3.client("secretsmanager", region_name="us-east-1")


def creds():
    return json.loads(sec.get_secret_value(SecretId="dunlop-reporter/jmk-sftp-user")["SecretString"])


def upload():
    c = creds()
    t = paramiko.Transport((HOST, 22))
    t.start_client(timeout=20)
    t.auth_password(c["username"], c["password"])
    sftp = paramiko.SFTPClient.from_transport(t)
    with sftp.file(f"/inventory/{LOC}.csv", "w") as f:
        f.write(CSV)
    t.close()
    print(f"uploaded /inventory/{LOC}.csv")


def wait_for_archive(timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = s3.list_objects_v2(Bucket=BUCKET, Prefix=f"jmk-uploads/oeival/{LOC}/")
        keys = [o["Key"] for o in resp.get("Contents", [])]
        if keys:
            return keys
        time.sleep(5)
    raise AssertionError(f"no archived file appeared under jmk-uploads/oeival/{LOC}/ in {timeout}s")


def main():
    upload()
    keys = wait_for_archive()
    print(f"archived: {keys}")

    stamped = keys[0]
    assert f"/{LOC}_" in stamped, f"expected a stamped name, got {stamped}"
    parts = stamped.split("/")
    assert len(parts) == 5 and parts[2] == LOC and len(parts[3]) == 6, f"unexpected layout: {stamped}"

    tags = s3.get_object_tagging(Bucket=BUCKET, Key=stamped)["TagSet"]
    assert {"Key": "lifecycle", "Value": "location-archive"} in tags, f"missing lifecycle tag: {tags}"

    plain = s3.list_objects_v2(Bucket=BUCKET, Prefix=f"jmk-uploads/oeival/{LOC}.csv")
    assert not plain.get("Contents"), "plain <LOC>.csv should have been deleted"

    meta = json.loads(s3.get_object(Bucket=BUCKET, Key="jmk-uploads/oeival/_cache/latest.meta.json")["Body"].read())
    assert LOC in meta["perLocation"], f"{LOC} missing from perLocation: {list(meta['perLocation'])}"
    assert meta["perLocation"][LOC]["rowCount"] == 1

    body = s3.get_object(Bucket=BUCKET, Key="jmk-uploads/oeival/_cache/latest.items.ndjson.gz")["Body"].read()
    with gzip.GzipFile(fileobj=io.BytesIO(body), mode="rb") as gz:
        rows = [json.loads(line) for line in gz if line.strip()]
    assert any(r["itemId"] == "E2ETEST1" for r in rows), "test row missing from the cache"
    other = {r["location"] for r in rows} - {LOC}
    assert other, f"other locations were wiped; cache holds only {LOC}"
    print(f"cache holds {len(rows)} rows across locations: {sorted(other | {LOC})}")

    print("PASS — cleaning up")
    s3.delete_object(Bucket=BUCKET, Key=stamped)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Run it**

```bash
python3 aws/dunlop-reporter/tests/e2e_location_arrival.py
```

Expected: `PASS — cleaning up`. The `ZZ99` rows remain in the cache until the next full snapshot; that is harmless because no report filters to a nonexistent store, and it also proves the unknown-location path ingests rather than rejects.

- [ ] **Step 4: Confirm the daily full snapshot still works**

The FULL path is the one thing a regression here would break silently. Watch the next daily `All IET-oeival` upload, then:

```bash
aws s3api get-object --bucket ietires-dunlop-jmk-uploads \
  --key jmk-uploads/oeival/_cache/latest.meta.json /tmp/meta.json --region us-east-1
python3 -c "
import json; m=json.load(open('/tmp/meta.json'))
print('rows:', m['totalRows']); print('locations:', m['filters']['locations'])
print('perLocation:', list(m.get('perLocation', {})))
"
```

Expected: `totalRows` in the same range as before this change, and every real location present.

- [ ] **Step 5: Commit**

```bash
git add aws/dunlop-reporter/tests/e2e_location_arrival.py
git commit -m "test(oeival): end-to-end check for stamped per-location arrivals"
```

---

## Deferred to a follow-up plan

Spec Phases 3 and 4 are intentionally not in this plan. The spec gates them on Phase 2 being proven against real arrivals, and both depend on `perLocation` shapes that should be observed in production before UI is built on them.

- Phase 3 — data-driven manual-upload cutover: `app/api/reports/upload-status/route.ts` exposes feed-live from `perLocation.lastArrivalAt` within 90 minutes; `app/reports/upload/page.tsx` hides OEAVAL 77 while live, with an admin override.
- Phase 4 — per-location freshness display in the inventory reports.

Two spec assumptions to settle during Task 7, both recorded in the spec:

1. **Column layout.** Task 7's fixture uses the headers `HEADER_MAP` expects. If a real arrival differs, `build_col_map` needs the real header names added — check the first arrival before trusting the merge.
2. **Location list.** Not hardcoded anywhere in this plan; locations come from file content. Confirming the real list only sharpens the `FeedQuietAlarm` and future per-location alerting.
