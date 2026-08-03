"""
OEIVAL processor Lambda

Triggered on PUT into s3://ietires-dunlop-jmk-uploads/jmk-uploads/oeival/...
Streams the uploaded CSV (or XLSX), maps columns to the schema the
Vercel inventory route expects, and writes a slim JSON cache back to
s3://ietires-dunlop-jmk-uploads/jmk-uploads/oeival/_cache/latest.json.

The Vercel /api/reports/inventory-data route reads only the cache, so
even a 200MB OEIVAL produces a sub-second response and never pressures
Vercel's 2GB function-memory ceiling.
"""

import csv
import gzip
import io
import json
import os
import time
from typing import Any, Optional

import boto3
from botocore.exceptions import ClientError

from oeival_keys import FULL, INGEST, SKIP, STAMP, archive_key, classify, stamp_from_event_time
from oeival_merge import MergeAborted, merge_items_ndjson

s3 = boto3.client("s3")

BUCKET = os.environ.get("S3_JMK_UPLOADS_BUCKET", "ietires-dunlop-jmk-uploads")

# Stamped arrivals carry this tag so the S3 lifecycle rule can expire them
# without touching the month-folder snapshots or the _cache objects. A
# path-prefix rule cannot express that distinction.
ARCHIVE_TAG = "lifecycle=location-archive"

# How many same-minute collisions to try before giving up.
MAX_DEDUPE = 20

# Cache-write race handling and heal-call throttling.
MAX_PUT_ATTEMPTS = 5
HEAL_MIN_INTERVAL_SECONDS = 3600


def _is_error(exc: Exception, *codes: str) -> bool:
    """True when exc is a botocore ClientError carrying one of these codes.

    boto3's S3 client does NOT expose s3.exceptions.PreconditionFailed, and
    head_object raises ClientError with code '404' rather than NoSuchKey — so
    catching the modelled exception classes would miss both cases.
    """
    if not isinstance(exc, ClientError):
        return False
    return exc.response.get("Error", {}).get("Code") in codes

# ── Two caches, two purposes ────────────────────────────────────────────
# REPORTING snapshot (latest.*): the latest OEIVAL only, overwritten on every
#   upload. The Vercel inventory/custom-data report routes read this so reports
#   always reflect the most recent file (even a partial/single-location export).
#
# LOOKUP collective index (lookup.*): a cumulative union of every OEIVAL ever
#   processed, keyed by itemId (newest wins, NEVER shrinks). The tire-label
#   lookup (resolve-brand / tire search) reads this so a partial upload such as
#   "IET-oeival R20 ONLY.csv" can refresh the report snapshot without erasing
#   coverage for every other tire. This is what fixes "tire label not found".
META_KEY = "jmk-uploads/oeival/_cache/latest.meta.json"
ITEMS_KEY = "jmk-uploads/oeival/_cache/latest.items.ndjson.gz"
LOOKUP_META_KEY = "jmk-uploads/oeival/_cache/lookup.meta.json"
LOOKUP_ITEMS_KEY = "jmk-uploads/oeival/_cache/lookup.items.ndjson.gz"

# Fields the tire-label lookup needs (mirrors BrandEntry in
# lib/oeivalBrandIndex.ts). Keep the lookup index slim — quantities and
# location-specific columns belong to the reporting snapshot, not here.
LOOKUP_FIELDS = ("itemId", "manufacturerName", "description", "model", "mfgItemId", "upcCode", "ean")


def update_lookup_index(items: "list[dict[str, Any]]") -> dict:
    """Merge this upload's items into the cumulative tire-label lookup index.

    Union by uppercased itemId, newest wins, never shrinks. A partial upload
    therefore updates only its own items and can never reduce coverage for the
    rest of the catalog. Read back by lib/oeivalBrandIndex.ts.
    """
    index: "dict[str, dict[str, Any]]" = {}

    # Load the existing index (if any) so we accumulate rather than replace.
    try:
        res = s3.get_object(Bucket=BUCKET, Key=LOOKUP_ITEMS_KEY)
        with gzip.GzipFile(fileobj=io.BytesIO(res["Body"].read()), mode="rb") as gz:
            for raw in gz:
                line = raw.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                k = str(o.get("itemId", "")).strip().upper()
                if k:
                    index[k] = o
    except s3.exceptions.NoSuchKey:
        pass  # first run — start empty
    except Exception as e:
        print(f"lookup index: could not read existing ({e}); seeding from this file only")

    # Overlay this upload's items (newest wins).
    before = len(index)
    for it in items:
        k = str(it.get("itemId", "")).strip().upper()
        if not k:
            continue
        index[k] = {f: it.get(f, "") for f in LOOKUP_FIELDS}

    # Write the merged index back.
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6) as gz:
        for o in index.values():
            gz.write(json.dumps(o, separators=(",", ":")).encode("utf-8"))
            gz.write(b"\n")
    data = buf.getvalue()
    s3.put_object(
        Bucket=BUCKET,
        Key=LOOKUP_ITEMS_KEY,
        Body=data,
        ContentType="application/x-ndjson",
        ContentEncoding="gzip",
    )

    meta = {
        "count": len(index),
        "itemsKey": LOOKUP_ITEMS_KEY,
        "itemsBytes": len(data),
        "generatedAt": _now_iso(),
    }
    s3.put_object(
        Bucket=BUCKET,
        Key=LOOKUP_META_KEY,
        Body=json.dumps(meta, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
    )
    return {"lookupCount": len(index), "lookupAdded": len(index) - before, "lookupBytes": len(data)}

# Column header → field key map (mirrors the Vercel route's headerMap
# in app/api/reports/inventory-data/route.ts). Lowercase, exact-match
# first then `in` fallback.
HEADER_MAP: dict[str, list[str]] = {
    "location": ["location", "loc id"],
    "productType": ["product type"],
    "stockType": ["stock type"],
    "dclass": ["d class", "d-class", "dclass"],
    "manufacturerCode": ["manufacturer code", "mfg code"],
    "manufacturerName": ["manufacturer name", "mfg name", "mfg's name"],
    "model": ["model"],
    "itemId": ["item id"],
    "mfgItemId": ["manufacturer's item id", "mfg's item id", "mfg item id"],
    "description": ["description", "item description"],
    # JMK ships the barcode in the OEIVAL itself, keyed by Item id — the same key
    # the inventory count resolves against. Previously dropped, which forced the
    # count to bridge through tireUPCs on the manufacturer part number instead.
    "upcCode": ["upc code", "upc"],
    "ean": ["ean"],
    "sidewall": ["sidewall or bolt circle", "sidewall"],
    "reorderPoint": ["reorder point"],
    "qtyOnHand": ["qty on hand"],
    "qtyCommitted": ["qty committed"],
    "qtyAvailable": ["qty available"],
    "priceRetail": ["o/e 'retail'", "retail"],
    "priceCommercial": ["o/e 'commercial'", "commercial"],
    "priceWholesale": ["o/e 'wholesale'", "wholesale"],
    "priceBase": ["o/e 'base'", "base"],
    "priceList": ["o/e 'list'", "list"],
    "priceAdj": ["o/e 'adj'", "adj"],
    "lastCost": ["last cost"],
    "avgCost": ["avg cost"],
    "stdCost": ["std cost"],
    "fet": ["fet"],
    "extendedValue": ["extended value"],
}

NUMERIC_FIELDS = {
    "stockType", "reorderPoint", "qtyOnHand", "qtyCommitted", "qtyAvailable",
    "priceRetail", "priceCommercial", "priceWholesale", "priceBase",
    "priceList", "priceAdj", "lastCost", "avgCost", "stdCost", "fet",
    "extendedValue",
}

DCLASS_DECODE = {
    "Blank": "",
    "Dash": "Dash",
    "colon": "Colon",
    "Open Bracket": "Bracket",
    ".": "Dot",
    "^": "Caret",
    "[": "Bracket",
    ":": "Colon",
    "-": "Dash",
    "~": "Tilde",
    "*": "Star",
    "#": "Hash",
    "!": "Bang",
}

# Item-id suffix → d-class fallback (when no d-class column)
DCLASS_SUFFIX = {
    ".": "Dot", "^": "Caret", "[": "Bracket", ":": "Colon",
    "-": "Dash", "~": "Tilde", "*": "Star", "#": "Hash",
}


def to_num(val: Any) -> float:
    if val is None or val == "":
        return 0.0
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def build_col_map(header_row: list[str]) -> dict[str, int]:
    headers = [h.replace('"', "").strip().lower() for h in header_row]
    col: dict[str, int] = {}
    for field, aliases in HEADER_MAP.items():
        idx = next((i for i, h in enumerate(headers) if any(h == a for a in aliases)), -1)
        if idx < 0:
            idx = next((i for i, h in enumerate(headers) if any(a in h for a in aliases)), -1)
        if idx >= 0:
            col[field] = idx
    # Disambiguate "qty on hand" vs "qty on hand indicator"
    for exact_field, exact_name in [("qtyOnHand", "qty on hand"), ("avgCost", "avg cost")]:
        try:
            col[exact_field] = headers.index(exact_name)
        except ValueError:
            pass
    return col


def row_to_item(row: list[str], col: dict[str, int]) -> Optional[dict[str, Any]]:
    def g(field: str) -> str:
        idx = col.get(field)
        if idx is None or idx >= len(row):
            return ""
        return str(row[idx] or "").strip()

    def gn(field: str) -> float:
        return to_num(g(field))

    # Skip empty rows (no first two columns)
    if not g("location") and not g("productType"):
        return None

    # Tires-only inventory: OEIVAL Product Type codes for tires all start
    # with "T" (T=passenger, TL=light truck, TF=flotation/farm,
    # TA=agriculture, TI=industrial, T2M=medium truck, etc.). Skip
    # everything else — wheels (W), batteries (B), accessories, services.
    pt = g("productType").upper()
    if not pt or not pt.startswith("T"):
        return None

    raw_dclass = g("dclass")
    if "dclass" in col:
        dclass = DCLASS_DECODE.get(raw_dclass or "Blank", raw_dclass)
    else:
        item_id = g("itemId")
        last_char = item_id[-1:] if item_id else ""
        dclass = DCLASS_SUFFIX.get(last_char, "")

    return {
        # Uppercased here, and nowhere else in the row. Everything downstream
        # that groups or filters by location uppercases first — oeival_merge's
        # replace set, _Filters, perLocation keys — so a store that exports
        # "r20" one day and "R20" the next must not produce two identities.
        # The Vercel inventory route compares it.location to the dropdown value
        # (which comes from meta.filters.locations) with ===, so a raw row value
        # against an uppercased filter value silently returns zero rows.
        "location": g("location").upper(),
        "productType": g("productType"),
        "stockType": gn("stockType"),
        "dclass": dclass,
        "manufacturerCode": g("manufacturerCode"),
        "manufacturerName": g("manufacturerName"),  # raw code — Vercel applies friendly-name mapping
        "model": g("model"),
        "itemId": g("itemId"),
        "mfgItemId": g("mfgItemId"),
        "upcCode": g("upcCode"),
        "ean": g("ean"),
        "description": g("description"),
        "reorderPoint": gn("reorderPoint"),
        "qtyOnHand": gn("qtyOnHand"),
        "qtyCommitted": gn("qtyCommitted"),
        "qtyAvailable": gn("qtyAvailable"),
        "priceRetail": gn("priceRetail"),
        "priceCommercial": gn("priceCommercial"),
        "priceWholesale": gn("priceWholesale"),
        "priceBase": gn("priceBase"),
        "priceList": gn("priceList"),
        "priceAdj": gn("priceAdj"),
        "lastCost": gn("lastCost"),
        "avgCost": gn("avgCost"),
        "stdCost": gn("stdCost"),
        "fet": gn("fet"),
        "extendedValue": gn("extendedValue"),
    }


def build_filters(items: list[dict[str, Any]]) -> dict[str, list[str]]:
    locations: set[str] = set()
    brands: set[str] = set()
    product_types: set[str] = set()
    dclasses: set[str] = set()
    for it in items:
        # Uppercase for the same reason row_to_item does: this list feeds the
        # inventory report's location dropdown and must match the row values
        # exactly. Only location is normalized.
        loc = str(it.get("location", "") or "").strip().upper()
        if loc:
            locations.add(loc)
        if it["manufacturerName"]:
            brands.add(it["manufacturerName"])
        if it["productType"]:
            product_types.add(it["productType"])
        if it["dclass"]:
            dclasses.add(it["dclass"])
    return {
        "locations": sorted(locations),
        "brands": sorted(brands),
        "productTypes": sorted(product_types),
        "dclasses": sorted(dclasses),
    }


def parse_csv_stream(body) -> list[dict[str, Any]]:
    text_stream = io.TextIOWrapper(body, encoding="utf-8", errors="replace", newline="")
    reader = csv.reader(text_stream)
    try:
        header = next(reader)
    except StopIteration:
        return []
    col_map = build_col_map(header)
    items: list[dict[str, Any]] = []
    for row in reader:
        if not row:
            continue
        item = row_to_item(row, col_map)
        if item is not None:
            items.append(item)
    return items


def _read_json_key(s3_client, bucket: str, key: str) -> "tuple[dict, Optional[str]]":
    """Read a small JSON object, returning (doc, etag).

    Returns ({}, None) only when the object is genuinely absent (first run).
    Anything else — a throttle, a permissions blip, malformed JSON — is
    logged and re-raised rather than swallowed: treating those the same as
    "not created yet" would silently discard every other location's
    freshness history the next time this runs.
    """
    try:
        res = s3_client.get_object(Bucket=bucket, Key=key)
        return json.loads(res["Body"].read()), res["ETag"]
    except Exception as e:
        if _is_error(e, "404", "NoSuchKey", "NotFound"):
            return {}, None
        print(f"_read_json_key: failed to read {key} ({e}); refusing to treat as empty")
        raise


def _write_meta_with_retry(
    s3_client,
    bucket: str,
    stats: dict,
    source_key: str,
    source_modified: str,
    merged_gz: bytes,
) -> None:
    """Read-modify-write META_KEY under the same conditional-write discipline
    as the items object.

    Two locations landing on the same tick can each read META_KEY before the
    other's write lands; without a guard, the last writer reverts the other's
    perLocation entry. So each attempt re-reads META_KEY (and its ETag) fresh
    and rebuilds perLocation from THAT state before writing — a stale rebuild
    computed once outside the loop would defeat the retry entirely.
    """
    last_error = None
    for attempt in range(1, MAX_PUT_ATTEMPTS + 1):
        prior_meta, meta_etag = _read_json_key(s3_client, bucket, META_KEY)

        per_location = dict(prior_meta.get("perLocation") or {})
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
            "lastHealAt": prior_meta.get("lastHealAt"),
        }

        put_kwargs = {
            "Bucket": bucket,
            "Key": META_KEY,
            "Body": json.dumps(new_meta, separators=(",", ":")).encode("utf-8"),
            "ContentType": "application/json",
        }
        if meta_etag is not None:
            put_kwargs["IfMatch"] = meta_etag
        else:
            put_kwargs["IfNoneMatch"] = "*"

        try:
            s3_client.put_object(**put_kwargs)
            return
        except Exception as e:
            if not _is_error(e, "PreconditionFailed", "ConditionalRequestConflict"):
                raise
            last_error = e
            print(f"meta write lost a race (attempt {attempt}); re-reading and retrying")
            time.sleep(0.2 * attempt)  # bounded backoff
            continue

    raise RuntimeError(f"meta write failed after {MAX_PUT_ATTEMPTS} attempts: {last_error}")


def write_merged_cache(
    s3_client,
    bucket: str,
    items: "list[dict[str, Any]]",
    loc: str,  # accepted for symmetry with stamp_arrival's signature; unused here
    source_key: str,
    source_modified: str,
) -> dict:
    """Merge these rows into latest.items by location and refresh latest.meta.

    Raises MergeAborted (leaving both objects untouched) when the incoming file
    cannot be trusted. Both the items write and the meta write are
    conditional — If-Match against a just-read ETag, or If-None-Match: * when
    the object doesn't exist yet — so a lost race retries the whole merge
    against the winner's data rather than clobbering it, and two locations
    racing to create the cache on the first tick can't both succeed.
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
        else:
            put_kwargs["IfNoneMatch"] = "*"

        try:
            s3_client.put_object(**put_kwargs)
        except Exception as e:
            if not _is_error(e, "PreconditionFailed", "ConditionalRequestConflict"):
                raise
            last_error = e
            print(f"cache write lost a race (attempt {attempt}); re-reading and retrying")
            time.sleep(0.2 * attempt)  # bounded backoff
            continue

        _write_meta_with_retry(s3_client, bucket, stats, source_key, source_modified, merged_gz)
        return {**stats, "itemsBytes": len(merged_gz), "attempts": attempt}

    raise RuntimeError(f"cache write failed after {MAX_PUT_ATTEMPTS} attempts: {last_error}")


def stamp_arrival(s3_client, bucket: str, key: str, loc: str, event_time: str) -> dict:
    """Copy a bare <LOC>.csv arrival to its stamped archive key, then delete it.

    No parsing here. The copy raises a fresh S3 event that classifies as
    INGEST, and that invocation does the merge.

    Idempotency cannot key on the destination's own ETag: S3 does not
    preserve a multipart source's composite ETag through CopyObject, so a
    byte-identical copy can report a different ETag. We stamp the source's
    ETag into the destination's metadata and compare against that instead.
    """
    stamp = stamp_from_event_time(event_time)

    # The source is already gone when a duplicate notification arrives after
    # a fully successful run — that is a no-op, not an error.
    try:
        src = s3_client.head_object(Bucket=bucket, Key=key)
    except Exception as e:
        if not _is_error(e, "404", "NoSuchKey", "NotFound"):
            raise
        return {"stamped": None, "deduped": 0, "alreadyStamped": True}

    src_etag = src["ETag"]
    src_len = src["ContentLength"]
    marker = src_etag.strip('"')

    dedupe = 0
    while dedupe <= MAX_DEDUPE:
        target = archive_key(loc, stamp, dedupe)
        try:
            head = s3_client.head_object(Bucket=bucket, Key=target)
        except Exception as e:
            if not _is_error(e, "404", "NoSuchKey", "NotFound"):
                raise
            s3_client.copy_object(
                Bucket=bucket,
                Key=target,
                CopySource={"Bucket": bucket, "Key": key},
                CopySourceIfMatch=src_etag,
                Metadata={"source-etag": marker},
                MetadataDirective="REPLACE",
                # MetadataDirective=REPLACE drops the source's ContentType, so
                # without this the archived CSV lands as binary/octet-stream and
                # anything that re-reads it by content type sees a blob.
                ContentType="text/csv",
                Tagging=ARCHIVE_TAG,
                TaggingDirective="REPLACE",
            )
            # Verify before deleting the only other copy of this file.
            check = s3_client.head_object(Bucket=bucket, Key=target)
            if check.get("ContentLength") != src_len:
                raise RuntimeError(
                    f"stamp: copy verification failed for {target} "
                    f"({check.get('ContentLength')} != {src_len})"
                )
            s3_client.delete_object(Bucket=bucket, Key=key)
            return {"stamped": target, "deduped": dedupe}

        if (head.get("Metadata") or {}).get("source-etag") == marker:
            # Already copied on an earlier delivery; finish the job.
            s3_client.delete_object(Bucket=bucket, Key=key)
            return {"stamped": target, "deduped": dedupe}

        dedupe += 1  # same minute, genuinely different content

    raise RuntimeError(f"stamp: exhausted {MAX_DEDUPE} dedupe slots for {loc} at {stamp}")


# XLSX would need openpyxl in a layer; every OEIVAL we actually see is CSV.
# FULL_RE nonetheless matches these extensions and the upload-url route still
# hands out an xlsx content type, so an xlsx FULL is a real historical shape.
UNPARSEABLE_EXTENSIONS = (".xlsx", ".xls")


def _load_rows(bucket: str, key: str) -> "tuple[list[dict[str, Any]], str]":
    """Fetch and parse an inventory file. Returns (rows, last_modified_iso)."""
    obj = s3.get_object(Bucket=bucket, Key=key)
    last_modified = obj["LastModified"].isoformat()
    key_lower = key.lower()
    if key_lower.endswith(".csv"):
        return parse_csv_stream(obj["Body"]), last_modified
    raise ValueError(f"unsupported extension: {key}")


def _maybe_heal(bucket: str) -> None:
    """Ask IECentral to backfill brand-less adjustments, at most hourly.

    Unthrottled this fired once per upload, which was fine for one daily file
    and is not fine at four arrivals per location per hour. The timestamp
    write is itself conditional: a lost race there just means heal runs again
    sooner (harmless), and we must not clobber a concurrent invocation's
    perLocation/totalRows/etc. writes to the same META_KEY.
    """
    from datetime import datetime, timezone

    meta, _etag = _read_json_key(s3, bucket, META_KEY)
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
    except Exception as e:
        print(f"heal-adjustment-brands call failed (non-fatal): {e}")
        return

    # Record the timestamp so we don't fire again within the hour. Read fresh
    # and rewrite only lastHealAt — never a stale copy of the rest of meta —
    # under the same conditional-write discipline as the merge writes.
    try:
        fresh, fresh_etag = _read_json_key(s3, bucket, META_KEY)
        fresh["lastHealAt"] = _now_iso()
        put_kwargs = {
            "Bucket": bucket,
            "Key": META_KEY,
            "Body": json.dumps(fresh, separators=(",", ":")).encode("utf-8"),
            "ContentType": "application/json",
        }
        if fresh_etag is not None:
            put_kwargs["IfMatch"] = fresh_etag
        else:
            put_kwargs["IfNoneMatch"] = "*"
        s3.put_object(**put_kwargs)
    except Exception as e:
        if _is_error(e, "PreconditionFailed", "ConditionalRequestConflict"):
            print(f"heal timestamp write lost a race (non-fatal); heal may run again sooner: {e}")
        else:
            print(f"heal timestamp write failed (non-fatal): {e}")


def _handle_full(bucket: str, key: str) -> dict:
    """Month-folder snapshot: replace the reporting cache wholesale, as before.

    The items object is replaced unconditionally (this is a wholesale
    snapshot, not a per-location merge). The meta write goes through
    _write_meta_with_retry so it gets the same conditional-write/retry
    discipline as INGEST — we synthesize the stats shape it expects
    (totalRows/filters/replacedLocations/perLocationCounts) from this
    snapshot's own rows rather than writing META_KEY directly.

    NOTE: _write_meta_with_retry only rewrites perLocation entries for
    locations present in `stats["perLocationCounts"]` — it carries forward
    anything else already in prior meta untouched. If this full snapshot no
    longer contains a location that a previous per-location arrival had
    recorded, that stale perLocation entry survives the full-snapshot write.
    That is a known gap, not silently worked around here.

    An .xlsx/.xls snapshot is reported as skipped rather than raising: FULL_RE
    matches those extensions, the old handler returned a skip for them, and
    raising here would fail the invocation, burn two Lambda retries and inflate
    the PROCESS_FAIL metric for a file we simply cannot parse yet.
    """
    if key.lower().endswith(UNPARSEABLE_EXTENSIONS):
        # Deliberately NOT worded PROCESS_FAIL — that string is a metric filter.
        print(f"FULL_SKIP key={key} reason=xlsx not yet supported")
        return {"skipped": f"xlsx not yet supported: {key}"}

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

    per_location_counts: "dict[str, int]" = {}
    for it in items:
        loc = str(it.get("location", "") or "").strip().upper()
        if loc:
            per_location_counts[loc] = per_location_counts.get(loc, 0) + 1

    stats = {
        "totalRows": len(items),
        "filters": filters,
        "replacedLocations": list(per_location_counts.keys()),
        "perLocationCounts": per_location_counts,
    }
    _write_meta_with_retry(s3, bucket, stats, key, last_modified, items_bytes)

    try:
        print(f"lookup index: {update_lookup_index(items)}")
    except Exception as e:
        print(f"lookup index update failed (non-fatal): {e}")

    # Non-fatal, same as the lookup index above. _maybe_heal's first act is a
    # GetObject on META_KEY, and _read_json_key re-raises anything that is not a
    # 404 — so an unguarded throttle here would turn a fully successful merge
    # into a failed invocation plus two retries that redo the whole merge.
    try:
        _maybe_heal(bucket)
    except Exception as e:
        print(f"heal check failed (non-fatal): {e}")

    return {"totalRows": len(items), "itemsBytes": len(items_bytes)}


def handler(event, _context):
    from urllib.parse import unquote_plus

    results = []
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        # SAM/S3 URL-encodes the key — unquote it.
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
                # Non-fatal: the merge already succeeded and was written. See
                # the matching guard in _handle_full.
                try:
                    _maybe_heal(bucket)
                except Exception as e:
                    print(f"heal check failed (non-fatal): {e}")
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


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
