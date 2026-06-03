"""
Scanner Status Lambda
Triggered by IoT Rule when device shadow updates.
Forwards telemetry to Convex via HTTP endpoint.
"""

import json
import os
import urllib.request
import boto3

secrets = boto3.client("secretsmanager")

CONVEX_URL = os.environ.get("CONVEX_URL")
SECRETS_ARN = os.environ.get("SECRETS_ARN")

_cached_creds = None


def get_credentials():
    global _cached_creds
    if _cached_creds is None:
        resp = secrets.get_secret_value(SecretId=SECRETS_ARN)
        _cached_creds = json.loads(resp["SecretString"])
    return _cached_creds


def handler(event, context):
    """
    Event comes from IoT Rule SQL:
    SELECT *, topic(3) as thingName
    FROM 'dt/scanners/+/telemetry'

    The event IS the raw telemetry payload from the device,
    plus thingName injected by the SQL.
    """
    try:
        thing_name = event.get("thingName")
        if not thing_name:
            print("No thingName in event")
            return

        # Build telemetry payload for Convex — event IS the raw telemetry
        telemetry = {
            "iotThingName": thing_name,
        }

        if "battery" in event:
            telemetry["batteryLevel"] = event["battery"]
        if "wifiSignal" in event:
            telemetry["wifiSignal"] = event["wifiSignal"]
        if "gps" in event and isinstance(event["gps"], dict):
            lat = event["gps"].get("lat")
            lng = event["gps"].get("lng")
            if lat is not None:
                telemetry["gpsLatitude"] = lat
            if lng is not None:
                telemetry["gpsLongitude"] = lng
        if "apps" in event and isinstance(event["apps"], dict):
            apps = {}
            for key in ("tireTrack", "rtLocator", "scannerAgent"):
                val = event["apps"].get(key)
                if val is not None:
                    apps[key] = val
            if apps:
                telemetry["installedApps"] = apps
        if "agentVersion" in event:
            telemetry["agentVersion"] = event["agentVersion"]
        if "androidVersion" in event:
            telemetry["androidVersion"] = event["androidVersion"]
        if "isLocked" in event:
            telemetry["isLocked"] = event["isLocked"]
        if "lastCommandAck" in event:
            telemetry["lastCommandAck"] = event["lastCommandAck"]
        if "storageTotal" in event:
            telemetry["storageTotal"] = event["storageTotal"]
        if "storageFree" in event:
            telemetry["storageFree"] = event["storageFree"]
        telemetry["deviceOwner"] = event.get("deviceOwner", False)
        telemetry["pinManaged"] = event.get("pinManaged", False)
        if "pin" in event:
            telemetry["pin"] = event["pin"]

        # POST to Convex HTTP endpoint
        creds = get_credentials()
        webhook_secret = creds.get("webhook_secret", "")

        convex_http_url = CONVEX_URL.replace(
            ".convex.cloud", ".convex.site"
        )
        url = f"{convex_http_url}/scanner-telemetry"

        data = json.dumps(telemetry).encode()
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "x-webhook-secret": webhook_secret,
            },
        )

        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"Telemetry forwarded for {thing_name}: {result}")

    except Exception as e:
        print(f"Error processing shadow update: {e}")
        raise
