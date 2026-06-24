"""
Lambda: dunlop-sftp-idp
Custom identity provider for the AWS Transfer Family (SFTP) server.

Transfer Family's built-in (service-managed) auth is SSH-key only; password auth
requires a custom identity provider. This Lambda validates the username/password
JMK presents against credentials stored in Secrets Manager, and on success returns
the IAM role + logical home-directory layout (so JMK sees only /sales and
/inventory, mapped to the right S3 prefixes).

Event (from Transfer Family):
  { "username": "...", "password": "...", "protocol": "SFTP",
    "serverId": "s-...", "sourceIp": "1.2.3.4" }

Return on success: { Role, HomeDirectoryType: "LOGICAL", HomeDirectoryDetails }
Return on failure: {}  (empty object => authentication denied)
"""

import hmac
import json
import os

import boto3

secrets = boto3.client("secretsmanager")

SECRET_ID = os.environ["SFTP_USER_SECRET_ID"]
ROLE_ARN = os.environ["SFTP_USER_ROLE_ARN"]
UPLOADS_BUCKET = os.environ.get("S3_JMK_UPLOADS_BUCKET", "ietires-dunlop-jmk-uploads")

# Logical folders JMK sees -> real S3 targets.
#   /sales      -> jmk-uploads/sftp-sales/  (new sales-dashboard trigger)
#   /inventory  -> jmk-uploads/oeival/      (existing OEIVAL processor trigger)
HOME_DIRECTORY_DETAILS = [
    {"Entry": "/sales", "Target": f"/{UPLOADS_BUCKET}/jmk-uploads/sftp-sales"},
    {"Entry": "/inventory", "Target": f"/{UPLOADS_BUCKET}/jmk-uploads/oeival"},
]


def handler(event, _context):
    username = (event or {}).get("username", "")
    password = (event or {}).get("password", "")

    # Password auth only — reject SSH-key attempts (no password presented).
    if not password:
        print(f"[sftp-idp] deny: no password for user '{username}'")
        return {}

    try:
        raw = secrets.get_secret_value(SecretId=SECRET_ID)["SecretString"]
        creds = json.loads(raw)
    except Exception as e:
        print(f"[sftp-idp] error reading secret: {e}")
        return {}

    expected_user = creds.get("username", "")
    expected_pass = creds.get("password", "")

    user_ok = hmac.compare_digest(username, expected_user)
    pass_ok = hmac.compare_digest(password, expected_pass)
    if not (user_ok and pass_ok):
        print(f"[sftp-idp] deny: bad credentials for user '{username}'")
        return {}

    print(f"[sftp-idp] allow: user '{username}'")
    return {
        "Role": ROLE_ARN,
        "HomeDirectoryType": "LOGICAL",
        "HomeDirectoryDetails": json.dumps(HOME_DIRECTORY_DETAILS),
    }
