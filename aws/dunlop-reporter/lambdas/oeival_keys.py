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
