#!/usr/bin/env bash
# Finishes the "Fix Scanning" (datawedge_config) rollout.
#
# STEP A — deploy 3 Lambdas. This is what makes the button stop failing with
#          "Invalid command: datawedge_config". Aborts by itself if any deployed file
#          differs from git (the dunlop-oeival lesson: never blind-deploy over drift).
# STEP B — upload agent 1.7.3 to S3. Needed only to PUSH the new agent to a scanner.
#          Expected to fail with AccessDenied under the `ietires` profile
#          (ie-pricing-deploy has no s3:PutObject on the bucket) — it is reported, not fatal.
#
# Nothing here queues a command, and no other scanner is touched: all three location APK
# pins stay at scanner-agent-1.7.0.apk.
#
# Run:  bash deploy-datawedge.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE="${AWS_PROFILE:-ietires}"
BUCKET="ietires-scanner-assets"
APK="$REPO/android/scanner-agent/app/build/outputs/apk/debug/app-debug.apk"
VERSION="1.7.4"
EXPECTED_SHA="" # set per build; the script prints the actual sha256
FUNCS="scanner-command scanner-job scanner-status"

WORK=$(mktemp -d)
echo "scratch: $WORK"

echo
echo "=============== STEP A — Lambdas ==============="
echo "-- A1. Download deployed packages and diff against git (HEAD~1 = pre-change)"
DRIFT=0
for FN in $FUNCS; do
  URL=$(AWS_PROFILE="$PROFILE" aws lambda get-function --function-name "$FN" \
        --query 'Code.Location' --output text 2>&1)
  case "$URL" in
    http*) ;;
    *) echo "   $FN: could not fetch code — $URL"; DRIFT=1; continue ;;
  esac
  curl -s -o "$WORK/$FN.zip" "$URL"
  mkdir -p "$WORK/$FN" && unzip -qo "$WORK/$FN.zip" -d "$WORK/$FN"
  echo "   $FN: $(ls "$WORK/$FN" | tr '\n' ' ')"
  for f in command.py job.py status.py; do
    [ -f "$WORK/$FN/$f" ] || continue
    if git -C "$REPO" show "HEAD~1:aws/scanner-mdm/lambdas/$f" 2>/dev/null | diff -q - "$WORK/$FN/$f" >/dev/null; then
      echo "      $f: matches git"
    else
      echo "      $f: *** DIFFERS FROM GIT — do not blind-deploy ***"
      git -C "$REPO" show "HEAD~1:aws/scanner-mdm/lambdas/$f" 2>/dev/null | diff - "$WORK/$FN/$f" | head -40
      DRIFT=1
    fi
  done
done

if [ "$DRIFT" != "0" ]; then
  echo
  echo "STOPPED: deployed code does not match git (or could not be read). Nothing was deployed."
  echo "Inspect the downloaded packages in $WORK, reconcile, then re-run."
  exit 1
fi

echo "-- A2. All deployed files match git. Deploying."
# template.yaml uses `CodeUri: lambdas/`, so each function packages the WHOLE directory.
ZIP="$WORK/lambdas.zip"
( cd "$REPO/aws/scanner-mdm/lambdas" && zip -qr "$ZIP" . -x '*.pyc' -x '__pycache__/*' )
for FN in $FUNCS; do
  AWS_PROFILE="$PROFILE" aws lambda update-function-code \
    --function-name "$FN" --zip-file "fileb://$ZIP" \
    --query '[FunctionName,LastModified,CodeSize]' --output text
done

echo "-- A3. Confirm datawedge_config is live in the deployed code"
for FN in scanner-command scanner-job; do
  AWS_PROFILE="$PROFILE" aws lambda invoke --function-name "$FN" \
    --payload '{"body":"{\"thingName\":\"scanner-W08-903\",\"command\":\"__probe__\"}"}' \
    --cli-binary-format raw-in-base64-out "$WORK/$FN.probe" >/dev/null 2>&1
  # A rejected __probe__ proves the whitelist is being read; the real check is that
  # datawedge_config is no longer in the rejected set.
  echo "   $FN probe: $(head -c 200 "$WORK/$FN.probe" 2>/dev/null)"
done

echo
echo "=============== STEP B — agent 1.7.3 to S3 ==============="
if [ ! -f "$APK" ]; then
  echo "APK missing. Rebuild with:"
  echo "  cd $REPO/android/scanner-agent && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=~/Library/Android/sdk ./gradlew :app:assembleDebug"
else
  SHA=$(shasum -a 256 "$APK" | cut -d' ' -f1)
  echo "sha256 = $SHA"
  if [ -n "$EXPECTED_SHA" ] && [ "$SHA" != "$EXPECTED_SHA" ]; then
    echo "NOTE: differs from the pinned build ($EXPECTED_SHA) — a rebuild is fine, just be aware."
  fi
  if AWS_PROFILE="$PROFILE" aws s3api put-object \
       --bucket "$BUCKET" --key "apks/scanner-agent-$VERSION.apk" --body "$APK" \
       --metadata "version=$VERSION,sha256=$SHA" \
       --content-type application/vnd.android.package-archive >/dev/null 2>"$WORK/s3.err"; then
    AWS_PROFILE="$PROFILE" aws s3api head-object --bucket "$BUCKET" \
      --key "apks/scanner-agent-$VERSION.apk" --query "{size:ContentLength,meta:Metadata}"
    echo "Uploaded. Location pins stay at 1.7.0, so no other scanner or future setup changes."
  else
    echo "S3 upload FAILED (expected under this profile):"
    sed 's/^/   /' "$WORK/s3.err"
    echo "   Needs an identity with s3:PutObject on $BUCKET (console upload works too:"
    echo "   key apks/scanner-agent-$VERSION.apk, metadata version=$VERSION sha256=$SHA)."
  fi
fi

echo
echo "=============== Next ==============="
echo "After STEP A: 'Fix Scanning' works on any scanner already running agent 1.7.3."
echo "W08-903 is on 1.7.0, so it needs STEP B first, then: Push Update -> Fix Scanning."
echo "Both are durable jobs — they wait for the scanner to come online."
