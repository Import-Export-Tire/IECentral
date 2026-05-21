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
import io
import json
import os
from typing import Any

import boto3

s3 = boto3.client("s3")

BUCKET = os.environ.get("S3_JMK_UPLOADS_BUCKET", "ietires-dunlop-jmk-uploads")
CACHE_KEY = "jmk-uploads/oeival/_cache/latest.json"

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

    cache = {
        "fileKey": key,
        "fileName": key.rsplit("/", 1)[-1],
        "fileDate": last_modified,
        "totalRows": len(items),
        "items": items,
        "filters": filters,
        "generatedAt": _now_iso(),
    }

    body_bytes = json.dumps(cache, separators=(",", ":")).encode("utf-8")
    s3.put_object(
        Bucket=bucket,
        Key=CACHE_KEY,
        Body=body_bytes,
        ContentType="application/json",
    )

    return {
        "fileKey": key,
        "totalRows": len(items),
        "cacheBytes": len(body_bytes),
    }


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
