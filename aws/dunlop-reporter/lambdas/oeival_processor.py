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
from typing import Any

import boto3

s3 = boto3.client("s3")

BUCKET = os.environ.get("S3_JMK_UPLOADS_BUCKET", "ietires-dunlop-jmk-uploads")

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
LOOKUP_FIELDS = ("itemId", "manufacturerName", "description", "model", "mfgItemId")


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


def row_to_item(row: list[str], col: dict[str, int]) -> dict[str, Any] | None:
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
        "location": g("location"),
        "productType": g("productType"),
        "stockType": gn("stockType"),
        "dclass": dclass,
        "manufacturerCode": g("manufacturerCode"),
        "manufacturerName": g("manufacturerName"),  # raw code — Vercel applies friendly-name mapping
        "model": g("model"),
        "itemId": g("itemId"),
        "mfgItemId": g("mfgItemId"),
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
        if it["location"]:
            locations.add(it["location"])
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


def handler(event, _context):
    record = event["Records"][0]
    bucket = record["s3"]["bucket"]["name"]
    # SAM/S3 URL-encodes the key — unquote it.
    from urllib.parse import unquote_plus
    key = unquote_plus(record["s3"]["object"]["key"])

    # Don't recurse on our own cache writes
    if "_cache" in key:
        return {"skipped": "cache key"}

    # Only process OEIVAL uploads
    if "oeival" not in key.lower():
        return {"skipped": f"non-oeival key: {key}"}

    obj = s3.get_object(Bucket=bucket, Key=key)
    last_modified = obj["LastModified"].isoformat()
    body = obj["Body"]

    key_lower = key.lower()
    if key_lower.endswith(".csv"):
        items = parse_csv_stream(body)
    elif key_lower.endswith(".xlsx") or key_lower.endswith(".xls"):
        # XLSX support would require openpyxl in a Lambda layer. The
        # OEIVAL files we actually see in S3 are all CSV, so leave this
        # as an explicit unsupported case for now rather than half-doing
        # it. Skip cache write; Vercel falls back to its own parse.
        return {"skipped": f"xlsx not yet supported: {key}"}
    else:
        return {"skipped": f"unsupported extension: {key}"}

    filters = build_filters(items)

    # ── items.ndjson.gz — one item per line, gzipped — keeps the
    # client-side read streaming and memory-bounded regardless of size.
    items_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=items_buf, mode="wb", compresslevel=6) as gz:
        for it in items:
            gz.write(json.dumps(it, separators=(",", ":")).encode("utf-8"))
            gz.write(b"\n")
    items_bytes = items_buf.getvalue()
    s3.put_object(
        Bucket=bucket,
        Key=ITEMS_KEY,
        Body=items_bytes,
        ContentType="application/x-ndjson",
        ContentEncoding="gzip",
    )

    # ── meta.json — small companion file. Vercel reads this on every
    # request to know the freshness date + filter dropdowns; only fetches
    # items when actually rendering rows.
    meta = {
        "fileKey": key,
        "fileName": key.rsplit("/", 1)[-1],
        "fileDate": last_modified,
        "totalRows": len(items),
        "filters": filters,
        "itemsKey": ITEMS_KEY,
        "itemsBytes": len(items_bytes),
        "generatedAt": _now_iso(),
    }
    meta_bytes = json.dumps(meta, separators=(",", ":")).encode("utf-8")
    s3.put_object(
        Bucket=bucket,
        Key=META_KEY,
        Body=meta_bytes,
        ContentType="application/json",
    )

    # ── Collective tire-label lookup index — merge (never shrink) so a partial
    # upload refreshes the report snapshot above without dropping label coverage.
    try:
        lookup_stats = update_lookup_index(items)
        print(f"lookup index: {lookup_stats}")
    except Exception as e:
        lookup_stats = {"lookupError": str(e)}
        print(f"lookup index update failed (non-fatal): {e}")

    # Auto-heal: ask IECentral to backfill any brand-less inventory adjustments now
    # that a fresh OEIVAL cache is available. Best-effort — never block processing.
    try:
        import urllib.request
        heal_url = os.environ.get("IECENTRAL_URL", "https://www.iecentral.com") + "/api/reports/heal-adjustment-brands"
        req = urllib.request.Request(heal_url, data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"heal-adjustment-brands: {resp.status} {resp.read()[:200]}")
    except Exception as e:
        print(f"heal-adjustment-brands call failed (non-fatal): {e}")

    return {
        "fileKey": key,
        "totalRows": len(items),
        "itemsBytes": len(items_bytes),
        "metaBytes": len(meta_bytes),
        **lookup_stats,
    }


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
