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
        loc = str(row.get("location", "") or "").strip().upper()
        if loc:
            self.locations.add(loc)
        brand = str(row.get("manufacturerName", "") or "").strip()
        if brand:
            self.brands.add(brand)
        pt = str(row.get("productType", "") or "").strip()
        if pt:
            self.product_types.add(pt)
        dclass = str(row.get("dclass", "") or "").strip()
        if dclass:
            self.dclasses.add(dclass)

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
