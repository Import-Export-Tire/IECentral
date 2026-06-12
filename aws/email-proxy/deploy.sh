#!/usr/bin/env bash
# Provision (idempotently) a tiny EC2 + Elastic IP running an authenticated SOCKS5
# proxy, so IECentral's email sync (imapflow) has ONE fixed egress IP that
# self-hosted mail servers (svm.ietires.com) can allowlist on their firewall/fail2ban.
#
#   ./deploy.sh                # provision + print EMAIL_PROXY_URL
#
# Requires AWS creds in the environment (e.g. `aws configure export-credentials
# --profile ietires --format env`). Region us-east-1.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
NAME="iecentral-email-proxy"
PORT="${PROXY_PORT:-33080}"          # non-standard high port
INSTANCE_TYPE="t4g.nano"             # ~$3/mo arm64
PROXY_USER="${PROXY_USER:-iecentral}"

cd "$(dirname "$0")"

echo "== Resolve latest Amazon Linux 2023 arm64 AMI =="
AMI=$(aws ssm get-parameter --region "$REGION" \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --query 'Parameter.Value' --output text)
echo "   AMI: $AMI"

# Reuse an existing instance if one is already tagged with our Name.
EXISTING=$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=running,pending,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "$EXISTING" ]; then
  echo "!! An instance already exists ($EXISTING). Re-run with care; this script provisions fresh."
  echo "   Existing Elastic IP:"
  aws ec2 describe-addresses --region "$REGION" --filters "Name=tag:Name,Values=$NAME" \
    --query 'Addresses[].PublicIp' --output text
  exit 0
fi

# Generate the proxy password (printed once; goes into EMAIL_PROXY_URL).
PROXY_PASS=$(openssl rand -hex 20)

echo "== Security group (inbound proxy port only; SSM for mgmt, no SSH) =="
VPC=$(aws ec2 describe-vpcs --region "$REGION" --filters "Name=isDefault,Values=true" \
  --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 create-security-group --region "$REGION" --group-name "$NAME-sg" \
  --description "IECentral email SOCKS proxy" --vpc-id "$VPC" --query 'GroupId' --output text 2>/dev/null \
  || aws ec2 describe-security-groups --region "$REGION" --filters "Name=group-name,Values=$NAME-sg" --query 'SecurityGroups[0].GroupId' --output text)
# Convex egress IPs are dynamic, so the port must be open to the internet — the
# SOCKS5 password + a non-standard port are the gate (see README for hardening).
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG" \
  --protocol tcp --port "$PORT" --cidr 0.0.0.0/0 >/dev/null 2>&1 || true

echo "== IAM role + instance profile (SSM Session Manager, no SSH keys) =="
aws iam create-role --role-name "$NAME-role" \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null 2>&1 || true
aws iam attach-role-policy --role-name "$NAME-role" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null 2>&1 || true
aws iam create-instance-profile --instance-profile-name "$NAME-profile" >/dev/null 2>&1 || true
aws iam add-role-to-instance-profile --instance-profile-name "$NAME-profile" --role-name "$NAME-role" >/dev/null 2>&1 || true
sleep 10  # let the instance profile propagate

echo "== Render user-data (Docker + authenticated SOCKS5) =="
UD=$(cat <<EOF
#!/bin/bash
set -e
dnf install -y docker
systemctl enable --now docker
# Authenticated SOCKS5 — requires user/pass; tunnels TLS IMAP only.
docker run -d --name socks --restart always -p ${PORT}:1080 \
  -e PROXY_USER='${PROXY_USER}' -e PROXY_PASSWORD='${PROXY_PASS}' \
  serjs/go-socks5-proxy
EOF
)

echo "== Launch t4g.nano =="
IID=$(aws ec2 run-instances --region "$REGION" --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
  --security-group-ids "$SG" --iam-instance-profile "Name=$NAME-profile" \
  --user-data "$UD" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=IECentralEmail}]" \
  --query 'Instances[0].InstanceId' --output text)
echo "   instance: $IID — waiting for running..."
aws ec2 wait instance-running --region "$REGION" --instance-ids "$IID"

echo "== Allocate + associate Elastic IP =="
ALLOC=$(aws ec2 allocate-address --region "$REGION" --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" \
  --query 'AllocationId' --output text)
aws ec2 associate-address --region "$REGION" --instance-id "$IID" --allocation-id "$ALLOC" >/dev/null
EIP=$(aws ec2 describe-addresses --region "$REGION" --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)

echo
echo "================ DONE ================"
echo "Elastic IP (whitelist THIS on svm.ietires.com): $EIP"
echo "Proxy port: $PORT"
echo
echo "Set in Convex + Vercel as EMAIL_PROXY_URL:"
echo "  socks5://${PROXY_USER}:${PROXY_PASS}@${EIP}:${PORT}"
echo
echo "Give the box ~60-90s to pull the image + start, then test from anywhere:"
echo "  curl -s --socks5 ${PROXY_USER}:${PROXY_PASS}@${EIP}:${PORT} https://api.ipify.org ; echo"
echo "  (should print ${EIP})"
