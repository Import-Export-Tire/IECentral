#!/usr/bin/env bash
# Deploy / update the office-to-pdf Lambda (LibreOffice converter) + its Function URL.
# Idempotent: safe to re-run. Requires AWS creds in the environment and CONVERT_SECRET.
#
#   CONVERT_SECRET=<the PREVIEW_PDF_SECRET value> ./deploy.sh
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
FN="office-to-pdf"
ROLE_NAME="office-to-pdf-role"
RUNTIME="nodejs20.x"
# Public LibreOffice layer (brotli-compressed; handler unpacks /opt/lo.tar.br).
LAYER_ARN="${LIBREOFFICE_LAYER_ARN:-arn:aws:lambda:us-east-1:764866452798:layer:libreoffice-brotli:1}"
MEM=2048
TIMEOUT=60
EPHEMERAL=2048

: "${CONVERT_SECRET:?Set CONVERT_SECRET (must equal IECentral PREVIEW_PDF_SECRET)}"

cd "$(dirname "$0")"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}"

echo "== Verify the LibreOffice layer is reachable from this account =="
aws lambda get-layer-version-by-arn --arn "$LAYER_ARN" --region "$REGION" \
  --query 'LayerArn' --output text >/dev/null \
  || { echo "!! Layer $LAYER_ARN not accessible — see deploy.sh notes for the container fallback"; exit 1; }

echo "== Ensure IAM role =="
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "   created $ROLE_NAME; waiting for propagation..."; sleep 12
fi

echo "== Package handler =="
rm -f function.zip
zip -q function.zip index.js

echo "== Create or update function =="
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --zip-file fileb://function.zip --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FN" --region "$REGION" \
    --runtime "$RUNTIME" --handler index.handler --memory-size "$MEM" --timeout "$TIMEOUT" \
    --ephemeral-storage "Size=$EPHEMERAL" --layers "$LAYER_ARN" \
    --environment "Variables={CONVERT_SECRET=$CONVERT_SECRET}" >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
else
  aws lambda create-function --function-name "$FN" --region "$REGION" \
    --runtime "$RUNTIME" --handler index.handler --role "$ROLE_ARN" \
    --zip-file fileb://function.zip --memory-size "$MEM" --timeout "$TIMEOUT" \
    --ephemeral-storage "Size=$EPHEMERAL" --layers "$LAYER_ARN" \
    --environment "Variables={CONVERT_SECRET=$CONVERT_SECRET}" >/dev/null
  aws lambda wait function-active --function-name "$FN" --region "$REGION"
fi

echo "== Ensure Function URL (no-auth; protected by the shared secret) =="
if ! aws lambda get-function-url-config --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name "$FN" --auth-type NONE --region "$REGION" >/dev/null
  aws lambda add-permission --function-name "$FN" --region "$REGION" \
    --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
fi
URL=$(aws lambda get-function-url-config --function-name "$FN" --region "$REGION" --query FunctionUrl --output text)
rm -f function.zip

echo
echo "DONE. Function URL:"
echo "  $URL"
echo
echo "Set this in Vercel (all envs) as OFFICE_PDF_LAMBDA_URL, then redeploy:"
echo "  printf '%s' \"$URL\" | npx vercel env add OFFICE_PDF_LAMBDA_URL production"
