"""
Scanner Setup Config Lambda
Returns the full setup configuration for a location.
Called by the local setup tool before provisioning a scanner.
"""

import json
import os
import urllib.request
import boto3

secrets = boto3.client("secretsmanager")

CONVEX_URL = os.environ.get("CONVEX_URL")
SECRETS_ARN = os.environ.get("SECRETS_ARN")

# Default bloatware list for Zebra TC51
DEFAULT_BLOATWARE = [
    "com.google.android.apps.docs",
    "com.google.android.apps.maps",
    "com.google.android.apps.photos",
    "com.google.android.apps.tachyon",
    "com.google.android.gm",
    "com.google.android.music",
    "com.google.android.videos",
    "com.google.android.youtube",
    "com.google.android.calendar",
    "com.google.android.contacts",
    "com.google.android.apps.messaging",
    "com.google.android.dialer",
    "com.google.android.apps.walletnfcrel",
    "com.android.chrome",
    "com.android.camera2",
    "com.android.calculator2",
    "com.android.deskclock",
    "com.android.vending",
    "com.google.android.gms.setup",
    "com.google.android.googlequicksearchbox",
]


def get_convex_credentials():
    resp = secrets.get_secret_value(SecretId=SECRETS_ARN)
    return json.loads(resp["SecretString"])


def query_convex(deploy_key, path, args):
    url = f"{CONVEX_URL}/api/query"
    data = json.dumps({"path": path, "args": args, "format": "json"}).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Convex {deploy_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def handler(event, context):
    try:
        path_params = event.get("pathParameters") or {}
        location_code = path_params.get("locationCode")

        if not location_code:
            return response(400, {"error": "Missing locationCode"})

        # Fetch config from Convex
        creds = get_convex_credentials()
        config = query_convex(
            creds["convex_deploy_key"],
            "scannerMdm:getMdmConfigByCode",
            {"locationCode": location_code},
        )

        if config:
            # undefined/null = uses RT Locator (today's default, preserved for every existing
            # location) — only an explicit `false` in Convex opts a location out. This Lambda
            # lists its response fields explicitly, so a new scannerMdmConfigs field does not
            # flow through on its own; it must be added here by name.
            uses_rt_locator = config.get("usesRtLocator")
            if uses_rt_locator is None:
                uses_rt_locator = True
            return response(200, {
                "locationCode": location_code,
                "rtLocatorUrl": config.get("rtLocatorUrl", ""),
                "defaultDeviceIdPrefix": config.get("defaultDeviceIdPrefix", f"{location_code}-"),
                "screenTimeoutMs": config.get("screenTimeoutMs", 1800000),
                "screenRotation": config.get("screenRotation", "portrait"),
                "bloatwarePackages": config.get("bloatwarePackages", DEFAULT_BLOATWARE),
                "wifiSsid": config.get("wifiSsid"),
                "wifiPassword": config.get("wifiPassword"),
                "tireTrackApkSource": config.get("tireTrackApkSource", "s3"),
                "rtConfigXml": config.get("rtConfigXml"),
                "rtDeviceId": config.get("rtDeviceId"),
                "currentTireTrackVersion": config.get("currentTireTrackVersion"),
                "currentRtLocatorVersion": config.get("currentRtLocatorVersion"),
                "currentAgentVersion": config.get("currentAgentVersion"),
                "usesRtLocator": uses_rt_locator,
            })
        else:
            # Return defaults for unconfigured locations
            defaults = get_location_defaults(location_code)
            return response(200, defaults)

    except Exception as e:
        print(f"Error: {e}")
        return response(500, {"error": str(e)})


def get_location_defaults(location_code):
    """Default configuration based on location code."""
    rt_urls = {
        "W08": "http://importexporttire-latrobe.rtlocator.mobi/Login.aspx/",
        "R10": "https://importexporttire-everson-rtlm.rtlocator.com/",
        "W09": "",
    }

    return {
        "locationCode": location_code,
        "rtLocatorUrl": rt_urls.get(location_code, ""),
        "defaultDeviceIdPrefix": f"{location_code}-",
        "screenTimeoutMs": 1800000,
        "screenRotation": "portrait",
        "bloatwarePackages": DEFAULT_BLOATWARE,
        "wifiSsid": None,
        "wifiPassword": None,
        "tireTrackApkSource": "s3",
        "rtConfigXml": None,
        "rtDeviceId": None,
        "currentTireTrackVersion": None,
        "currentRtLocatorVersion": None,
        "currentAgentVersion": None,
        # undefined means "uses RT Locator" everywhere else in this system — matched here so
        # an unconfigured location defaults the same way a configured-but-unset one does.
        "usesRtLocator": True,
    }


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
