"""
Scanner Fetch APK Lambda
Returns presigned download URL for the latest APK.
Supports TireTrack (from Expo or S3), RT Locator (S3), and Agent (S3).
"""

import json
import os
import re
import urllib.request
import boto3

s3 = boto3.client("s3")
secrets = boto3.client("secretsmanager")

S3_BUCKET = os.environ.get("S3_ASSETS_BUCKET", "ietires-scanner-assets")
CONVEX_URL = os.environ.get("CONVEX_URL")
SECRETS_ARN = os.environ.get("SECRETS_ARN")


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


def get_latest_s3_apk(prefix):
    """Find the most recently uploaded APK with given prefix in S3.
    Returns (key, sha256) or (None, None)."""
    try:
        resp = s3.list_objects_v2(
            Bucket=S3_BUCKET, Prefix=f"apks/{prefix}", MaxKeys=50
        )
        contents = resp.get("Contents", [])
        apks = [c for c in contents if c["Key"].endswith(".apk")]
        if not apks:
            return None, None
        apks.sort(key=lambda x: x["LastModified"], reverse=True)
        key = apks[0]["Key"]
        # Fetch the object's metadata to read sha256 (set at upload time as x-amz-meta-sha256)
        head = s3.head_object(Bucket=S3_BUCKET, Key=key)
        sha256 = head.get("Metadata", {}).get("sha256")
        return key, sha256
    except Exception:
        return None, None


def get_sha256_for_key(key):
    if not key:
        return None
    try:
        head = s3.head_object(Bucket=S3_BUCKET, Key=key)
        return head.get("Metadata", {}).get("sha256")
    except Exception:
        return None


def resolve_version(key, config_version):
    """Version of the APK we are actually serving, most trustworthy source first:
      1. the S3 object's x-amz-meta-version
      2. the version embedded in the key, e.g. apks/scanner-agent-1.2.1.apk -> 1.2.1
      3. the hand-maintained config field (last resort — often stale, hence "vunknown")
    """
    if not key:
        return config_version or "unknown"
    try:
        head = s3.head_object(Bucket=S3_BUCKET, Key=key)
        meta_version = head.get("Metadata", {}).get("version")
        # Require real content: a whitespace-only value is truthy in Python and would be
        # returned verbatim as the version, which is a confidently-wrong answer. Falling
        # through to the key-parsed version is always better than reporting a blank one.
        if meta_version and meta_version.strip():
            return meta_version.strip()
    except Exception as e:
        print(f"resolve_version: head_object failed for {key}: {e}")

    m = re.search(r"-(\d+(?:\.\d+)+)\.apk$", key)
    if m:
        return m.group(1)
    return config_version or "unknown"


def handler(event, context):
    try:
        params = event.get("queryStringParameters") or {}
        app = params.get("app")
        location_code = params.get("locationCode")

        if not app:
            return response(400, {"error": "Missing app parameter"})

        if app not in ("tiretrack", "rtlocator", "agent"):
            return response(400, {"error": f"Invalid app: {app}"})

        # Get MDM config if location specified
        config = None
        if location_code:
            try:
                creds = get_convex_credentials()
                config = query_convex(
                    creds["convex_deploy_key"],
                    "scannerMdm:getMdmConfigByCode",
                    {"locationCode": location_code},
                )
            except Exception as e:
                print(f"Warning: Could not fetch MDM config: {e}")

        # Determine source and fetch URL
        if app == "tiretrack":
            source = "s3"
            if config and config.get("tireTrackApkSource") == "expo":
                source = "expo"

            if source == "expo":
                # Try fetching from Expo/TireTrack Admin API
                try:
                    expo_url = get_expo_build_url()
                    if expo_url:
                        version = config.get("currentTireTrackVersion", "latest")
                        return response(200, {
                            "downloadUrl": expo_url,
                            "version": version,
                            "source": "expo",
                        })
                except Exception as e:
                    print(f"Expo fetch failed, falling back to S3: {e}")

            # S3 fallback or direct S3
            s3_key = None
            s3_sha256 = None
            if config and config.get("tireTrackApkS3Key"):
                s3_key = config["tireTrackApkS3Key"]
                s3_sha256 = get_sha256_for_key(s3_key)
            else:
                s3_key, s3_sha256 = get_latest_s3_apk("tiretrack")

            if not s3_key:
                return response(404, {"error": "TireTrack APK not found"})

            download_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": S3_BUCKET, "Key": s3_key},
                ExpiresIn=3600,
            )
            version = resolve_version(s3_key, (config or {}).get("currentTireTrackVersion"))
            return response(200, {
                "downloadUrl": download_url,
                "version": version,
                "source": "s3",
                "s3Key": s3_key,
                "sha256": s3_sha256,
            })

        elif app == "rtlocator":
            s3_key = None
            s3_sha256 = None
            if config and config.get("rtLocatorApkS3Key"):
                s3_key = config["rtLocatorApkS3Key"]
                s3_sha256 = get_sha256_for_key(s3_key)
            else:
                s3_key, s3_sha256 = get_latest_s3_apk("rtlocator")

            if not s3_key:
                return response(404, {"error": "RT Locator APK not found"})

            download_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": S3_BUCKET, "Key": s3_key},
                ExpiresIn=3600,
            )
            version = resolve_version(s3_key, (config or {}).get("currentRtLocatorVersion"))
            return response(200, {
                "downloadUrl": download_url,
                "version": version,
                "source": "s3",
                "s3Key": s3_key,
                "sha256": s3_sha256,
            })

        elif app == "agent":
            s3_key = None
            s3_sha256 = None
            if config and config.get("agentApkS3Key"):
                s3_key = config["agentApkS3Key"]
                s3_sha256 = get_sha256_for_key(s3_key)
            else:
                s3_key, s3_sha256 = get_latest_s3_apk("scanner-agent")

            if not s3_key:
                return response(404, {"error": "Scanner Agent APK not found"})

            download_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": S3_BUCKET, "Key": s3_key},
                ExpiresIn=3600,
            )
            version = resolve_version(s3_key, (config or {}).get("currentAgentVersion"))
            return response(200, {
                "downloadUrl": download_url,
                "version": version,
                "source": "s3",
                "s3Key": s3_key,
                "sha256": s3_sha256,
            })

    except Exception as e:
        print(f"Error: {e}")
        return response(500, {"error": str(e)})


def get_expo_build_url():
    """
    Fetch the latest TireTrack APK URL from Expo.
    This is a placeholder — needs the actual Expo project slug and API token.
    """
    # TODO: Implement Expo API integration
    # expo_api = "https://api.expo.dev/v2/projects/{projectId}/builds"
    # headers = {"Authorization": f"Bearer {EXPO_TOKEN}"}
    return None


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
