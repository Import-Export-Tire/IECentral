"""
Scanner Provision Lambda
Creates an AWS IoT thing + certificate for a new scanner.
Returns certificate PEM, private key, and IoT endpoint for the setup tool.
"""

import json
import os
import boto3
import urllib.request

iot = boto3.client("iot")
iot_data = boto3.client("iot-data")
secrets = boto3.client("secretsmanager")

THING_GROUP = os.environ.get("IOT_THING_GROUP", "ietires-scanners")
POLICY_NAME = os.environ.get("IOT_POLICY_NAME", "ietires-scanner-policy")
CONVEX_URL = os.environ.get("CONVEX_URL")
SECRETS_ARN = os.environ.get("SECRETS_ARN")


def get_convex_credentials():
    resp = secrets.get_secret_value(SecretId=SECRETS_ARN)
    return json.loads(resp["SecretString"])


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
        return json.loads(resp.read())


def retire_thing_certs(thing_name):
    """Detach + deactivate + delete every certificate currently attached to a thing.
    Best-effort: any failure is logged and skipped so it never blocks provisioning.
    Returns the count of certificates retired. Requires iot:ListThingPrincipals; if that
    permission is absent the listing fails and 0 is returned (provisioning still succeeds).
    """
    retired = 0
    try:
        principals = iot.list_thing_principals(thingName=thing_name).get("principals", [])
    except Exception as e:
        print(f"retire: list_thing_principals failed for {thing_name}: {e}")
        return retired

    for principal_arn in principals:
        if ":cert/" not in principal_arn:
            continue  # only certificate principals
        cert_id = principal_arn.split("/")[-1]
        try:
            try:
                iot.detach_policy(policyName=POLICY_NAME, target=principal_arn)
            except Exception:
                pass  # policy may already be detached / a different policy
            iot.detach_thing_principal(thingName=thing_name, principal=principal_arn)
            iot.update_certificate(certificateId=cert_id, newStatus="INACTIVE")
            iot.delete_certificate(certificateId=cert_id, forceDelete=True)
            retired += 1
        except Exception as e:
            print(f"retire: failed to retire cert {cert_id}: {e}")
    return retired


def handler(event, context):
    try:
        body = json.loads(event.get("body", "{}"))
        serial_number = body.get("serialNumber")
        location_code = body.get("locationCode")
        scanner_number = body.get("scannerNumber")
        scanner_id = body.get("scannerId")

        if not all([serial_number, location_code, scanner_number]):
            return response(400, {"error": "Missing required fields"})

        thing_name = f"scanner-{scanner_number}"
        # thingArn is deterministic — derive it instead of calling DescribeThing, so the
        # Lambda role needs no extra read permission on the re-provision path.
        region = os.environ.get("AWS_REGION", "us-east-1")
        account_id = context.invoked_function_arn.split(":")[4]
        thing_arn = f"arn:aws:iot:{region}:{account_id}:thing/{thing_name}"

        # Create IoT thing — idempotent. On a software-update re-provision the thing
        # already exists, so tolerate ResourceAlreadyExists and reuse it. We always
        # mint a fresh certificate below (the device's private key can't be re-fetched).
        try:
            iot.create_thing(
                thingName=thing_name,
                thingTypeName="Scanner",
                attributePayload={
                    "attributes": {
                        "serialNumber": serial_number,
                        "locationCode": location_code,
                        "scannerNumber": scanner_number,
                    }
                },
            )
        except iot.exceptions.ResourceAlreadyExistsException:
            pass

        # Add to thing group
        try:
            iot.add_thing_to_thing_group(
                thingGroupName=THING_GROUP,
                thingName=thing_name,
            )
        except Exception:
            pass  # Group may not exist yet in dev

        # Retire any certificate already attached to this thing BEFORE minting the new
        # one. Each re-provision supersedes the device's previous certificate; leaving the
        # old one ACTIVE means a stale private key (on the wiped device and in the claimed
        # provision-code record) could still connect to IoT. Best-effort per certificate
        # so cleanup never blocks provisioning. Safe at this point: provisioning only runs
        # during a new-setup or software-update flow where the device is being
        # (re)configured, so the old certificate's session is going away regardless.
        retired_certs = retire_thing_certs(thing_name)

        # Create certificate and keys
        cert = iot.create_keys_and_certificate(setAsActive=True)
        cert_arn = cert["certificateArn"]
        cert_pem = cert["certificatePem"]
        private_key = cert["keyPair"]["PrivateKey"]
        public_key = cert["keyPair"]["PublicKey"]

        # Attach policy to certificate
        iot.attach_policy(policyName=POLICY_NAME, target=cert_arn)

        # Attach certificate to thing
        iot.attach_thing_principal(thingName=thing_name, principal=cert_arn)

        # Set initial device shadow
        iot_data.update_thing_shadow(
            thingName=thing_name,
            payload=json.dumps(
                {
                    "state": {
                        "desired": {
                            "configVersion": "initial",
                            "isLocked": False,
                        },
                        "reported": {
                            "battery": 100,
                            "wifiSignal": 0,
                            "apps": {},
                            "isLocked": False,
                        },
                    }
                }
            ),
        )

        # Get IoT endpoint
        endpoint = iot.describe_endpoint(endpointType="iot:Data-ATS")
        iot_endpoint = endpoint["endpointAddress"]

        # Update Convex scanner record with IoT info
        if scanner_id:
            try:
                creds = get_convex_credentials()
                call_convex_mutation(
                    creds["convex_deploy_key"],
                    "scannerMdm:provisionScanner",
                    {
                        "scannerId": scanner_id,
                        "iotThingName": thing_name,
                        "iotThingArn": thing_arn,
                        "iotCertificateArn": cert_arn,
                    },
                )
            except Exception as e:
                print(f"Warning: Failed to update Convex: {e}")

        return response(
            200,
            {
                "thingName": thing_name,
                "thingArn": thing_arn,
                "certificateArn": cert_arn,
                "certificatePem": cert_pem,
                "privateKey": private_key,
                "publicKey": public_key,
                "iotEndpoint": iot_endpoint,
                "retiredCerts": retired_certs,
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
