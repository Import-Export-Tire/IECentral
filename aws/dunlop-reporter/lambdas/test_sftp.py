"""
Lambda: test-sftp
Trigger: API Gateway POST /dunlop/settings/test

Dry-run connectivity check against the Dunlop SFTP server. Connects,
authenticates, and lists the configured remote directory — then
disconnects. It never writes a file, so it is safe to run at any time;
a real send cannot be recalled once Dunlop receives it.

Credentials are read from Secrets Manager rather than accepted in the
request body, so this exercises exactly what the monthly job will use
and no password ever crosses the wire.

Must run in the same VPC/NAT as transform_and_upload so the connection
egresses from the static IP Dunlop has whitelisted. Testing from
anywhere else would be blocked at their firewall and report a false
failure.
"""

import json
import os
import socket
import time

import boto3
import paramiko

SECRETS_ARN = os.environ.get("SFTP_SECRETS_ARN", "")

# Keep well under the function timeout so a hung connect returns a
# useful "timed out" verdict instead of a raw Lambda timeout.
CONNECT_TIMEOUT_SEC = 20

secrets = boto3.client("secretsmanager")


def handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
        env = body.get("env", "prod")
        if env not in ("dev", "prod"):
            return _response(400, {"error": "env must be 'dev' or 'prod'"})

        if not SECRETS_ARN:
            return _response(500, {"error": "SFTP_SECRETS_ARN not configured"})

        resp = secrets.get_secret_value(SecretId=SECRETS_ARN)
        all_creds = json.loads(resp["SecretString"])
        creds = all_creds.get(f"sftp_{env}")
        if not creds:
            return _response(404, {"error": f"No credentials stored for env: {env}"})

        return _response(200, _run_check(env, creds))

    except Exception as e:
        # Never surface a raw exception to the client — it can embed
        # connection strings. Log the detail, return the type.
        print(f"test_sftp unexpected error: {type(e).__name__}: {e}")
        return _response(500, {"error": f"Unexpected {type(e).__name__}"})


def _run_check(env, creds):
    """Walk the connection in stages so a failure names the actual cause."""
    host = creds.get("host", "")
    port = int(creds.get("port", 22))
    username = creds.get("username", "")
    password = creds.get("password", "")
    directory = creds.get("directory", "inbound")

    result = {
        "env": env,
        "host": host,
        "port": port,
        "username": username,
        "directory": directory,
        "ok": False,
        "stage": None,
        "error": None,
        "elapsedMs": None,
        "fileCount": None,
    }

    if not host or not username or not password:
        result["stage"] = "config"
        result["error"] = "Host, username, and password must all be set"
        return result

    started = time.time()
    transport = None
    try:
        # Stage 1 — TCP reachability. Distinguishing this from auth is the
        # whole point: a refused/timed-out connect almost always means the
        # static IP fell off Dunlop's whitelist, not a bad password.
        result["stage"] = "connect"
        sock = socket.create_connection((host, port), timeout=CONNECT_TIMEOUT_SEC)

        # Stage 2 — SSH transport + credential check.
        result["stage"] = "auth"
        transport = paramiko.Transport(sock)
        transport.banner_timeout = CONNECT_TIMEOUT_SEC
        transport.connect(username=username, password=password)

        # Stage 3 — the configured drop directory actually exists and is
        # readable. A wrong `directory` value fails the real send at the
        # very last step, so it is worth checking here.
        result["stage"] = "directory"
        sftp = paramiko.SFTPClient.from_transport(transport)
        listing = sftp.listdir(directory)
        result["fileCount"] = len(listing)

        result["stage"] = "done"
        result["ok"] = True

    except socket.timeout:
        result["error"] = (
            f"Timed out after {CONNECT_TIMEOUT_SEC}s connecting to {host}:{port}. "
            "Usually means the static IP is no longer whitelisted."
        )
    except socket.gaierror as e:
        result["stage"] = "dns"
        result["error"] = f"Could not resolve host {host} ({e.strerror or 'DNS failure'})"
    except ConnectionRefusedError:
        result["error"] = f"Connection refused by {host}:{port}"
    except paramiko.AuthenticationException:
        result["error"] = "Authentication failed — username or password is wrong"
    except IOError as e:
        # listdir raises IOError/FileNotFoundError for a missing directory.
        if result["stage"] == "directory":
            result["error"] = f"Directory '{directory}' not found or not readable"
        else:
            result["error"] = f"I/O error: {type(e).__name__}"
    except paramiko.SSHException as e:
        result["error"] = f"SSH error: {e}"
    except Exception as e:
        print(f"test_sftp stage={result['stage']} error: {type(e).__name__}: {e}")
        result["error"] = f"{type(e).__name__} during {result['stage']}"
    finally:
        if transport is not None:
            try:
                transport.close()
            except Exception:
                pass
        result["elapsedMs"] = int((time.time() - started) * 1000)

    return result


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
