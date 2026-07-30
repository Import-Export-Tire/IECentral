"""
Scanner Job Events Lambda
Triggered by an IoT Rule on the AWS IoT Jobs event stream. Forwards each job-execution
status change to Convex so IE Central can show whether a durable command actually landed.

Without this, scannerJobs rows stay QUEUED forever: the sender records a job when it is
created and nothing ever updates it. AWS knows the truth, but the UI would not — which is
the same false-confidence problem the durable-command work exists to remove, just moved
from delivery to display.
"""

import json
import os
import urllib.request
import boto3

secrets = boto3.client("secretsmanager")

CONVEX_URL = os.environ.get("CONVEX_URL")
SECRETS_ARN = os.environ.get("SECRETS_ARN")

_cached_creds = None

# Terminal + in-flight states AWS reports. Anything outside this is passed through rather
# than dropped — a state we don't recognise is still better shown than silently ignored.
KNOWN_STATUSES = {
    "QUEUED",
    "IN_PROGRESS",
    "SUCCEEDED",
    "FAILED",
    "TIMED_OUT",
    "REJECTED",
    "REMOVED",
    "CANCELED",
}


def get_credentials():
    global _cached_creds
    if _cached_creds is None:
        resp = secrets.get_secret_value(SecretId=SECRETS_ARN)
        _cached_creds = json.loads(resp["SecretString"])
    return _cached_creds


def call_convex_mutation(deploy_key, path, args):
    url = f"{CONVEX_URL}/api/mutation"
    data = json.dumps({"path": path, "args": args, "format": "json"}).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Convex {deploy_key}",
        },
    )
    with urllib.request.urlopen(req) as resp:
        payload = json.loads(resp.read())
    # Convex wraps results as {"status":"success","value":...}; urlopen only raises on HTTP
    # errors, so a Convex-level failure arrives as a 200 with status "error".
    if isinstance(payload, dict) and payload.get("status") == "error":
        raise RuntimeError(
            f"Convex mutation {path} failed: {payload.get('errorMessage') or payload}"
        )
    return payload


def summarise_details(event):
    """A short human-readable reason, for the operator reading the UI rather than CloudWatch.

    The agent puts its own explanation in statusDetails (e.g. why it REJECTED a job), which
    is the most useful thing to surface — a bare 'FAILED' tells nobody anything.
    """
    details = event.get("statusDetails") or {}
    if isinstance(details, dict) and details:
        parts = [f"{k}={v}" for k, v in details.items()]
        return "; ".join(parts)[:500]
    return None


def handler(event, context):
    """
    Event comes from an IoT Rule over the Jobs event stream:
        SELECT * FROM '$aws/events/jobExecution/+/+'

    Job execution events carry jobId, status, and (when the device supplied them)
    statusDetails. Job-level events (eventType JOB) are ignored — per-device status is what
    the UI needs, and a job here always targets exactly one thing.
    """
    try:
        # IoT rules may deliver a single event or, with batchMode, a list.
        events = event if isinstance(event, list) else [event]
        for ev in events:
            if not isinstance(ev, dict):
                continue

            event_type = ev.get("eventType")
            if event_type and event_type != "JOB_EXECUTION":
                print(f"Skipping non-execution event: {event_type}")
                continue

            job_id = ev.get("jobId")
            status = ev.get("status")
            if not job_id or not status:
                print(f"Missing jobId/status in event: {json.dumps(ev)[:300]}")
                continue

            if status not in KNOWN_STATUSES:
                print(f"Unrecognised status '{status}' for {job_id} — forwarding anyway")

            args = {"jobId": job_id, "status": status}
            detail = summarise_details(ev)
            if detail:
                args["statusDetail"] = detail

            try:
                creds = get_credentials()
                call_convex_mutation(
                    creds["convex_deploy_key"], "scannerMdm:updateJobStatus", args
                )
                print(f"Updated {job_id} -> {status}")
            except Exception as e:
                # Log and continue: one bad event must not drop the rest of a batch.
                print(f"Failed to update {job_id} -> {status}: {e}")

        return {"ok": True}

    except Exception as e:
        print(f"Error: {e}")
        raise
