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
        # PIN-revert visibility. The agent has always published these (MqttService item 1), but
        # nothing forwarded them, so "someone changed the PIN on the device and the agent put it
        # back" was invisible in IE Central — indistinguishable from a PIN that never changed.
        if "pinRevertCount" in event:
            telemetry["pinRevertCount"] = event["pinRevertCount"]
        if "pinLastRevertedAt" in event:
            # Device sends epoch ms here (System.currentTimeMillis()), unlike the epoch-seconds
            # fields above — 0 means "never reverted".
            telemetry["pinLastRevertedAt"] = event["pinLastRevertedAt"]
        if "pinRevertThrottled" in event:
            telemetry["pinRevertThrottled"] = event["pinRevertThrottled"]

        if "dataWedge" in event and isinstance(event["dataWedge"], dict):
            # DataWedge (barcode engine) state, reported on every tick by agent >= 1.7.3.
            # Only the fields Convex validates are forwarded — the agent's `lastConfig.results`
            # carries raw DataWedge result extras whose shape varies by DataWedge version, and
            # an unexpected key there must not fail the whole telemetry post.
            dw = event["dataWedge"]
            dw_out = {}
            if "installed" in dw:
                dw_out["installed"] = dw["installed"]
            if "packageEnabled" in dw:
                dw_out["packageEnabled"] = dw["packageEnabled"]
            if "packageVersion" in dw:
                dw_out["packageVersion"] = dw["packageVersion"]
            last = dw.get("lastConfig")
            if isinstance(last, dict):
                cfg = {}
                for key in (
                    "setConfigResult",
                    "activeProfile",
                    "dataWedgeVersion",
                    "profile",
                    "suffix",
                    "error",
                ):
                    if last.get(key) is not None:
                        cfg[key] = str(last[key])
                for key in ("sendTab", "sendEnter"):
                    if isinstance(last.get(key), bool):
                        cfg[key] = last[key]
                if "attemptedAt" in last:
                    # Device side is epoch seconds; every Convex timestamp is epoch ms.
                    cfg["at"] = last["attemptedAt"] * 1000
                if cfg:
                    dw_out["lastConfig"] = cfg
            if dw_out:
                telemetry["dataWedge"] = dw_out

        if "screen" in event and isinstance(event["screen"], dict):
            # Only attached by the agent while in get_screen's ~2min fast-publish window
            # (see MqttService.buildScreenPayload/enterFastPublishMode). Renamed here to
            # match Convex's `lastScreen` shape; `snapshotAt` is epoch seconds on the device
            # side (System.currentTimeMillis() / 1000) but every other Convex timestamp is
            # epoch ms, so it's converted once here rather than at every call site downstream.
            screen = event["screen"]
            screen_out = {}
            if "package" in screen:
                screen_out["packageName"] = screen["package"]
            if "activity" in screen:
                screen_out["activity"] = screen["activity"]
            if "title" in screen:
                screen_out["title"] = screen["title"]
            if "text" in screen:
                screen_out["text"] = screen["text"]
            if "truncated" in screen:
                screen_out["truncated"] = screen["truncated"]
            if "snapshotAt" in screen:
                screen_out["at"] = screen["snapshotAt"] * 1000
            if "log" in screen:
                screen_out["logTail"] = screen["log"]
            if screen_out:
                telemetry["screen"] = screen_out

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
