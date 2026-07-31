"""
Scanner Command Lambda
Sends MQTT commands to scanners via IoT Core.
Supports: lock, unlock, wipe, install_apk, push_config, restart, update_pin
"""

import json
import os
import boto3

iot_data = boto3.client("iot-data")
s3 = boto3.client("s3")

S3_BUCKET = os.environ.get("S3_ASSETS_BUCKET", "ietires-scanner-assets")

VALID_COMMANDS = [
    "lock",
    "unlock",
    "wipe",
    "install_apk",
    "push_config",
    "restart",
    "update_pin",
    # Kept in step with job.py's list — a command the agent handles but a path rejects is
    # a silent dead end for whoever tries it.
    "uninstall_app",
    "apply_policies",
    "get_screen",
    "set_home",
]


def handler(event, context):
    try:
        body = json.loads(event.get("body", "{}"))
        thing_name = body.get("thingName")
        command = body.get("command")
        payload = body.get("payload", {})
        scanner_id = body.get("scannerId")

        if not thing_name or not command:
            return response(400, {"error": "Missing thingName or command"})

        if command not in VALID_COMMANDS:
            return response(400, {"error": f"Invalid command: {command}"})

        # For install_apk, generate presigned download URL
        if command == "install_apk":
            app = payload.get("app", "tiretrack")
            s3_key = payload.get("s3Key")

            if s3_key:
                download_url = s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": S3_BUCKET, "Key": s3_key},
                    ExpiresIn=3600,
                )
                payload["downloadUrl"] = download_url

        # Build MQTT message
        mqtt_payload = {
            "command": command,
            "timestamp": int(__import__("time").time()),
            "payload": payload,
        }

        # Publish to command topic
        topic = f"cmd/scanners/{thing_name}/{command}"
        iot_data.publish(
            topic=topic,
            qos=1,
            payload=json.dumps(mqtt_payload),
        )

        # Also update the desired state in device shadow for persistent commands
        if command in ("lock", "unlock"):
            iot_data.update_thing_shadow(
                thingName=thing_name,
                payload=json.dumps(
                    {"state": {"desired": {"isLocked": command == "lock"}}}
                ),
            )

        return response(
            200,
            {
                "success": True,
                "topic": topic,
                "command": command,
                "thingName": thing_name,
            },
        )

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
