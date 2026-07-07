"""
Lambda: fetch-sales
Trigger: API Gateway GET /dunlop/sales?months=202603
  - No params: returns list of available months
  - months=YYYYMM: returns aggregated data for that month
  - months=YYYYMM&compare=true: returns current + prev month + same month last year
Returns pre-aggregated sales data from S3.
"""

import json
import os
from collections import defaultdict
from datetime import datetime, timezone
try:
    from zoneinfo import ZoneInfo
    _BIZ_TZ = ZoneInfo("America/Los_Angeles")
except Exception:  # pragma: no cover
    _BIZ_TZ = None
import boto3

S3_BUCKET = os.environ.get("S3_SALES_DATA_BUCKET", "ietires-sales-data")

s3 = boto3.client("s3")


def handler(event, context):
    try:
        params = event.get("queryStringParameters") or {}
        months = params.get("months", "")
        compare = params.get("compare", "").lower() == "true"

        locations = params.get("locations", "")  # Comma-separated location filter (e.g., "W07,W08")
        loc_filter = set(l.strip() for l in locations.split(",") if l.strip()) if locations else None

        if months:
            month_list = [m.strip() for m in months.split(",") if m.strip()]

            if compare and len(month_list) == 1:
                # Comparison mode: fetch current, previous month, and same month last year
                current_month = month_list[0]
                prev_month = _prev_month(current_month)
                yoy_month = _yoy_month(current_month)

                current_rows = _fetch_month(current_month, loc_filter)
                prev_rows = _fetch_month(prev_month, loc_filter)
                yoy_rows = _fetch_month(yoy_month, loc_filter)

                # Business-day-aligned comparison: when the requested month is the
                # CURRENT (in-progress) calendar month, it has only run for N selling
                # days so far. Cap the prior-month and year-ago rows to their FIRST N
                # selling days ("through business day N") so equal numbers of selling
                # days are compared — weekends/holidays excluded. Completed past months
                # are left full.
                now = datetime.now(_BIZ_TZ) if _BIZ_TZ else datetime.now(timezone.utc)
                comparison_through_day = None
                comparison_business_days = None
                if current_month == now.strftime("%Y%m"):
                    cur_biz = _selling_days(current_rows)
                    n = len(cur_biz)
                    if n:
                        comparison_business_days = n
                        comparison_through_day = _day_of_month(cur_biz[-1])  # latest selling day-of-month
                        prev_rows = _cap_rows_to_business_days(prev_rows, n)
                        yoy_rows = _cap_rows_to_business_days(yoy_rows, n)

                result = {
                    "current": _aggregate(current_rows),
                    "currentMonth": current_month,
                    # Number of selling days the comparison covers (null = full-month compare).
                    "comparisonBusinessDays": comparison_business_days,
                    # Day-of-month of the latest selling day included (null = full month).
                    "comparisonThroughDay": comparison_through_day,
                    "prevMonth": {
                        "month": prev_month,
                        "data": _aggregate(prev_rows) if prev_rows else None,
                    },
                    "yoyMonth": {
                        "month": yoy_month,
                        "data": _aggregate(yoy_rows) if yoy_rows else None,
                    },
                    # Multi-month trend: last 12 months of KPIs
                    "monthlyTrend": _monthly_trend(current_month, 12, loc_filter),
                    # All available locations (unfiltered) for the filter UI
                    "allLocations": _get_all_locations(current_month),
                }
                return _response(200, result)

            # Standard mode: aggregate across all requested months
            all_rows = []
            for month in month_list:
                all_rows.extend(_fetch_month(month, loc_filter))

            result = _aggregate(all_rows)
            return _response(200, result)

        # List available months
        paginator = s3.get_paginator("list_objects_v2")
        available = []
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix="processed/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key.endswith(".json"):
                    month = key.replace("processed/", "").replace(".json", "")
                    if month.isdigit() and len(month) == 6:
                        available.append(month)

        available.sort(reverse=True)
        return _response(200, {"available": available})

    except Exception as e:
        return _response(500, {"error": str(e)})


def _fetch_month(month, loc_filter=None):
    """Fetch a single month's rows from S3. Optionally filter by locations. Returns [] if not found."""
    try:
        resp = s3.get_object(Bucket=S3_BUCKET, Key=f"processed/{month}.json")
        data = json.loads(resp["Body"].read().decode("utf-8"))
        rows = data.get("rows", [])
        if loc_filter:
            rows = [r for r in rows if r.get("loc", "") in loc_filter]
        return rows
    except Exception:
        return []


def _get_all_locations(month):
    """Get all unique location codes from a month (unfiltered) for the filter UI."""
    try:
        resp = s3.get_object(Bucket=S3_BUCKET, Key=f"processed/{month}.json")
        data = json.loads(resp["Body"].read().decode("utf-8"))
        rows = data.get("rows", [])
        return sorted(set(r.get("loc", "") for r in rows if r.get("loc")))
    except Exception:
        return []


def _day_of_month(date_str):
    """Day-of-month int from a 'YYYY-MM-DD' date string, or None if unparseable."""
    if not date_str or len(date_str) < 10:
        return None
    try:
        return int(date_str[8:10])
    except ValueError:
        return None


def _selling_days(rows):
    """Sorted unique dates that had an actual sale (trn == 'Sld') — a 'business day'.
    Defining it empirically handles weekends/holidays without a Mon-Fri rule."""
    return sorted({r.get("date") for r in rows if r.get("trn") == "Sld" and r.get("date")})


def _cap_rows_to_business_days(rows, n):
    """Keep rows only from the first n selling days of the period (business-day aligned)."""
    allowed = set(_selling_days(rows)[:n])
    return [r for r in rows if r.get("date") in allowed]


def _prev_month(month_str):
    """Get previous month string. e.g., '202603' -> '202602', '202601' -> '202512'."""
    y, m = int(month_str[:4]), int(month_str[4:])
    m -= 1
    if m < 1:
        m = 12
        y -= 1
    return f"{y}{m:02d}"


def _yoy_month(month_str):
    """Get same month last year. e.g., '202603' -> '202503'."""
    y = int(month_str[:4]) - 1
    m = month_str[4:]
    return f"{y}{m}"


def _monthly_trend(current_month, num_months=12, loc_filter=None):
    """Get KPIs for the last N months for trend sparklines."""
    EXCLUDE_BRANDS = {"IET-P", "IET-G", "IET-T"}
    months = []
    m = current_month
    for _ in range(num_months):
        months.append(m)
        m = _prev_month(m)
    months.reverse()

    trend = []
    for month in months:
        rows = _fetch_month(month, loc_filter)
        if not rows:
            trend.append({"month": month, "revenue": 0, "units": 0, "customers": 0, "hasData": False})
            continue
        sales = [r for r in rows if r.get("trn") == "Sld" and r.get("brand", "") not in EXCLUDE_BRANDS]
        revenue = sum(abs(r.get("ext_sell", 0)) for r in sales)
        units = sum(abs(r.get("qty", 0)) for r in sales)
        customers = len(set(r.get("account", "") for r in sales if r.get("account")))
        trend.append({
            "month": month,
            "revenue": round(revenue, 2),
            "units": units,
            "customers": customers,
            "hasData": True,
        })

    return trend


def _aggregate(rows):
    """Pre-aggregate rows for the dashboard to keep response size small."""

    # Exclude IET house brands (misc/manual entries, not real tire sales)
    EXCLUDE_BRANDS = {"IET-P", "IET-G", "IET-T"}

    # KPIs (sales only, excluding IET misc)
    sales = [r for r in rows if r.get("trn") == "Sld" and r.get("brand", "") not in EXCLUDE_BRANDS]
    total_revenue = sum(abs(r.get("ext_sell", 0)) for r in sales)
    total_units = sum(abs(r.get("qty", 0)) for r in sales)
    unique_customers = len(set(r.get("account", "") for r in sales if r.get("account")))

    # By location
    by_loc = defaultdict(lambda: {"units": 0, "revenue": 0})
    for r in sales:
        loc = r.get("loc", "Other")
        by_loc[loc]["units"] += abs(r.get("qty", 0))
        by_loc[loc]["revenue"] += abs(r.get("ext_sell", 0))

    # By brand (top 20)
    by_brand = defaultdict(lambda: {"units": 0, "revenue": 0})
    for r in sales:
        brand = r.get("brand", "Other")
        by_brand[brand]["units"] += abs(r.get("qty", 0))
        by_brand[brand]["revenue"] += abs(r.get("ext_sell", 0))

    # Daily trend
    by_date = defaultdict(lambda: {"units": 0, "revenue": 0})
    for r in sales:
        by_date[r.get("date", "")]["units"] += abs(r.get("qty", 0))
        by_date[r.get("date", "")]["revenue"] += abs(r.get("ext_sell", 0))

    # Transaction type breakdown (all rows)
    by_trn = defaultdict(int)
    for r in rows:
        by_trn[r.get("trn", "Other")] += 1

    # Top customers
    by_customer = defaultdict(lambda: {"name": "", "units": 0, "revenue": 0, "txns": 0})
    for r in sales:
        acct = r.get("account", "") or "Walk-in"
        by_customer[acct]["name"] = r.get("customer", "") or acct
        by_customer[acct]["units"] += abs(r.get("qty", 0))
        by_customer[acct]["revenue"] += abs(r.get("ext_sell", 0))
        by_customer[acct]["txns"] += 1

    # By brand by location (for location/brand matrix)
    brand_loc = defaultdict(lambda: defaultdict(lambda: {"units": 0, "revenue": 0}))
    for r in sales:
        brand = r.get("brand", "Other")
        loc = r.get("loc", "Other")
        brand_loc[brand][loc]["units"] += abs(r.get("qty", 0))
        brand_loc[brand][loc]["revenue"] += abs(r.get("ext_sell", 0))

    # Customer account set for retention analysis
    customer_set = list(set(r.get("account", "") for r in sales if r.get("account")))

    # Day-of-week by location (for Saturday analysis)
    from datetime import date as dt_date
    DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    dow_by_loc = defaultdict(lambda: defaultdict(lambda: {"units": 0, "revenue": 0, "transactions": 0}))
    for r in sales:
        d = r.get("date", "")
        loc = r.get("loc", "Other")
        if not d:
            continue
        try:
            parts = d.split("-")
            day = dt_date(int(parts[0]), int(parts[1]), int(parts[2]))
            dow = DOW_NAMES[day.weekday()]
            dow_by_loc[loc][dow]["units"] += abs(r.get("qty", 0))
            dow_by_loc[loc][dow]["revenue"] += abs(r.get("ext_sell", 0))
            dow_by_loc[loc][dow]["transactions"] += 1
        except Exception:
            continue

    # Format day-of-week data
    dow_data = []
    for loc in sorted(dow_by_loc.keys()):
        loc_total_rev = sum(dow_by_loc[loc][d]["revenue"] for d in DOW_NAMES)
        days = []
        for d in DOW_NAMES:
            dd = dow_by_loc[loc][d]
            pct = (dd["revenue"] / loc_total_rev * 100) if loc_total_rev > 0 else 0
            days.append({"day": d, "revenue": round(dd["revenue"], 2), "units": dd["units"], "transactions": dd["transactions"], "pct": round(pct, 1)})
        sat = dow_by_loc[loc]["Sat"]
        sat_pct = (sat["revenue"] / loc_total_rev * 100) if loc_total_rev > 0 else 0
        dow_data.append({
            "loc": loc,
            "totalRevenue": round(loc_total_rev, 2),
            "saturdayRevenue": round(sat["revenue"], 2),
            "saturdayPct": round(sat_pct, 1),
            "saturdayUnits": sat["units"],
            "saturdayTransactions": sat["transactions"],
            "days": days,
        })

    # Unique locations
    unique_locs = sorted(set(r.get("loc", "") for r in rows if r.get("loc")))

    return {
        "kpis": {
            "totalRevenue": round(total_revenue, 2),
            "totalUnits": total_units,
            "avgPrice": round(total_revenue / total_units, 2) if total_units > 0 else 0,
            "uniqueCustomers": unique_customers,
        },
        "byLocation": sorted(
            [{"name": k, **v} for k, v in by_loc.items()],
            key=lambda x: -x["revenue"]
        ),
        "byBrand": sorted(
            [{"name": k, **v} for k, v in by_brand.items()],
            key=lambda x: -x["revenue"]
        )[:20],
        "dailyTrend": sorted(
            [{"date": k, **v} for k, v in by_date.items() if k],
            key=lambda x: x["date"]
        ),
        "byTrnType": sorted(
            [{"name": k, "value": v} for k, v in by_trn.items()],
            key=lambda x: -x["value"]
        ),
        "topCustomers": sorted(
            [{"account": k, **v} for k, v in by_customer.items()],
            key=lambda x: -x["revenue"]
        )[:20],
        "uniqueLocations": unique_locs,
        "dowByLocation": dow_data,
        "totalRows": len(rows),
        "customerAccounts": customer_set,
    }


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
