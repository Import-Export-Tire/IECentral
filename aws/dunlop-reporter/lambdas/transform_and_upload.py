"""
Lambda: transform-and-upload
Trigger: API Gateway POST /dunlop/run | EventBridge monthly cron | S3 event
Reads JMK file from S3, applies filter pipeline, generates Dunlop CSV,
uploads to SFTP, writes run log to S3.
"""

import csv
import io
import json
import os
from datetime import datetime, timezone

import boto3
import paramiko

# ─── CONFIG ───────────────────────────────────────────────────────────────────

S3_JMK_BUCKET = os.environ.get("S3_JMK_UPLOADS_BUCKET", "ietires-dunlop-jmk-uploads")
S3_OUTPUT_BUCKET = os.environ.get("S3_OUTPUT_CSVS_BUCKET", "ietires-dunlop-output-csvs")
S3_LOGS_BUCKET = os.environ.get("S3_RUN_LOGS_BUCKET", "ietires-dunlop-run-logs")
S3_SALES_BUCKET = os.environ.get("S3_SALES_DATA_BUCKET", "ietires-sales-data")

CUSTOMER_NUMBER = "20118"
COUNTRY = "US"

# Location address map
LOCATIONS = {
    "W07": {"address": "350 Pittsburgh Street", "city": "Uniontown", "state": "PA", "zip": "15401"},
    "W08": {"address": "410 Unity St", "city": "Latrobe", "state": "PA", "zip": "15650"},
    "W09": {"address": "207 Chestnut Ridge Rd", "city": "Latrobe", "state": "PA", "zip": "15650"},
    "R10": {"address": "151 Feed Mill Rd", "city": "Everson", "state": "PA", "zip": "15631"},
}

VALID_LOCATIONS = set(LOCATIONS.keys())
VALID_BRANDS = {"FAL", "DUN"}
EXCLUDE_TRN_PUR = {"700", "7001", "7002"}

# OEA07V column indices (zero-based)
COL_ITEM_ID = 0         # A: Item Id
COL_MFG_ID = 4          # E: MFG Id
COL_MFG_ITEM_ID = 5     # F: MFG's Item Id
COL_LOC_ID = 8          # I: Loc Id
COL_TRN_PUR = 9         # J: Trn Pur
COL_QTY = 10            # K: Qty Sl/Rc
COL_SELL_PRICE = 13     # N: U/Sell FET/In
COL_ACTIVITY_DATE = 18   # S: Activity Date

# SFTP credentials from Secrets Manager
SECRETS_ARN = os.environ.get("SFTP_SECRETS_ARN", "")

# Output CSV headers (exact order per Dunlop spec)
OUTPUT_HEADERS = [
    "CUSTOMER_NUMBER", "CUSTOMER_ITEM_NUMBER", "SRNA_ITEM_NUMBER",
    "TRANSACTION_DATE", "SALES_QTY", "ONHAND_QTY", "INVENTORY_QTY",
    "PO_QTY", "BO_QTY", "12M_DMD", "INVOICE_PRICE",
    "ADDRESS", "CITY", "STATE", "ZIP CODE", "COUNTRY",
]

s3 = boto3.client("s3")
secrets = boto3.client("secretsmanager")


def handler(event, context):
    """Main entry point."""
    try:
        # S3-triggered hourly JMK drop (jmk-uploads/sftp-sales/): refresh the
        # dashboard sales data ONLY. The Dunlop report + outbound SFTP stay on the
        # monthly job — we must not re-send Dunlop a report every hour.
        if isinstance(event, dict) and event.get("Records"):
            return _handle_s3_sales_drop(event)

        # Parse input — API Gateway or EventBridge
        if "body" in event:
            body = json.loads(event["body"])
        else:
            body = event

        s3_key = body.get("s3_key")
        month = body.get("month")
        env = body.get("env", "dev")
        run_by = body.get("runBy", "system")

        # Fetch Fanatic dealer JMKs — prefer from request, fall back to Convex API
        fanatic_jmks = set(body.get("fanaticJmks", []))
        if not fanatic_jmks:
            fanatic_jmks = _fetch_fanatic_jmks()

        if not s3_key or not month:
            return _response(400, {"error": "s3_key and month are required"})

        timestamp = datetime.now(timezone.utc).isoformat()

        # 1. Read JMK file from S3
        raw_data = _read_s3_file(s3_key)
        rows = _parse_csv(raw_data)

        # 1b. Save full parsed data to sales data bucket for dashboard
        try:
            _save_sales_data(rows, month)
        except Exception:
            pass  # Don't fail the Dunlop run if sales data save fails

        # 2. Apply filter pipeline
        filtered, summary = _filter_rows(rows, month, fanatic_jmks)

        # 3. Build output CSV
        output_rows = _transform_rows(filtered)
        csv_content = _build_csv(output_rows)
        if month == "backfill":
            output_filename = "ImportExportTireCo_202401-202602_Sellout.csv"
        else:
            output_filename = f"ImportExportTireCo_{month}_Sellout.csv"

        # 4. Write output CSV to S3
        output_key = f"output-csvs/{output_filename}"
        s3.put_object(
            Bucket=S3_OUTPUT_BUCKET,
            Key=output_key,
            Body=csv_content.encode("utf-8"),
            ContentType="text/csv",
        )

        # 5. Upload to SFTP
        sftp_status = "success"
        errors = []
        try:
            _upload_sftp(csv_content, output_filename, env)
        except Exception as e:
            sftp_status = "failed"
            errors.append(f"SFTP upload failed: {str(e)}")

        # 6. Write run log to S3
        run_log = {
            "month": month,
            "fileName": s3_key.split("/")[-1],
            "outputFile": output_filename,
            "rows": len(output_rows),
            "sftpStatus": sftp_status,
            "env": env,
            "runBy": run_by,
            "timestamp": timestamp,
            "errors": errors,
            "filterSummary": summary,
        }

        log_key = f"run-logs/{month}_{timestamp.replace(':', '-')}.json"
        s3.put_object(
            Bucket=S3_LOGS_BUCKET,
            Key=log_key,
            Body=json.dumps(run_log).encode("utf-8"),
            ContentType="application/json",
        )

        return _response(200, run_log)

    except Exception as e:
        return _response(500, {"error": str(e)})


def _handle_s3_sales_drop(event):
    """Refresh processed/{month}.json from an SFTP-dropped sales file. Parses the
    file, groups rows by their activity month, and rewrites each month's snapshot
    (same replace-semantics as the manual run — functionality unchanged, just more
    frequent). No Dunlop report, no outbound SFTP."""
    import urllib.parse

    refreshed = {}
    for rec in event.get("Records", []):
        key = urllib.parse.unquote_plus(rec.get("s3", {}).get("object", {}).get("key", ""))
        if not key or key.endswith("/"):
            continue
        rows = _parse_csv(_read_s3_file(key))
        by_month = {}
        for row in rows:
            if len(row) <= COL_ACTIVITY_DATE:
                continue
            parsed = _parse_date(row[COL_ACTIVITY_DATE].strip())
            if not parsed:
                continue
            ym = f"{parsed[0]}{parsed[1]:02d}"
            by_month.setdefault(ym, []).append(row)
        for ym, mrows in by_month.items():
            _save_sales_data(mrows, ym)
            refreshed[ym] = refreshed.get(ym, 0) + len(mrows)
    return _response(200, {"refreshed": refreshed, "source": "sftp-sales-drop"})


# ─── PARSE ────────────────────────────────────────────────────────────────────

def _read_s3_file(key):
    """Read file from S3, return as string."""
    resp = s3.get_object(Bucket=S3_JMK_BUCKET, Key=key)
    raw = resp["Body"].read()
    # Try UTF-8, fall back to latin-1
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def _parse_csv(text):
    """Parse JMK CSV (handles BOM, null bytes, quoted fields)."""
    cleaned = text.replace("\ufeff", "").replace("\0", "")
    reader = csv.reader(io.StringIO(cleaned))
    rows = list(reader)
    # Skip header row
    return rows[1:] if len(rows) > 1 else []


# ─── FILTER PIPELINE ─────────────────────────────────────────────────────────

def _filter_rows(rows, month, fanatic_jmks=None):
    """
    Apply filter pipeline per spec:
    1. Trn Pur == 'Sld' — sales only
    2. Exclude return types: 700, 7001, 7002
    3. Exclude zero-price
    4. Location filter: W07, W08, R10 only
    5. Brand filter: FAL, DUN only
    6. Fanatic exclusion: exclude FAL-brand rows for Fanatic dealer accounts
    7. Month filter: Activity Date matches reporting month
    """
    if fanatic_jmks is None:
        fanatic_jmks = set()
    total_input = len(rows)

    # Step 1+2: Sales only, exclude return types
    after_sales = []
    for row in rows:
        if len(row) <= max(COL_TRN_PUR, COL_ACTIVITY_DATE):
            continue
        trn_pur = row[COL_TRN_PUR].strip()
        if trn_pur == "Sld" and trn_pur not in EXCLUDE_TRN_PUR:
            after_sales.append(row)

    # Step 3: Exclude zero price
    after_price = []
    for row in after_sales:
        try:
            price = float(row[COL_SELL_PRICE].strip() or "0")
        except (ValueError, IndexError):
            price = 0.0
        if price != 0.0:
            after_price.append(row)

    # Step 4: Location filter
    after_location = []
    for row in after_price:
        loc = row[COL_LOC_ID].strip().upper() if len(row) > COL_LOC_ID else ""
        if loc in VALID_LOCATIONS:
            after_location.append(row)

    # Step 5: Brand filter
    after_brand = []
    for row in after_location:
        brand = row[COL_MFG_ID].strip().upper() if len(row) > COL_MFG_ID else ""
        if brand in VALID_BRANDS:
            after_brand.append(row)

    # Step 6: Month filter — Activity Date year+month matches reporting month
    # "backfill" mode skips month filtering (all months pass through)
    if month == "backfill":
        after_month = list(after_brand)
    else:
        target_year = int(month[:4])
        target_month = int(month[4:6])
        after_month = []
        for row in after_brand:
            date_str = row[COL_ACTIVITY_DATE].strip() if len(row) > COL_ACTIVITY_DATE else ""
            parsed = _parse_date(date_str)
            if parsed and parsed[0] == target_year and parsed[1] == target_month:
                after_month.append(row)

    # Step 7: Fanatic exclusion — exclude FAL-brand rows sold to Fanatic dealer accounts
    # These are Falken tires sold to enrolled Fanatic dealers — reported separately via dealer rebates
    if fanatic_jmks:
        after_fanatic = []
        for row in after_month:
            brand = row[COL_MFG_ID].strip().upper() if len(row) > COL_MFG_ID else ""
            acct = row[15].strip().lower() if len(row) > 15 else ""  # Account Id column
            # Only exclude FAL brand rows for Fanatic accounts; DUN rows pass through
            if brand == "FAL" and acct in fanatic_jmks:
                continue
            after_fanatic.append(row)
        final = after_fanatic
    else:
        final = after_month

    summary = {
        "totalInput": total_input,
        "afterBrandFilter": len(after_brand),
        "afterLocationFilter": len(after_location),
        "afterExclusions": len(final),
        "finalOutput": len(final),
    }

    return final, summary


def _parse_date(date_str):
    """Parse M/D/YYYY or MM/DD/YY date, return (year, month, day) or None."""
    if not date_str:
        return None
    parts = date_str.split("/")
    if len(parts) != 3:
        return None
    try:
        m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
        if y < 100:
            y += 2000
        return (y, m, d)
    except ValueError:
        return None


# ─── TRANSFORM ────────────────────────────────────────────────────────────────

def _strip_trailing_chars(s):
    """Strip trailing . or [ characters from item IDs."""
    return s.rstrip(".").rstrip("[").strip()


def _transform_rows(rows):
    """Map JMK rows to Dunlop output format."""
    output = []
    for row in rows:
        loc_id = row[COL_LOC_ID].strip().upper()
        loc = LOCATIONS.get(loc_id, {})

        # Item IDs — strip trailing . or [
        customer_item = _strip_trailing_chars(row[COL_ITEM_ID].strip() if len(row) > COL_ITEM_ID else "")
        srna_item = _strip_trailing_chars(row[COL_MFG_ITEM_ID].strip() if len(row) > COL_MFG_ITEM_ID else "")

        # Activity Date — format as M/D/YYYY
        date_str = row[COL_ACTIVITY_DATE].strip() if len(row) > COL_ACTIVITY_DATE else ""
        parsed = _parse_date(date_str)
        if parsed:
            transaction_date = f"{parsed[1]}/{parsed[2]}/{parsed[0]}"
        else:
            transaction_date = date_str

        # Qty — always negative in JMK, use abs()
        try:
            qty = abs(int(float(row[COL_QTY].strip() or "0")))
        except (ValueError, IndexError):
            qty = 0

        # Price — abs(), round to 2 decimal places
        try:
            price = round(abs(float(row[COL_SELL_PRICE].strip() or "0")), 2)
        except (ValueError, IndexError):
            price = 0.0

        output.append({
            "CUSTOMER_NUMBER": CUSTOMER_NUMBER,
            "CUSTOMER_ITEM_NUMBER": customer_item,
            "SRNA_ITEM_NUMBER": srna_item,
            "TRANSACTION_DATE": transaction_date,
            "SALES_QTY": str(qty),
            "ONHAND_QTY": "",
            "INVENTORY_QTY": "",
            "PO_QTY": "",
            "BO_QTY": "",
            "12M_DMD": "",
            "INVOICE_PRICE": f"{price:.2f}",
            "ADDRESS": loc.get("address", ""),
            "CITY": loc.get("city", ""),
            "STATE": loc.get("state", ""),
            "ZIP CODE": loc.get("zip", ""),
            "COUNTRY": COUNTRY,
        })

    return output


def _build_csv(rows):
    """Build CSV string from row dicts."""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=OUTPUT_HEADERS)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


# ─── SFTP ─────────────────────────────────────────────────────────────────────

def _get_sftp_creds(env):
    """Fetch SFTP credentials from AWS Secrets Manager."""
    if not SECRETS_ARN:
        raise ValueError("SFTP_SECRETS_ARN environment variable not set")

    resp = secrets.get_secret_value(SecretId=SECRETS_ARN)
    all_creds = json.loads(resp["SecretString"])

    # Secret stores both dev and prod creds
    key = f"sftp_{env}"
    creds = all_creds.get(key)
    if not creds:
        raise ValueError(f"No SFTP credentials found for env: {env}")

    return creds  # { host, port, username, password }


def _upload_sftp(csv_content, filename, env):
    """Upload CSV file to Dunlop SFTP server."""
    creds = _get_sftp_creds(env)

    transport = paramiko.Transport((creds["host"], int(creds.get("port", 22))))
    try:
        transport.connect(username=creds["username"], password=creds["password"])
        sftp = paramiko.SFTPClient.from_transport(transport)

        remote_dir = creds.get("directory", "inbound")
        remote_path = f"{remote_dir}/{filename}"

        with sftp.open(remote_path, "w") as f:
            f.write(csv_content)

        sftp.close()
    finally:
        transport.close()


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def _fetch_fanatic_jmks():
    """Fetch Fanatic dealer JMK list directly from Convex HTTP API."""
    import urllib.request

    CONVEX_URL = os.environ.get("CONVEX_URL", "https://outstanding-dalmatian-787.convex.cloud")
    try:
        req = urllib.request.Request(
            f"{CONVEX_URL}/api/query",
            data=json.dumps({
                "path": "dealerRebates:listDealers",
                "args": {"program": "falken", "activeOnly": True},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode("utf-8"))
        dealers = data.get("value", [])
        jmks = set()
        for d in dealers:
            if d.get("fanaticId") and d.get("jmk"):
                jmks.add(d["jmk"].lower().strip())
        jmks.discard("0")
        jmks.discard("")
        return jmks
    except Exception:
        return set()


def _save_sales_data(rows, month):
    """Save full parsed sales data to S3 for the sales dashboard.
    Processes ALL rows (not just FAL/DUN), groups by date, and stores as JSON."""

    COL_MAP = {
        "item_id": COL_ITEM_ID, "mfg_id": COL_MFG_ID, "mfg_item_id": COL_MFG_ITEM_ID,
        "loc_id": COL_LOC_ID, "trn_pur": COL_TRN_PUR, "qty": COL_QTY,
        "sell_price": COL_SELL_PRICE, "activity_date": COL_ACTIVITY_DATE,
    }

    parsed_rows = []
    for row in rows:
        if len(row) <= COL_ACTIVITY_DATE:
            continue
        try:
            qty_raw = float(row[COL_QTY].strip() or "0")
            price_raw = float(row[COL_SELL_PRICE].strip() or "0")
            ext_sell = float(row[14].strip() or "0") if len(row) > 14 else 0
        except (ValueError, IndexError):
            continue

        date_str = row[COL_ACTIVITY_DATE].strip()
        parsed = _parse_date(date_str)
        if not parsed:
            continue

        parsed_rows.append({
            "date": f"{parsed[0]}-{parsed[1]:02d}-{parsed[2]:02d}",
            "item_id": _strip_trailing_chars(row[COL_ITEM_ID].strip()),
            "description": row[1].strip() if len(row) > 1 else "",
            "product_type": row[3].strip() if len(row) > 3 else "",
            "brand": row[COL_MFG_ID].strip(),
            "mfg_item": row[COL_MFG_ITEM_ID].strip(),
            "loc": row[COL_LOC_ID].strip(),
            "trn": row[COL_TRN_PUR].strip(),
            "qty": int(qty_raw),
            "price": round(price_raw, 2),
            "ext_sell": round(ext_sell, 2),
            "account": row[15].strip() if len(row) > 15 else "",
            "customer": row[19].strip() if len(row) > 19 else "",
        })

    # Save to S3
    sales_key = f"processed/{month}.json"
    s3.put_object(
        Bucket=S3_SALES_BUCKET,
        Key=sales_key,
        Body=json.dumps({"month": month, "rowCount": len(parsed_rows), "rows": parsed_rows}).encode("utf-8"),
        ContentType="application/json",
    )


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
