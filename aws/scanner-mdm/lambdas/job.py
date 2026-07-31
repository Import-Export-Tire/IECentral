"""
Scanner Job Lambda
Creates AWS IoT Jobs so remote commands survive an offline scanner — a job execution
sits QUEUED on the AWS side until the device reconnects and asks "what's next for me?"
(see android/scanner-agent JobsClient.kt), unlike the cmd/scanners/# MQTT path in
command.py, which is fire-and-forget and discards a command to an offline device forever.

Supports the same command vocabulary the agent's JobsClient understands: lock, unlock,
restart, install_apk, uninstall_app, push_config, update_pin, apply_policies, get_screen.
`wipe` is deliberately NOT accepted here — it is never offered over Jobs, only over the
direct cmd/scanners/# path, so a durable queued factory-reset can never fire days later
when someone finally powers a device back on.
"""

import json
import os
import time
import re
import boto3
from botocore.exceptions import ClientError

iot = boto3.client("iot")

AWS_ACCOUNT_ID = os.environ.get("AWS_ACCOUNT_ID", "381491950294")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
S3_BUCKET = os.environ.get("S3_ASSETS_BUCKET", "ietires-scanner-assets")
PRESIGN_ROLE_ARN = os.environ.get(
    "SCANNER_JOBS_PRESIGN_ROLE_ARN",
    f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/scanner-iot-presign-role",
)

# Maximum expiresInSec AWS IoT Jobs allows for a presigned-URL placeholder.
PRESIGNED_URL_MAX_EXPIRES_SEC = 3600

# How long a job execution can sit IN_PROGRESS before AWS moves it to TIMED_OUT (itself
# retryable) rather than hanging forever.
DEFAULT_IN_PROGRESS_TIMEOUT_MIN = 60

VALID_COMMANDS = [
    "lock",
    "unlock",
    "restart",
    "install_apk",
    "uninstall_app",
    "push_config",
    "update_pin",
    "apply_policies",
    "get_screen",
    # The remote kill switch for the replacement home screen. Without this in the whitelist
    # a broken launcher could not be turned off remotely, which is the entire reason
    # replacing the launcher is acceptable rather than reckless.
    "set_home",
]

MAX_JOB_ID_LEN = 64
_JOB_ID_DISALLOWED = re.compile(r"[^a-zA-Z0-9_-]")


def sanitize_job_id(raw: str) -> str:
    """AWS IoT jobId allows only [a-zA-Z0-9_-], max 64 chars."""
    cleaned = _JOB_ID_DISALLOWED.sub("-", raw)
    return cleaned[:MAX_JOB_ID_LEN]


def build_job_id(command: str, thing_name: str, suffix: str = "") -> str:
    base = f"{command}-{thing_name}-{int(time.time())}{suffix}"
    return sanitize_job_id(base)


def thing_arn(thing_name: str) -> str:
    return f"arn:aws:iot:{AWS_REGION}:{AWS_ACCOUNT_ID}:thing/{thing_name}"


def build_job_document(command: str, payload: dict) -> tuple[dict, bool]:
    """Returns (document, needs_presigned_url_config)."""
    payload = dict(payload or {})
    needs_presign = False

    if command == "install_apk":
        s3_key = payload.pop("s3Key", None)
        if not s3_key:
            raise ValueError("install_apk requires payload.s3Key")
        # AWS substitutes this placeholder with a real presigned URL at the moment the
        # device FETCHES the job document — not at creation time. That's what lets a
        # scanner that was off for a week still get a valid, unexpired URL when it finally
        # powers on and asks $next/get. A URL generated here (s3.generate_presigned_url)
        # would already be dead by then.
        payload["url"] = (
            "${aws:iot:s3-presigned-url:"
            f"https://s3.{AWS_REGION}.amazonaws.com/{S3_BUCKET}/{s3_key}"
            "}"
        )
        needs_presign = True

    document = {
        "version": "1",
        "command": command,
        "payload": payload,
    }
    return document, needs_presign


def create_job_for_thing(thing_name: str, command: str, payload: dict, in_progress_timeout_min: int):
    document, needs_presign = build_job_document(command, payload)
    document_json = json.dumps(document)

    kwargs = {
        "targets": [thing_arn(thing_name)],
        "document": document_json,
        "targetSelection": "SNAPSHOT",
        "timeoutConfig": {"inProgressTimeoutInMinutes": in_progress_timeout_min},
    }
    if needs_presign:
        kwargs["presignedUrlConfig"] = {
            "roleArn": PRESIGN_ROLE_ARN,
            "expiresInSec": PRESIGNED_URL_MAX_EXPIRES_SEC,
        }

    # jobId cannot be reused — a collision must not silently fail. Retry a handful of times
    # with a disambiguating suffix rather than surfacing a confusing AWS error to the caller.
    last_error = None
    for attempt in range(5):
        suffix = "" if attempt == 0 else f"-{attempt}"
        job_id = build_job_id(command, thing_name, suffix)
        try:
            result = iot.create_job(jobId=job_id, **kwargs)
            return {
                "thingName": thing_name,
                "jobId": result["jobId"],
                "jobArn": result["jobArn"],
            }
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code == "ResourceAlreadyExistsException":
                last_error = e
                continue
            raise
    raise last_error or RuntimeError(f"Could not allocate a unique jobId for {thing_name}")


def handler(event, context):
    try:
        body = json.loads(event.get("body", "{}"))
        command = body.get("command")
        payload = body.get("payload", {}) or {}
        # applyNow is accepted for forward-compatibility with maintenance-window deferral
        # (Stage D of the scanner-mdm hardening design) but has no effect yet — there is no
        # scheduling config on this job. Recorded in the document so a future agent/rollout
        # feature can read it back.
        apply_now = body.get("applyNow")
        if apply_now is not None:
            payload = dict(payload)
            payload["applyNow"] = apply_now

        thing_names = body.get("thingNames")
        if not thing_names:
            single = body.get("thingName")
            thing_names = [single] if single else []

        if not thing_names or not command:
            return response(400, {"error": "Missing thingName (or thingNames) or command"})

        if command not in VALID_COMMANDS:
            return response(400, {"error": f"Invalid command: {command}"})

        in_progress_timeout_min = body.get("inProgressTimeoutInMinutes", DEFAULT_IN_PROGRESS_TIMEOUT_MIN)

        jobs = []
        for thing_name in thing_names:
            jobs.append(create_job_for_thing(thing_name, command, payload, in_progress_timeout_min))

        if len(jobs) == 1:
            return response(200, {"success": True, "command": command, **jobs[0]})
        return response(200, {"success": True, "command": command, "jobs": jobs})

    except ValueError as e:
        print(f"Error: {e}")
        return response(400, {"error": str(e)})
    except Exception as e:
        print(f"Error: {e}")
        return response(500, {"error": str(e)})


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
