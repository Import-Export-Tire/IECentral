# Scanner Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fully web-based scanner provisioning wizard on the IECentral Scanner Manager page that uses WebUSB + `@yume-chan/adb` to perform the full ADB orchestration in the browser — replacing today's local Bash script and partial Node CLI.

**Architecture:** Single feature branch (`feat/scanner-setup-wizard`). Three layers: (1) Convex backend gets a tiny set of new mutations/queries + a logs table; (2) AWS Lambda gets a small extension to return APK SHA-256s + the S3 bucket gets a CORS update; (3) Next.js frontend gets a new 8-step wizard modal under `app/equipment/scanners/setup/` that orchestrates everything in the browser. Lazy-loaded ya-webadb keeps bundle impact at ~150kB only when the wizard is opened.

**Tech Stack:** Next.js 15 App Router (existing), React 19 (existing), Convex 1.31 (existing), Tailwind v4 (existing), `@yume-chan/adb` (new — WebUSB ADB protocol), `@yume-chan/adb-credential-web` (new — RSA key storage in IndexedDB), `@yume-chan/adb-daemon-webusb` (new — WebUSB transport), `@yume-chan/stream-extra` (new — peer dep).

**Spec:** `docs/superpowers/specs/2026-05-29-scanner-setup-wizard-design.md`

**Pre-existing repo state (verified at plan time):**
- Branch: `main`
- Uncommitted noise that must stay uncommitted: `android/scanner-agent/.gradle/*` (gradle build artifacts; long-standing repo issue, not part of any feature). Implementers must NOT stage these.
- No test framework configured. Verification: `npx tsc --noEmit`, `npx convex dev --once`, browser smoke tests with explicit pass criteria.
- Convex schema: `scanners` at line 840, `scannerMdmConfigs` at 985, `scannerProvisionCodes` at 1030.
- Existing reusable APIs: `scannerMdm.createScannerFromSetup`, `scannerMdm.getProvisionCode`, `scannerMdm.getMdmConfigByCode`, `scannerMdm.getNextScannerNumber`, HTTP `/claim-provision`.
- IECentral uses `useTheme()` for dark/light support — the wizard should use it for theme parity.

---

## File Structure

### Created (new files)

- `app/equipment/scanners/setup/SetupWizard.tsx` — modal shell + step routing
- `app/equipment/scanners/setup/useSetupSession.ts` — React hook owning wizard state machine
- `app/equipment/scanners/setup/WebAdbClient.ts` — wraps ya-webadb with project-specific ops
- `app/equipment/scanners/setup/apkManifest.ts` — APK manifest fetch + SHA verification
- `app/equipment/scanners/setup/steps/DeviceDetectStep.tsx`
- `app/equipment/scanners/setup/steps/LocationStep.tsx`
- `app/equipment/scanners/setup/steps/IdentityStep.tsx`
- `app/equipment/scanners/setup/steps/GenerateStep.tsx`
- `app/equipment/scanners/setup/steps/InstallStep.tsx`
- `app/equipment/scanners/setup/steps/VerifyStep.tsx`
- `app/equipment/scanners/setup/steps/DoneStep.tsx`

### Modified

- `app/equipment/scanners/page.tsx` — add "Setup New Scanner" button + browser support detection
- `app/equipment/scanners/[id]/page.tsx` — add "Setup History" section that queries `scannerSetupLogs`
- `convex/schema.ts` — add `scannerSetupLogs` table (near line 1030, next to `scannerProvisionCodes`)
- `convex/scannerMdm.ts` — add `getApkDownloadUrls` query, `markScannerSetupComplete` mutation, `logScannerSetupStep` mutation, `listSetupLogsByScanner` query
- `aws/scanner-mdm/lambdas/fetch_apk.py` — return SHA-256 in the response
- `aws/scanner-mdm/template.yaml` — no changes expected (S3 + Lambda already exist)
- `package.json` + `package-lock.json` — new yume-chan deps

### Untouched

- `tools/scanner-setup/` — Node CLI stays in repo, gets a deprecation note in its README (added in Task 22)
- `android/scanner-agent/` — Scanner Agent source unchanged (future enhancement to accept code via Intent extra is out of scope)
- `convex/` (other files) — only `schema.ts` and `scannerMdm.ts` change

### Why this split

- Each step is one file in `steps/` — focused responsibility, easy to read in isolation
- `WebAdbClient` is pure logic with no React → easier to reason about and test by hand
- `useSetupSession` owns state machine; step components are presentational
- Convex changes stay in one file (`scannerMdm.ts`) for cohesion with existing scanner code

---

## Task 1: Pre-flight — branch + verify clean

**Files:** None modified yet.

- [ ] **Step 1: Confirm starting state**

```bash
cd /Users/andybarrows/IECentral
git rev-parse --abbrev-ref HEAD
git status --short
```
Expected: on `main`, with the long-standing `android/scanner-agent/.gradle/*` modifications visible. These stay untouched.

- [ ] **Step 2: Create the feature branch**

```bash
cd /Users/andybarrows/IECentral
git checkout -b feat/scanner-setup-wizard
```
Expected: `Switched to a new branch 'feat/scanner-setup-wizard'`.

- [ ] **Step 3: Verify no commits will accidentally include gradle noise**

```bash
# Confirm the gradle dirt is still in the working tree but won't auto-stage:
git status --short android/scanner-agent/
# Should show modified .gradle/* files only — never stage these in this branch's commits.
```

**No commit for this task** — branch is empty by design.

---

## Task 2: Install ya-webadb dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the four yume-chan packages**

```bash
cd /Users/andybarrows/IECentral
npm install @yume-chan/adb @yume-chan/adb-credential-web @yume-chan/adb-daemon-webusb @yume-chan/stream-extra
```

These add ~150 kB minified+gzipped to the bundle but ONLY load when imported, and the wizard imports them via dynamic `import()` so they don't affect initial page load.

- [ ] **Step 2: Verify install succeeded**

```bash
grep -E '"@yume-chan/(adb|adb-credential-web|adb-daemon-webusb|stream-extra)"' package.json
```
Expected: all four lines present with version strings.

- [ ] **Step 3: TypeScript check (existing code shouldn't break)**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | head -20
```
Expected: same baseline (any pre-existing errors are noise; no NEW errors introduced).

- [ ] **Step 4: Commit**

```bash
cd /Users/andybarrows/IECentral
git status --short
# Confirm only package.json + package-lock.json staged.
# If gradle files show up, do NOT add them.
git add package.json package-lock.json
git commit -m "chore(deps): add ya-webadb packages for browser-side ADB"
```

---

## Task 3: Add scannerSetupLogs schema

**Files:**
- Modify: `convex/schema.ts` (insert after `scannerProvisionCodes` table at line ~1030)

- [ ] **Step 1: Confirm placement**

```bash
sed -n '1025,1050p' /Users/andybarrows/IECentral/convex/schema.ts
```
Expected: see end of `scannerProvisionCodes` table.

- [ ] **Step 2: Insert `scannerSetupLogs` table** immediately after the `scannerProvisionCodes` definition (after its closing `})` + `.index(...)` chain):

```ts
  scannerSetupLogs: defineTable({
    scannerId: v.id("scanners"),
    step: v.string(), // "detect" | "location" | "generate" | "installRtl" | "installTireTrack" | "installAgent" | "pushRtConfig" | "grantPerms" | "settings" | "deviceAdmin" | "bloatware" | "launchSetupActivity" | "verify" | "done"
    status: v.string(), // "started" | "success" | "skipped" | "failed"
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    browserAgent: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_scanner", ["scannerId"])
    .index("by_scanner_created", ["scannerId", "createdAt"]),
```

- [ ] **Step 3: Deploy + verify**

```bash
cd /Users/andybarrows/IECentral
npx convex dev --once
```
Expected: "Convex functions ready!" with no schema errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/andybarrows/IECentral
git add convex/schema.ts
git status --short
# Confirm only convex/schema.ts staged. Do NOT add gradle noise.
git commit -m "feat(scanner-setup): add scannerSetupLogs table"
```

---

## Task 4: Add logScannerSetupStep mutation

**Files:**
- Modify: `convex/scannerMdm.ts` (append at end of file)

- [ ] **Step 1: Append the mutation** to `/Users/andybarrows/IECentral/convex/scannerMdm.ts`:

```ts
// ============ SETUP LOGS ============

export const logScannerSetupStep = mutation({
  args: {
    scannerId: v.id("scanners"),
    step: v.string(),
    status: v.string(),
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    browserAgent: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("scannerSetupLogs", {
      ...args,
      createdAt: Date.now(),
    });
    return { success: true };
  },
});

export const listSetupLogsByScanner = query({
  args: { scannerId: v.id("scanners"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scannerSetupLogs")
      .withIndex("by_scanner_created", (q) => q.eq("scannerId", args.scannerId))
      .order("desc")
      .take(args.limit ?? 100);
  },
});
```

If `mutation`, `query`, and `v` aren't already imported at the top of the file, they are — `scannerMdm.ts` already uses them extensively.

- [ ] **Step 2: Deploy**

```bash
cd /Users/andybarrows/IECentral
npx convex dev --once
```
Expected: clean.

- [ ] **Step 3: Smoke-test via CLI** (need a real scanner _id from dev)

```bash
cd /Users/andybarrows/IECentral
# Find any existing scanner _id for testing:
npx convex run --prod=false scannerMdm:getScannerFleetOverview '{}' 2>/dev/null | grep -oE '"_id":"[^"]*"' | head -1
# Take that ID, then:
SCANNER_ID="<paste-id-here>"
npx convex run --prod=false scannerMdm:logScannerSetupStep "{\"scannerId\":\"${SCANNER_ID}\",\"step\":\"smoke-test\",\"status\":\"success\",\"durationMs\":42}"
# Expected: { success: true }
npx convex run --prod=false scannerMdm:listSetupLogsByScanner "{\"scannerId\":\"${SCANNER_ID}\"}" 2>&1 | head -10
# Expected: array with one entry containing step="smoke-test"
```

If you can't find a real scanner _id without expensive exploration, skip the live smoke test — TypeScript will still catch shape errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/andybarrows/IECentral
git add convex/scannerMdm.ts
git commit -m "feat(scanner-setup): logScannerSetupStep mutation + listSetupLogsByScanner query"
```

---

## Task 5: Add markScannerSetupComplete mutation

**Files:**
- Modify: `convex/scannerMdm.ts` (append after Task 4's additions)

- [ ] **Step 1: Append** the mutation:

```ts
export const markScannerSetupComplete = mutation({
  args: {
    scannerId: v.id("scanners"),
    installedApps: v.object({
      tireTrack: v.optional(v.string()),
      rtLocator: v.optional(v.string()),
      scannerAgent: v.optional(v.string()),
    }),
    actingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const scanner = await ctx.db.get(args.scannerId);
    if (!scanner) throw new Error("Scanner not found");

    await ctx.db.patch(args.scannerId, {
      installedApps: args.installedApps,
      mdmStatus: "provisioned",
      provisionedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
```

- [ ] **Step 2: Deploy + smoke-test**

```bash
cd /Users/andybarrows/IECentral
npx convex dev --once
# Smoke-test only if you have a test scanner — otherwise rely on type checks
```

- [ ] **Step 3: Commit**

```bash
cd /Users/andybarrows/IECentral
git add convex/scannerMdm.ts
git commit -m "feat(scanner-setup): markScannerSetupComplete mutation"
```

---

## Task 6: Extend AWS Lambda to return SHA-256

**Files:**
- Modify: `aws/scanner-mdm/lambdas/fetch_apk.py`

- [ ] **Step 1: Read the existing handler**

```bash
sed -n '40,70p' /Users/andybarrows/IECentral/aws/scanner-mdm/lambdas/fetch_apk.py
```

- [ ] **Step 2: Add an `sha256` field to every S3 response** — for each of the three `app == "tiretrack"|"rtlocator"|"agent"` branches that already build a response dict, look up the object's metadata and include it. Replace the `get_latest_s3_apk` helper with a version that returns both the key AND the metadata, and update the response payloads.

Replace `get_latest_s3_apk` (around line 41–55):

```python
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
```

Then in the three handler branches, change calls from:

```python
s3_key = get_latest_s3_apk("tiretrack")
```

to:

```python
s3_key, s3_sha256 = get_latest_s3_apk("tiretrack")
```

And in every response that returns `downloadUrl`, also include the sha256:

```python
return response(200, {
    "downloadUrl": download_url,
    "version": version,
    "source": "s3",
    "s3Key": s3_key,
    "sha256": s3_sha256,  # NEW — may be None if metadata not set
})
```

Apply the same change to all three branches (tiretrack S3-fallback, rtlocator, agent). The hard-coded MDM-config-key branches (`config.get("tireTrackApkS3Key")`) also need a HEAD lookup to fetch sha256 — wrap the HEAD logic in a small helper:

```python
def get_sha256_for_key(key):
    if not key:
        return None
    try:
        head = s3.head_object(Bucket=S3_BUCKET, Key=key)
        return head.get("Metadata", {}).get("sha256")
    except Exception:
        return None
```

And call it where needed.

- [ ] **Step 3: Deploy the Lambda**

```bash
cd /Users/andybarrows/IECentral/aws/scanner-mdm
sam build && sam deploy --no-confirm-changeset 2>&1 | tail -20
```

Expected: "Successfully created/updated stack" or similar. If SAM build fails on Python deps, install them: `pip install -r lambdas/requirements.txt` (if a requirements file exists; if not, the Lambda runtime should have boto3 built-in).

- [ ] **Step 4: Smoke-test the API Gateway**

```bash
curl -s "https://7brylwlei6.execute-api.us-east-1.amazonaws.com/prod/scanner-mdm/apk?app=agent" | python3 -m json.tool
```
Expected: response now includes `"sha256": "<hash-or-null>"`. The hash will be `null` for now because existing APKs in S3 don't have the metadata set (next task handles that).

- [ ] **Step 5: Commit**

```bash
cd /Users/andybarrows/IECentral
git add aws/scanner-mdm/lambdas/fetch_apk.py
git commit -m "feat(scanner-setup): return SHA-256 with APK download URLs"
```

---

## Task 7: Backfill SHA-256 metadata for existing S3 APKs

**Files:** No code changes — AWS S3 metadata update.

- [ ] **Step 1: List current APKs and compute SHAs**

```bash
aws s3 ls s3://ietires-scanner-assets/apks/ 2>&1 | awk '{print $4}' | grep '\.apk$'
```

For each APK listed, compute and attach SHA-256 metadata via `aws s3 cp` to itself with `--metadata-directive REPLACE`:

- [ ] **Step 2: Write a one-shot backfill script** at `/tmp/backfill-sha.sh`:

```bash
#!/bin/bash
set -e
BUCKET="ietires-scanner-assets"
PREFIX="apks/"
TMPDIR=$(mktemp -d)

for KEY in $(aws s3 ls "s3://${BUCKET}/${PREFIX}" | awk '{print $4}' | grep '\.apk$'); do
  echo "=== ${KEY} ==="
  aws s3 cp "s3://${BUCKET}/${PREFIX}${KEY}" "${TMPDIR}/${KEY}"
  SHA=$(shasum -a 256 "${TMPDIR}/${KEY}" | awk '{print $1}')
  echo "SHA: ${SHA}"
  # Copy in place with metadata replaced (preserves content)
  aws s3 cp "s3://${BUCKET}/${PREFIX}${KEY}" "s3://${BUCKET}/${PREFIX}${KEY}" \
    --metadata "sha256=${SHA}" \
    --metadata-directive REPLACE
done

rm -rf "${TMPDIR}"
echo "✓ Backfill complete"
```

```bash
chmod +x /tmp/backfill-sha.sh
/tmp/backfill-sha.sh
```

**This requires `s3:PutObject` permission** which the default `ie-pricing-deploy` IAM user does NOT have (verified earlier in the session). If permission is denied, two options:
- Grant `s3:PutObject` on `arn:aws:s3:::ietires-scanner-assets/apks/*` to the IAM user (temporary policy)
- Run the script with an admin AWS profile

Surface this to your human partner if the backfill fails on `AccessDenied` — they'll need to grant the permission via the AWS Console.

- [ ] **Step 3: Verify by re-hitting the API**

```bash
curl -s "https://7brylwlei6.execute-api.us-east-1.amazonaws.com/prod/scanner-mdm/apk?app=agent" | python3 -m json.tool
```
Expected: `"sha256": "<actual-hex-string>"` (no longer null).

- [ ] **Step 4: No commit** — this is an AWS data operation.

---

## Task 8: Configure S3 CORS

**Files:** No code changes — AWS S3 bucket configuration.

- [ ] **Step 1: Write the CORS policy** to `/tmp/s3-cors.json`:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "https://iecentral.ietires.com",
        "https://iecentral.vercel.app",
        "https://*.vercel.app",
        "http://localhost:3000"
      ],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "x-amz-meta-sha256"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

- [ ] **Step 2: Apply via AWS CLI** (requires `s3:PutBucketCORS`):

```bash
aws s3api put-bucket-cors --bucket ietires-scanner-assets --cors-configuration file:///tmp/s3-cors.json
```

If `AccessDenied`, do it via AWS Console instead:
- Open https://s3.console.aws.amazon.com/s3/buckets/ietires-scanner-assets?tab=permissions
- Scroll to "Cross-origin resource sharing (CORS)" → Edit
- Paste the JSON from `/tmp/s3-cors.json`
- Save

- [ ] **Step 3: Verify**

```bash
aws s3api get-bucket-cors --bucket ietires-scanner-assets
```
Expected: the CORS rules echoed back.

- [ ] **Step 4: Browser-side smoke test (optional, after a presigned URL is obtained)**

```bash
# Get a fresh presigned URL:
URL=$(curl -s "https://7brylwlei6.execute-api.us-east-1.amazonaws.com/prod/scanner-mdm/apk?app=agent" | python3 -c "import json,sys; print(json.load(sys.stdin)['downloadUrl'])")
# Verify CORS headers on the presigned URL (HEAD request from any origin):
curl -I -H "Origin: http://localhost:3000" "$URL" 2>&1 | grep -i "access-control"
```
Expected: `Access-Control-Allow-Origin: http://localhost:3000` (or `*`) in response headers.

- [ ] **Step 5: No commit** — AWS config.

---

## Task 9: Add getApkDownloadUrls query

**Files:**
- Modify: `convex/scannerMdm.ts` (append)

- [ ] **Step 1: Append the query**

```ts
// Returns presigned S3 URLs (+ SHAs) for the three APKs the setup wizard needs.
// Internally calls the AWS Lambda 3 times.
export const getApkDownloadUrls = query({
  args: { locationCode: v.string() },
  handler: async (ctx, args) => {
    const baseUrl = "https://7brylwlei6.execute-api.us-east-1.amazonaws.com/prod/scanner-mdm/apk";
    const apps: Array<"tiretrack" | "rtlocator" | "agent"> = ["tiretrack", "rtlocator", "agent"];

    const fetchOne = async (app: string) => {
      const url = `${baseUrl}?app=${app}&locationCode=${encodeURIComponent(args.locationCode)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${app}: ${res.status}`);
      const json = await res.json();
      return {
        url: json.downloadUrl as string,
        sha256: (json.sha256 ?? null) as string | null,
        version: (json.version ?? "unknown") as string,
        s3Key: (json.s3Key ?? null) as string | null,
      };
    };

    const [tireTrack, rtLocator, agent] = await Promise.all([
      fetchOne("tiretrack"),
      fetchOne("rtlocator"),
      fetchOne("agent"),
    ]);

    return { tireTrack, rtLocator, scannerAgent: agent };
  },
});
```

**Note on Convex queries doing fetch():** Convex queries are pure by default. `fetch()` is allowed inside actions, not queries. **This must be an `action`, not a `query`.** Replace `query` with `action` and the import (`action` is exported from `./_generated/server` the same as `query` and `mutation`):

Corrected version:

```ts
import { action } from "./_generated/server";

export const getApkDownloadUrls = action({
  args: { locationCode: v.string() },
  handler: async (_ctx, args) => {
    const baseUrl = "https://7brylwlei6.execute-api.us-east-1.amazonaws.com/prod/scanner-mdm/apk";
    const fetchOne = async (app: string) => {
      const url = `${baseUrl}?app=${app}&locationCode=${encodeURIComponent(args.locationCode)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${app}: ${res.status}`);
      const json = await res.json();
      return {
        url: json.downloadUrl as string,
        sha256: (json.sha256 ?? null) as string | null,
        version: (json.version ?? "unknown") as string,
        s3Key: (json.s3Key ?? null) as string | null,
      };
    };
    const [tireTrack, rtLocator, agent] = await Promise.all([
      fetchOne("tiretrack"),
      fetchOne("rtlocator"),
      fetchOne("agent"),
    ]);
    return { tireTrack, rtLocator, scannerAgent: agent };
  },
});
```

Make sure `action` is in the import list at the top of `scannerMdm.ts`. If the file already imports from `./_generated/server`, add `action` to the existing destructuring; if not, add a new import.

- [ ] **Step 2: Deploy + smoke-test**

```bash
cd /Users/andybarrows/IECentral
npx convex dev --once
# Action invocation via CLI:
npx convex run --prod=false scannerMdm:getApkDownloadUrls '{"locationCode":"W08"}' 2>&1 | head -20
```
Expected: object with three keys (`tireTrack`, `rtLocator`, `scannerAgent`), each containing `{ url, sha256, version, s3Key }`.

- [ ] **Step 3: Commit**

```bash
cd /Users/andybarrows/IECentral
git add convex/scannerMdm.ts
git commit -m "feat(scanner-setup): getApkDownloadUrls action (fetches 3 presigned S3 URLs)"
```

---

## Task 10: Create WebAdbClient wrapper

**Files:**
- Create: `app/equipment/scanners/setup/WebAdbClient.ts`

- [ ] **Step 1: Create the file** with this content:

```ts
// app/equipment/scanners/setup/WebAdbClient.ts
// Wraps @yume-chan/adb with the operations the setup wizard needs.
// No React — pure TypeScript.

import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import { AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";

const ZEBRA_VENDOR_ID = 0x05E0; // Symbol/Zebra Technologies

let credentialStore: AdbWebCredentialStore | null = null;

function getCredentialStore() {
  if (!credentialStore) {
    credentialStore = new AdbWebCredentialStore("IECentral-Scanner-Setup");
  }
  return credentialStore;
}

export type AdbConnection = {
  adb: Adb;
  serial: string;
  model: string;
  androidVersion: string;
  disconnect: () => Promise<void>;
};

export class WebAdbClient {
  private connection: AdbConnection | null = null;

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "usb" in navigator;
  }

  /** Prompt the user to select a Zebra USB device and authenticate. */
  async connect(): Promise<AdbConnection> {
    if (!WebAdbClient.isSupported()) {
      throw new Error("WebUSB not supported in this browser. Use Chrome or Edge.");
    }
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    if (!manager) throw new Error("Could not initialize WebUSB device manager.");

    const device = await manager.requestDevice({
      filters: [{ vendorId: ZEBRA_VENDOR_ID }],
    });
    if (!device) throw new Error("No device selected.");

    const connection = await device.connect();
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: getCredentialStore(),
    });
    const adb = new Adb(transport);

    // Pull device info
    const model = (await this.shellCommand(adb, "getprop ro.product.model")).trim();
    const androidVersion = (await this.shellCommand(adb, "getprop ro.build.version.release")).trim();
    const realSerial = (await this.shellCommand(adb, "getprop ro.serialno")).trim();

    this.connection = {
      adb,
      serial: realSerial || device.serial,
      model,
      androidVersion,
      disconnect: async () => {
        await adb.close();
        this.connection = null;
      },
    };
    return this.connection;
  }

  private async shellCommand(adb: Adb, cmd: string): Promise<string> {
    const process = await adb.subprocess.shell.spawn(cmd);
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    for await (const chunk of process.stdout) {
      chunks.push(decoder.decode(chunk));
    }
    return chunks.join("");
  }

  /** Execute a shell command. Throws if exit code is non-zero. */
  async shell(cmd: string): Promise<string> {
    if (!this.connection) throw new Error("Not connected");
    return this.shellCommand(this.connection.adb, cmd);
  }

  /** Push a string as a file to the device. */
  async pushTextFile(content: string, devicePath: string): Promise<void> {
    if (!this.connection) throw new Error("Not connected");
    const sync = await this.connection.adb.sync();
    try {
      const bytes = new TextEncoder().encode(content);
      // ya-webadb sync.write accepts a ReadableStream<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(bytes); controller.close(); },
      });
      await sync.write({ filename: devicePath, file: stream, type: 0o100644 });
    } finally {
      await sync.dispose();
    }
  }

  /** Install an APK from an in-memory ArrayBuffer. */
  async installApk(apkBuffer: ArrayBuffer, onProgress?: (pct: number) => void): Promise<void> {
    if (!this.connection) throw new Error("Not connected");
    const remotePath = `/data/local/tmp/setup-wizard-${Date.now()}.apk`;
    const sync = await this.connection.adb.sync();
    try {
      const bytes = new Uint8Array(apkBuffer);
      const total = bytes.byteLength;
      let pushed = 0;
      const CHUNK = 256 * 1024;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < bytes.byteLength; i += CHUNK) {
            const slice = bytes.slice(i, Math.min(i + CHUNK, bytes.byteLength));
            controller.enqueue(slice);
            pushed += slice.byteLength;
            onProgress?.(Math.round((pushed / total) * 100));
          }
          controller.close();
        },
      });
      await sync.write({ filename: remotePath, file: stream, type: 0o100644 });
    } finally {
      await sync.dispose();
    }
    // Run pm install
    const result = await this.shell(`pm install -r ${remotePath}`);
    // Clean up
    await this.shell(`rm -f ${remotePath}`);
    if (!/Success/.test(result)) {
      throw new Error(`Install failed: ${result.trim()}`);
    }
  }

  /** Uninstall an app (for signature-mismatch recovery). */
  async uninstall(pkg: string): Promise<void> {
    if (!this.connection) throw new Error("Not connected");
    await this.shell(`pm uninstall ${pkg}`);
  }

  /** Activate a Device Admin component (Scanner Agent). Idempotent. */
  async setActiveAdmin(component: string): Promise<void> {
    const out = await this.shell(`dpm set-active-admin ${component}`);
    if (!/Success/.test(out) && !/already/.test(out)) {
      throw new Error(`Device Admin activation failed: ${out.trim()}`);
    }
  }

  /** Disable a list of packages via pm disable-user. Returns count actually disabled. */
  async disablePackages(packages: string[]): Promise<number> {
    let disabled = 0;
    for (const pkg of packages) {
      try {
        const out = await this.shell(`pm disable-user --user 0 ${pkg}`);
        if (/disabled|new state: disabled/.test(out)) disabled++;
      } catch {
        // Package may not exist on this device — skip silently
      }
    }
    return disabled;
  }

  /** Launch an Android activity by component name. */
  async launchActivity(component: string): Promise<void> {
    await this.shell(`am start -n ${component}`);
  }

  /** Grant a runtime permission. Idempotent. */
  async grantPermission(pkg: string, permission: string): Promise<void> {
    await this.shell(`pm grant ${pkg} ${permission}`);
  }

  /** Get the connected device's USB / Android props. */
  getConnection(): AdbConnection | null {
    return this.connection;
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "WebAdbClient" | head -5
```
Expected: no errors. If yume-chan's API is slightly different (the library evolves), TypeScript will report the exact mismatch — adjust the calls to match the installed version's signatures. The pattern (connect → authenticate → sync/shell/subprocess) is stable across versions.

- [ ] **Step 3: Commit**

```bash
cd /Users/andybarrows/IECentral
git add app/equipment/scanners/setup/WebAdbClient.ts
git commit -m "feat(scanner-setup): WebAdbClient wrapper around ya-webadb"
```

---

## Task 11: Create apkManifest helper

**Files:**
- Create: `app/equipment/scanners/setup/apkManifest.ts`

- [ ] **Step 1: Create the file**:

```ts
// app/equipment/scanners/setup/apkManifest.ts
// Downloads APK buffers from presigned S3 URLs and verifies SHA-256.

export type ApkEntry = {
  url: string;
  sha256: string | null;
  version: string;
  s3Key: string | null;
};

export type ApkManifest = {
  tireTrack: ApkEntry;
  rtLocator: ApkEntry;
  scannerAgent: ApkEntry;
};

const CACHE_DB = "scanner-setup-apk-cache";
const CACHE_STORE = "apks";

async function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(CACHE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCache(key: string): Promise<ArrayBuffer | null> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readonly");
    const req = tx.objectStore(CACHE_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function writeCache(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readwrite");
    tx.objectStore(CACHE_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Download an APK, verify its SHA-256, cache it. Returns the ArrayBuffer. */
export async function fetchApk(
  entry: ApkEntry,
  onProgress?: (pct: number) => void,
): Promise<ArrayBuffer> {
  // Cache hit: s3Key + sha256 fully identifies the artifact.
  const cacheKey = entry.s3Key && entry.sha256 ? `${entry.s3Key}|${entry.sha256}` : null;
  if (cacheKey) {
    const cached = await readCache(cacheKey).catch(() => null);
    if (cached) {
      onProgress?.(100);
      return cached;
    }
  }

  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`APK download failed: ${res.status} ${res.statusText}`);

  // Stream + progress
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (contentLength > 0) onProgress?.(Math.round((received / contentLength) * 100));
  }
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const buffer = merged.buffer;

  // Verify SHA-256 if the manifest provided one
  if (entry.sha256) {
    const actual = await sha256Hex(buffer);
    if (actual !== entry.sha256.toLowerCase()) {
      throw new Error(
        `APK SHA-256 mismatch (expected ${entry.sha256}, got ${actual}). Aborting install.`,
      );
    }
  }

  // Cache for future scanner setups
  if (cacheKey) {
    await writeCache(cacheKey, buffer).catch(() => {
      // IndexedDB quota errors are non-fatal
    });
  }
  return buffer;
}
```

- [ ] **Step 2: TS check**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "apkManifest" | head -3
```
Expected: blank.

- [ ] **Step 3: Commit**

```bash
cd /Users/andybarrows/IECentral
git add app/equipment/scanners/setup/apkManifest.ts
git commit -m "feat(scanner-setup): apkManifest helper with SHA-256 verify + IDB cache"
```

---

## Task 12: Create useSetupSession hook (state machine)

**Files:**
- Create: `app/equipment/scanners/setup/useSetupSession.ts`

- [ ] **Step 1: Create the hook**:

```ts
// app/equipment/scanners/setup/useSetupSession.ts
// React hook that owns the wizard state machine.

import { useReducer, useCallback, useMemo, useRef } from "react";
import { Id } from "@/convex/_generated/dataModel";
import { WebAdbClient, AdbConnection } from "./WebAdbClient";

export type StepName =
  | "detect" | "location" | "identity" | "generate"
  | "install" | "verify" | "done" | "error";

export type SetupState = {
  step: StepName;
  client: WebAdbClient;
  connection: AdbConnection | null;
  locationCode: string | null;
  locationName: string | null;
  scannerNumber: string | null;
  rtDeviceId: string;
  scannerId: Id<"scanners"> | null;
  provisionCode: string | null;
  pin: string | null;
  installProgress: Record<string, { status: "pending" | "in-progress" | "success" | "skipped" | "failed"; message?: string; percent?: number }>;
  installedVersions: { tireTrack?: string; rtLocator?: string; scannerAgent?: string };
  error: string | null;
};

type Action =
  | { type: "RESET" }
  | { type: "SET_CONNECTION"; connection: AdbConnection }
  | { type: "SET_LOCATION"; code: string; name: string }
  | { type: "SET_IDENTITY"; scannerNumber: string; rtDeviceId: string }
  | { type: "SET_GENERATED"; scannerId: Id<"scanners">; provisionCode: string; pin: string }
  | { type: "STEP"; step: StepName }
  | { type: "PROGRESS"; key: string; status: SetupState["installProgress"][string]["status"]; message?: string; percent?: number }
  | { type: "INSTALLED_VERSION"; app: "tireTrack" | "rtLocator" | "scannerAgent"; version: string }
  | { type: "ERROR"; message: string };

function initialState(client: WebAdbClient): SetupState {
  return {
    step: "detect",
    client,
    connection: null,
    locationCode: null,
    locationName: null,
    scannerNumber: null,
    rtDeviceId: "0001",
    scannerId: null,
    provisionCode: null,
    pin: null,
    installProgress: {},
    installedVersions: {},
    error: null,
  };
}

function reducer(state: SetupState, action: Action): SetupState {
  switch (action.type) {
    case "RESET":
      return initialState(state.client);
    case "SET_CONNECTION":
      return { ...state, connection: action.connection };
    case "SET_LOCATION":
      return { ...state, locationCode: action.code, locationName: action.name };
    case "SET_IDENTITY":
      return { ...state, scannerNumber: action.scannerNumber, rtDeviceId: action.rtDeviceId };
    case "SET_GENERATED":
      return { ...state, scannerId: action.scannerId, provisionCode: action.provisionCode, pin: action.pin };
    case "STEP":
      return { ...state, step: action.step };
    case "PROGRESS":
      return {
        ...state,
        installProgress: {
          ...state.installProgress,
          [action.key]: { status: action.status, message: action.message, percent: action.percent },
        },
      };
    case "INSTALLED_VERSION":
      return { ...state, installedVersions: { ...state.installedVersions, [action.app]: action.version } };
    case "ERROR":
      return { ...state, step: "error", error: action.message };
    default:
      return state;
  }
}

export function useSetupSession() {
  const clientRef = useRef<WebAdbClient>(null);
  if (!clientRef.current) clientRef.current = new WebAdbClient();
  const [state, dispatch] = useReducer(reducer, clientRef.current, initialState);

  const actions = useMemo(
    () => ({
      reset: () => dispatch({ type: "RESET" }),
      setConnection: (connection: AdbConnection) => dispatch({ type: "SET_CONNECTION", connection }),
      setLocation: (code: string, name: string) => dispatch({ type: "SET_LOCATION", code, name }),
      setIdentity: (scannerNumber: string, rtDeviceId: string) =>
        dispatch({ type: "SET_IDENTITY", scannerNumber, rtDeviceId }),
      setGenerated: (scannerId: Id<"scanners">, provisionCode: string, pin: string) =>
        dispatch({ type: "SET_GENERATED", scannerId, provisionCode, pin }),
      goToStep: (step: StepName) => dispatch({ type: "STEP", step }),
      reportProgress: (key: string, status: SetupState["installProgress"][string]["status"], message?: string, percent?: number) =>
        dispatch({ type: "PROGRESS", key, status, message, percent }),
      recordInstalledVersion: (app: "tireTrack" | "rtLocator" | "scannerAgent", version: string) =>
        dispatch({ type: "INSTALLED_VERSION", app, version }),
      reportError: (message: string) => dispatch({ type: "ERROR", message }),
    }),
    [],
  );

  return useCallback(
    () => ({ state, actions }),
    [state, actions],
  )();
}
```

- [ ] **Step 2: TS check + commit**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "useSetupSession" | head -3
git add app/equipment/scanners/setup/useSetupSession.ts
git commit -m "feat(scanner-setup): useSetupSession state machine hook"
```

---

## Task 13: Create SetupWizard modal shell

**Files:**
- Create: `app/equipment/scanners/setup/SetupWizard.tsx`

- [ ] **Step 1: Create the modal**:

```tsx
// app/equipment/scanners/setup/SetupWizard.tsx
"use client";

import { useEffect } from "react";
import { useSetupSession } from "./useSetupSession";
import { DeviceDetectStep } from "./steps/DeviceDetectStep";
import { LocationStep } from "./steps/LocationStep";
import { IdentityStep } from "./steps/IdentityStep";
import { GenerateStep } from "./steps/GenerateStep";
import { InstallStep } from "./steps/InstallStep";
import { VerifyStep } from "./steps/VerifyStep";
import { DoneStep } from "./steps/DoneStep";
import { useTheme } from "../../../theme-context";

export function SetupWizard({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const session = useSetupSession();

  // Esc to close (only when not mid-install)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && session.state.step !== "install" && session.state.step !== "verify") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.state.step, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && session.state.step !== "install" && session.state.step !== "verify") onClose();
      }}
    >
      <div
        className={`w-full max-w-2xl mx-4 rounded-2xl shadow-2xl overflow-hidden ${
          isDark ? "bg-slate-900 text-white border border-slate-700" : "bg-white text-black border border-gray-200"
        }`}
      >
        <header className={`px-6 py-4 border-b ${isDark ? "border-slate-800" : "border-gray-200"}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">New Scanner Setup</h2>
            <button
              onClick={onClose}
              disabled={session.state.step === "install" || session.state.step === "verify"}
              className={`text-sm ${isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-black"} disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              ✕
            </button>
          </div>
          <StepBreadcrumb current={session.state.step} isDark={isDark} />
        </header>

        <div className="px-6 py-5">
          {session.state.step === "detect" && <DeviceDetectStep session={session} />}
          {session.state.step === "location" && <LocationStep session={session} />}
          {session.state.step === "identity" && <IdentityStep session={session} />}
          {session.state.step === "generate" && <GenerateStep session={session} />}
          {session.state.step === "install" && <InstallStep session={session} />}
          {session.state.step === "verify" && <VerifyStep session={session} />}
          {session.state.step === "done" && <DoneStep session={session} onClose={onClose} />}
          {session.state.step === "error" && (
            <div className="text-red-500">
              <p className="font-semibold mb-2">Setup failed</p>
              <p className="text-sm">{session.state.error}</p>
              <button
                onClick={() => session.actions.reset()}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
              >
                Start over
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const STEP_ORDER: Array<{ key: string; label: string }> = [
  { key: "detect", label: "Detect" },
  { key: "location", label: "Location" },
  { key: "identity", label: "Identity" },
  { key: "generate", label: "Generate" },
  { key: "install", label: "Install" },
  { key: "verify", label: "Verify" },
  { key: "done", label: "Done" },
];

function StepBreadcrumb({ current, isDark }: { current: string; isDark: boolean }) {
  const currentIndex = STEP_ORDER.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-1 mt-3 text-xs">
      {STEP_ORDER.map((s, i) => (
        <li
          key={s.key}
          className={`px-2 py-0.5 rounded-md ${
            i === currentIndex
              ? isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-700"
              : i < currentIndex
              ? isDark ? "text-slate-500" : "text-gray-400"
              : isDark ? "text-slate-600" : "text-gray-300"
          }`}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 2: TS check (expect missing-step-component errors — those are next tasks)**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "SetupWizard" | head -10
```
Expected: errors about missing imports for each `./steps/*` file. Note this in your DONE_WITH_CONCERNS — Tasks 14–20 will resolve them.

- [ ] **Step 3: Commit**

```bash
cd /Users/andybarrows/IECentral
git add app/equipment/scanners/setup/SetupWizard.tsx
git commit -m "feat(scanner-setup): SetupWizard modal shell"
```

---

## Task 14: Create DeviceDetectStep

**Files:**
- Create: `app/equipment/scanners/setup/steps/DeviceDetectStep.tsx`

- [ ] **Step 1: Create the step**:

```tsx
"use client";

import { useState } from "react";
import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

export function DeviceDetectStep({ session }: { session: Session }) {
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setErr(null);
    try {
      const conn = await session.state.client.connect();
      session.actions.setConnection(conn);
      session.actions.goToStep("location");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold mb-1">Plug in the scanner</h3>
        <ol className="text-sm space-y-1 list-decimal list-inside opacity-80">
          <li>Connect the TC51 to this computer via USB.</li>
          <li>On the scanner: enable USB debugging (Developer Options).</li>
          <li>When prompted on the scanner, tap <strong>Allow</strong>.</li>
        </ol>
      </div>

      {err && <p className="text-red-500 text-sm">{err}</p>}

      <button
        onClick={handleConnect}
        disabled={connecting}
        className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm"
      >
        {connecting ? "Connecting…" : "Detect scanner"}
      </button>

      {session.state.connection && (
        <div className="mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm">
          <div className="font-medium">✓ Connected</div>
          <div className="opacity-80">Serial: {session.state.connection.serial}</div>
          <div className="opacity-80">Model: {session.state.connection.model}</div>
          <div className="opacity-80">Android: {session.state.connection.androidVersion}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TS check + commit**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "DeviceDetectStep" | head -3
git add app/equipment/scanners/setup/steps/DeviceDetectStep.tsx
git commit -m "feat(scanner-setup): DeviceDetectStep (WebUSB connect)"
```

---

## Task 15: Create LocationStep

**Files:**
- Create: `app/equipment/scanners/setup/steps/LocationStep.tsx`

- [ ] **Step 1: Create**:

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

export function LocationStep({ session }: { session: Session }) {
  const configs = useQuery(api.scannerMdm.listMdmConfigs);

  const handlePick = (code: string, name: string) => {
    session.actions.setLocation(code, name);
    session.actions.goToStep("identity");
  };

  if (!configs) return <p className="text-sm opacity-70">Loading locations…</p>;

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Where is this scanner going?</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {configs.map((c) => (
          <button
            key={c._id}
            onClick={() => handlePick(c.locationCode, c.locationName ?? c.locationCode)}
            className="px-4 py-3 rounded-lg border border-current/20 hover:bg-blue-500/10 hover:border-blue-500 transition-colors text-left"
          >
            <div className="font-semibold">{c.locationName ?? c.locationCode}</div>
            <div className="text-xs opacity-70 mt-0.5">{c.locationCode}</div>
          </button>
        ))}
      </div>
      <button
        onClick={() => session.actions.goToStep("detect")}
        className="text-xs opacity-60 hover:opacity-100"
      >
        ← Back
      </button>
    </div>
  );
}
```

If `c.locationName` doesn't exist on the type, check the actual field — `listMdmConfigs` may return `name` or similar. Adjust to match the real schema.

- [ ] **Step 2: TS check + commit**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "LocationStep" | head -3
git add app/equipment/scanners/setup/steps/LocationStep.tsx
git commit -m "feat(scanner-setup): LocationStep"
```

---

## Task 16: Create IdentityStep

**Files:**
- Create: `app/equipment/scanners/setup/steps/IdentityStep.tsx`

- [ ] **Step 1: Create**:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

export function IdentityStep({ session }: { session: Session }) {
  const next = useQuery(
    api.scannerMdm.getNextScannerNumber,
    session.state.locationCode ? { locationCode: session.state.locationCode } : "skip",
  );
  const [scannerNumber, setScannerNumber] = useState(session.state.scannerNumber ?? "");
  const [rtDeviceId, setRtDeviceId] = useState(session.state.rtDeviceId);

  // Auto-fill scanner number when query loads
  useEffect(() => {
    if (next && !scannerNumber) setScannerNumber(next);
  }, [next, scannerNumber]);

  const ready = scannerNumber.length > 0 && rtDeviceId.length > 0;

  const handleContinue = () => {
    session.actions.setIdentity(scannerNumber, rtDeviceId);
    session.actions.goToStep("generate");
  };

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Scanner identity</h3>

      <div>
        <label className="block text-xs uppercase tracking-wider opacity-70 mb-1">Scanner number</label>
        <input
          value={scannerNumber}
          onChange={(e) => setScannerNumber(e.target.value)}
          placeholder={next ?? "Loading next free…"}
          className="w-full px-3 py-2 rounded-lg border border-current/20 bg-transparent text-sm font-mono"
        />
        <p className="text-xs opacity-60 mt-1">
          Auto-suggested: <span className="font-mono">{next ?? "…"}</span>
        </p>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider opacity-70 mb-1">RT Device ID</label>
        <input
          value={rtDeviceId}
          onChange={(e) => setRtDeviceId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-current/20 bg-transparent text-sm font-mono"
        />
        <p className="text-xs opacity-60 mt-1">Defaults to 0001. Override only if you have multiple scanners on the same RT account.</p>
      </div>

      <div className="flex justify-between pt-2">
        <button
          onClick={() => session.actions.goToStep("location")}
          className="text-sm opacity-60 hover:opacity-100"
        >
          ← Back
        </button>
        <button
          onClick={handleContinue}
          disabled={!ready}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TS check + commit**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "IdentityStep" | head -3
git add app/equipment/scanners/setup/steps/IdentityStep.tsx
git commit -m "feat(scanner-setup): IdentityStep (scanner number + RT device ID)"
```

---

## Task 17: Create GenerateStep

**Files:**
- Create: `app/equipment/scanners/setup/steps/GenerateStep.tsx`

- [ ] **Step 1: Create**:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../../../../auth-context";
import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

export function GenerateStep({ session }: { session: Session }) {
  const { user } = useAuth();
  const createScanner = useMutation(api.scannerMdm.createScannerFromSetup);
  const storePendingProvision = useMutation(api.scannerMdm.storePendingProvision);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { state, actions } = session;
        if (!state.locationCode || !state.scannerNumber || !state.connection || !user) {
          throw new Error("Missing prerequisites for generate step");
        }

        // Generate a 4-digit PIN client-side (matches the bash script behavior)
        const pin = String(Math.floor(1000 + Math.random() * 9000));

        const result = await createScanner({
          number: state.scannerNumber,
          serialNumber: state.connection.serial,
          model: state.connection.model || "Zebra TC51",
          pin,
          locationCode: state.locationCode,
          actingUserId: user._id as any,
        });

        // Provisioning code via the existing storePendingProvision flow
        const pendingResult = await storePendingProvision({
          scannerId: result.scannerId,
          actingUserId: user._id as any,
        });

        if (cancelled) return;
        actions.setGenerated(result.scannerId, pendingResult.code, pin);
        actions.goToStep("install");
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message ?? "Failed to generate scanner");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (err) {
    return (
      <div className="space-y-3">
        <p className="text-red-500 text-sm">{err}</p>
        <button
          onClick={() => session.actions.goToStep("identity")}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
        >
          ← Back to identity
        </button>
      </div>
    );
  }

  return (
    <div className="text-sm opacity-70 flex items-center gap-2">
      <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      Generating scanner record + provisioning code…
    </div>
  );
}
```

If `createScanner`'s actual signature differs (e.g. takes `locationId` instead of `locationCode`), look it up in `convex/scannerMdm.ts` and adjust the args.

If `storePendingProvision` returns a different shape (e.g. nested under `provisionCode`), adjust accordingly. The existing detail page at `app/equipment/scanners/[id]/page.tsx` line 141 shows the real call signature — match it.

- [ ] **Step 2: TS check + commit**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "GenerateStep" | head -3
git add app/equipment/scanners/setup/steps/GenerateStep.tsx
git commit -m "feat(scanner-setup): GenerateStep (creates scanner + provision code)"
```

---

## Task 18: Create InstallStep (the big one)

**Files:**
- Create: `app/equipment/scanners/setup/steps/InstallStep.tsx`

- [ ] **Step 1: Create — long file, ~250 lines**:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../../../../auth-context";
import { useSetupSession } from "../useSetupSession";
import { fetchApk } from "../apkManifest";

type Session = ReturnType<typeof useSetupSession>;

const TIRETRACK_PKG = "com.importexporttire.tiretrack";
const RTL_PKG = "com.rt_systems.rtlhandsfree";
const AGENT_PKG = "com.ietires.scanneragent";

const BLOATWARE = [
  "com.google.android.googlequicksearchbox",
  "com.google.android.apps.docs",
  "com.google.android.apps.maps",
  "com.google.android.apps.photos",
  "com.google.android.apps.tachyon",
  "com.google.android.gm",
  "com.google.android.music",
  "com.google.android.videos",
  "com.google.android.youtube",
  "com.google.android.calendar",
  "com.google.android.contacts",
  "com.google.android.apps.messaging",
  "com.google.android.dialer",
  "com.google.android.apps.walletnfcrel",
  "com.android.chrome",
  "com.android.camera2",
  "com.android.calculator2",
  "com.android.deskclock",
  "com.android.vending",
  "com.google.android.gms.setup",
];

export function InstallStep({ session }: { session: Session }) {
  const { user } = useAuth();
  const getApkUrls = useAction(api.scannerMdm.getApkDownloadUrls);
  const logStep = useMutation(api.scannerMdm.logScannerSetupStep);
  const markComplete = useMutation(api.scannerMdm.markScannerSetupComplete);
  const mdmConfig = useQuery(
    api.scannerMdm.getMdmConfigByCode,
    session.state.locationCode ? { locationCode: session.state.locationCode } : "skip",
  );

  const [doneInstall, setDoneInstall] = useState(false);
  const [fatalErr, setFatalErr] = useState<string | null>(null);

  useEffect(() => {
    if (!mdmConfig) return;
    if (doneInstall) return;
    let cancelled = false;

    const log = (step: string, status: "started" | "success" | "skipped" | "failed", durationMs?: number, error?: string) => {
      if (!session.state.scannerId || !user) return;
      logStep({
        scannerId: session.state.scannerId,
        step,
        status,
        durationMs,
        error,
        browserAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        actingUserId: user._id as any,
      }).catch(() => {});
    };

    const runStep = async (key: string, label: string, fn: () => Promise<void>) => {
      session.actions.reportProgress(key, "in-progress", label);
      log(key, "started");
      const t0 = performance.now();
      try {
        await fn();
        const dt = Math.round(performance.now() - t0);
        session.actions.reportProgress(key, "success", `${label} (${dt}ms)`);
        log(key, "success", dt);
      } catch (e: any) {
        const dt = Math.round(performance.now() - t0);
        const msg = e?.message ?? String(e);
        session.actions.reportProgress(key, "failed", msg);
        log(key, "failed", dt, msg);
        throw e;
      }
    };

    (async () => {
      try {
        const client = session.state.client;
        const { state, actions } = session;
        if (!state.locationCode) throw new Error("Missing locationCode");

        // 1. Fetch APK URLs
        await runStep("getUrls", "Fetching APK URLs", async () => {
          // (no-op wrapper — the actual fetch is below for parallelism)
        });
        const urls = await getApkUrls({ locationCode: state.locationCode });

        // 2. Download all three APKs in parallel
        await runStep("downloadApks", "Downloading APKs (RTL, TireTrack, Scanner Agent)", async () => {
          const onProgressFor = (label: string) => (pct: number) =>
            actions.reportProgress(`download-${label}`, "in-progress", `Downloading ${label}`, pct);

          const [rtlBuf, ttBuf, agentBuf] = await Promise.all([
            fetchApk(urls.rtLocator, onProgressFor("rtl")),
            fetchApk(urls.tireTrack, onProgressFor("tiretrack")),
            fetchApk(urls.scannerAgent, onProgressFor("agent")),
          ]);
          // Stash on the client for the install steps
          (client as any)._apks = { rtlBuf, ttBuf, agentBuf, versions: { tireTrack: urls.tireTrack.version, rtLocator: urls.rtLocator.version, scannerAgent: urls.scannerAgent.version } };
        });

        const apks = (client as any)._apks;

        // 3. Install RTL
        await runStep("installRtl", "Installing RT Locator", async () => {
          try {
            await client.installApk(apks.rtlBuf);
          } catch (e: any) {
            if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(String(e?.message))) {
              await client.uninstall(RTL_PKG);
              await client.installApk(apks.rtlBuf);
            } else { throw e; }
          }
          actions.recordInstalledVersion("rtLocator", apks.versions.rtLocator);
        });

        // 4. Install TireTrack
        await runStep("installTireTrack", "Installing TireTrack", async () => {
          try {
            await client.installApk(apks.ttBuf);
          } catch (e: any) {
            if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(String(e?.message))) {
              await client.uninstall(TIRETRACK_PKG);
              await client.installApk(apks.ttBuf);
            } else { throw e; }
          }
          actions.recordInstalledVersion("tireTrack", apks.versions.tireTrack);
        });

        // 5. Install Scanner Agent
        await runStep("installAgent", "Installing Scanner Agent", async () => {
          try {
            await client.installApk(apks.agentBuf);
          } catch (e: any) {
            if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(String(e?.message))) {
              await client.uninstall(AGENT_PKG);
              await client.installApk(apks.agentBuf);
            } else { throw e; }
          }
          actions.recordInstalledVersion("scannerAgent", apks.versions.scannerAgent);
        });

        // 6. Push RT config
        await runStep("pushRtConfig", "Pushing RT config", async () => {
          const xml = mdmConfig?.rtConfigXml ?? `<RT>
    <ORIENTATION>PORTRAIT</ORIENTATION>
    <DEVICEID>${state.rtDeviceId}</DEVICEID>
    <SCALEFACTOR>3.5</SCALEFACTOR>
    <RTLMOBILEURL>${mdmConfig?.rtLocatorUrl ?? ""}</RTLMOBILEURL>
</RT>`;
          // Substitute the device ID in case the stored config has a placeholder
          const finalXml = xml.replace(/<DEVICEID>[^<]*<\/DEVICEID>/, `<DEVICEID>${state.rtDeviceId}</DEVICEID>`);
          await client.shell(`mkdir -p '/sdcard/My Documents'`);
          await client.pushTextFile(finalXml, "/sdcard/My Documents/rtlconfig.xml");
        });

        // 7. Grant permissions
        await runStep("grantPerms", "Granting permissions", async () => {
          const grants: Array<[string, string]> = [
            [TIRETRACK_PKG, "android.permission.CAMERA"],
            [TIRETRACK_PKG, "android.permission.READ_EXTERNAL_STORAGE"],
            [TIRETRACK_PKG, "android.permission.WRITE_EXTERNAL_STORAGE"],
            [TIRETRACK_PKG, "android.permission.RECORD_AUDIO"],
            [RTL_PKG, "android.permission.READ_EXTERNAL_STORAGE"],
            [RTL_PKG, "android.permission.WRITE_EXTERNAL_STORAGE"],
            [AGENT_PKG, "android.permission.ACCESS_FINE_LOCATION"],
            [AGENT_PKG, "android.permission.ACCESS_COARSE_LOCATION"],
            [AGENT_PKG, "android.permission.READ_EXTERNAL_STORAGE"],
            [AGENT_PKG, "android.permission.WRITE_EXTERNAL_STORAGE"],
          ];
          for (const [pkg, perm] of grants) {
            try { await client.grantPermission(pkg, perm); } catch { /* silent — perm may not apply */ }
          }
        });

        // 8. Device settings
        await runStep("settings", "Configuring device settings", async () => {
          await client.shell(`settings put system screen_off_timeout 1800000`);
          await client.shell(`settings put system accelerometer_rotation 0`);
        });

        // 9. Activate Scanner Agent as Device Admin
        await runStep("deviceAdmin", "Activating Scanner Agent as Device Admin", async () => {
          await client.setActiveAdmin(`${AGENT_PKG}/.DeviceAdminReceiver`);
        });

        // 10. Disable bloatware
        await runStep("bloatware", "Disabling bloatware", async () => {
          const n = await client.disablePackages(BLOATWARE);
          actions.reportProgress("bloatware", "success", `Disabled ${n} packages`);
        });

        // 11. Launch SetupActivity so operator sees the provisioning code prompt
        await runStep("launchSetupActivity", "Launching Scanner Agent setup", async () => {
          await client.launchActivity(`${AGENT_PKG}/.SetupActivity`);
        });

        // Record completion
        await markComplete({
          scannerId: state.scannerId!,
          installedApps: {
            tireTrack: state.installedVersions.tireTrack ?? apks.versions.tireTrack,
            rtLocator: state.installedVersions.rtLocator ?? apks.versions.rtLocator,
            scannerAgent: state.installedVersions.scannerAgent ?? apks.versions.scannerAgent,
          },
          actingUserId: user!._id as any,
        });

        if (cancelled) return;
        setDoneInstall(true);
        actions.goToStep("verify");
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.message ?? "Install failed";
        setFatalErr(msg);
        session.actions.reportError(msg);
      }
    })();
    return () => { cancelled = true; };
  }, [mdmConfig]);

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Installing</h3>
      <p className="text-xs opacity-70">Provisioning code: <span className="font-mono text-base text-blue-500">{session.state.provisionCode}</span></p>

      <ul className="space-y-1.5 text-sm">
        {Object.entries(session.state.installProgress).map(([key, p]) => (
          <li key={key} className="flex items-center gap-2">
            <span>
              {p.status === "success" && "✓"}
              {p.status === "in-progress" && "…"}
              {p.status === "failed" && "✗"}
              {p.status === "skipped" && "—"}
            </span>
            <span className={p.status === "failed" ? "text-red-500" : ""}>{p.message ?? key}</span>
            {p.percent !== undefined && p.status === "in-progress" && <span className="opacity-60">({p.percent}%)</span>}
          </li>
        ))}
      </ul>

      {fatalErr && (
        <div className="text-red-500 text-sm pt-2">
          <p className="font-semibold">Install failed</p>
          <p>{fatalErr}</p>
        </div>
      )}
    </div>
  );
}
```

This step is large because installation has many sub-operations. The structure (each sub-op wrapped in `runStep`) keeps the logic uniform and the telemetry consistent.

- [ ] **Step 2: TS check (this is the most likely to have shape mismatches with the actual Convex API)**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "InstallStep" | head -10
```

Resolve any errors by adjusting calls to match real Convex function signatures (look up `getMdmConfigByCode`, `markScannerSetupComplete`, etc.).

- [ ] **Step 3: Commit**

```bash
cd /Users/andybarrows/IECentral
git add app/equipment/scanners/setup/steps/InstallStep.tsx
git commit -m "feat(scanner-setup): InstallStep (full ADB orchestration in browser)"
```

---

## Task 19: Create VerifyStep

**Files:**
- Create: `app/equipment/scanners/setup/steps/VerifyStep.tsx`

- [ ] **Step 1: Create**:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

const TIMEOUT_MS = 60_000;

export function VerifyStep({ session }: { session: Session }) {
  const scanner = useQuery(
    api.scannerMdm.getScannerDetail,
    session.state.scannerId ? { id: session.state.scannerId } : "skip",
  );

  const [elapsed, setElapsed] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      const dt = Date.now() - start;
      setElapsed(dt);
      if (dt >= TIMEOUT_MS) {
        setTimedOut(true);
        clearInterval(t);
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (scanner?.isOnline) {
      session.actions.goToStep("done");
    }
  }, [scanner?.isOnline]);

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Waiting for Scanner Agent to connect</h3>
      <div className="space-y-2 text-sm">
        <p>On the scanner, type this code into the Scanner Agent setup screen:</p>
        <div className="text-3xl font-mono font-bold tracking-[0.3em] text-blue-500 text-center py-3 rounded-lg bg-blue-500/10">
          {session.state.provisionCode}
        </div>
        <p className="opacity-70">Once entered, the agent will connect to AWS IoT and you'll see "Online" below.</p>
      </div>

      <div className="text-xs opacity-60">
        Status: {scanner?.isOnline ? "✓ Online" : `Waiting… (${Math.round(elapsed / 1000)}s)`}
      </div>

      {timedOut && !scanner?.isOnline && (
        <div className="text-amber-500 text-sm space-y-2">
          <p>Couldn't verify within 60 seconds.</p>
          <p>The scanner is still provisionable from its detail page — the operator can type the code anytime in the next hour.</p>
          <button
            onClick={() => session.actions.goToStep("done")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
          >
            Mark setup done anyway
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TS + commit**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "VerifyStep" | head -3
git add app/equipment/scanners/setup/steps/VerifyStep.tsx
git commit -m "feat(scanner-setup): VerifyStep (polls scanner.isOnline)"
```

---

## Task 20: Create DoneStep

**Files:**
- Create: `app/equipment/scanners/setup/steps/DoneStep.tsx`

- [ ] **Step 1: Create**:

```tsx
"use client";

import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

export function DoneStep({ session, onClose }: { session: Session; onClose: () => void }) {
  const { scannerNumber, pin, connection } = session.state;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-emerald-500">✓ Setup complete</h3>

      <div className="rounded-lg p-4 bg-emerald-500/10 border border-emerald-500/30 space-y-1 text-sm">
        <div><span className="opacity-70">Scanner:</span> <span className="font-mono font-semibold">{scannerNumber}</span></div>
        <div><span className="opacity-70">PIN:</span> <span className="font-mono font-semibold">{pin}</span></div>
        <div><span className="opacity-70">Serial:</span> <span className="font-mono">{connection?.serial}</span></div>
      </div>

      <div className="text-xs text-amber-500">⚠ Record the PIN — it cannot be recovered.</div>

      <div className="text-sm">
        <h4 className="font-semibold mb-2">Manual on-device steps remaining</h4>
        <ol className="space-y-1 list-decimal list-inside opacity-80 text-xs">
          <li>Wi-Fi → Settings → Network & Internet</li>
          <li>DataWedge App → Default Profile → check "Tab Command" (required for RT — NOT Send Enter)</li>
          <li>Home screen → pin RTLMobile + TireTrack + Settings</li>
          <li>Keyboard → Gboard → Number Row ON, Autocorrect OFF</li>
          <li>Lock screen PIN: set to {pin}</li>
          <li>Ring scanner → Bluetooth Pairing Utility (if RS507)</li>
          <li>Launch RTLMobile and log in</li>
        </ol>
      </div>

      <button
        onClick={onClose}
        className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
      >
        Close
      </button>
    </div>
  );
}
```

- [ ] **Step 2: TS + commit**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "DoneStep" | head -3
git add app/equipment/scanners/setup/steps/DoneStep.tsx
git commit -m "feat(scanner-setup): DoneStep (summary + manual reminders)"
```

---

## Task 21: Wire wizard into Scanner Manager page

**Files:**
- Modify: `app/equipment/scanners/page.tsx`

- [ ] **Step 1: Add imports** at the top of the file (after the existing imports):

```tsx
import { useState } from "react";  // (if not already imported)
import dynamic from "next/dynamic";

const SetupWizard = dynamic(
  () => import("./setup/SetupWizard").then((m) => m.SetupWizard),
  { ssr: false, loading: () => null },
);
```

Dynamic import keeps the 150kB ya-webadb bundle out of the initial page load — only fetched when the wizard opens.

- [ ] **Step 2: Add state for the wizard** inside `ScannerDashboardContent`:

```tsx
const [wizardOpen, setWizardOpen] = useState(false);
const webusbSupported = typeof navigator !== "undefined" && "usb" in navigator;
```

- [ ] **Step 3: Add the button** — find where the existing "Add Scanner" button (or similar) is rendered (search for `showAddModal` or similar). Add this nearby:

```tsx
<button
  onClick={() => webusbSupported ? setWizardOpen(true) : null}
  disabled={!webusbSupported}
  title={webusbSupported ? "Set up a new scanner via USB" : "Open in Chrome or Edge to enable scanner setup"}
  className={`px-4 py-2 rounded-lg text-sm font-medium ${
    webusbSupported
      ? "bg-blue-600 hover:bg-blue-700 text-white"
      : "bg-gray-300 text-gray-500 cursor-not-allowed"
  }`}
>
  + Setup New Scanner
</button>
```

- [ ] **Step 4: Render the wizard** at the bottom of the page JSX (near the existing `Add Scanner` modal):

```tsx
{wizardOpen && <SetupWizard onClose={() => setWizardOpen(false)} />}
```

- [ ] **Step 5: TS + smoke test**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "equipment/scanners/page" | head -3
# Run the dev server briefly to see the new button appear:
# npm run dev → open http://localhost:3000/equipment/scanners
# Verify: "Setup New Scanner" button is visible; clicking opens the wizard modal at the Detect step
```

- [ ] **Step 6: Commit**

```bash
cd /Users/andybarrows/IECentral
git add app/equipment/scanners/page.tsx
git commit -m "feat(scanner-setup): add Setup New Scanner button to Scanner Manager"
```

---

## Task 22: Add Setup History to scanner detail page + deprecation note

**Files:**
- Modify: `app/equipment/scanners/[id]/page.tsx` (add Setup History section)
- Modify: `tools/scanner-setup/README.md` (or create if doesn't exist — add deprecation note)

- [ ] **Step 1: Find a reasonable place in the detail page** to add the Setup History card. Look for where existing scanner detail sections render (provisioning info, last seen, etc.).

- [ ] **Step 2: Add the query at the top of the component**:

```tsx
const setupLogs = useQuery(
  api.scannerMdm.listSetupLogsByScanner,
  scannerId ? { scannerId, limit: 50 } : "skip",
);
```

- [ ] **Step 3: Add the rendered section** somewhere in the detail layout:

```tsx
{setupLogs && setupLogs.length > 0 && (
  <section className={`rounded-xl border ${isDark ? "border-slate-700 bg-slate-800/50" : "border-gray-200 bg-white"} p-4`}>
    <h3 className="text-sm font-semibold mb-3">Setup History</h3>
    <ul className="space-y-1 text-xs">
      {setupLogs.map((log) => (
        <li key={log._id} className="flex items-center gap-3">
          <span className={`w-5 inline-block text-center ${log.status === "success" ? "text-emerald-500" : log.status === "failed" ? "text-red-500" : "opacity-50"}`}>
            {log.status === "success" ? "✓" : log.status === "failed" ? "✗" : "·"}
          </span>
          <span className="font-mono opacity-70 w-32">{log.step}</span>
          {log.durationMs !== undefined && <span className="opacity-60 w-16">{log.durationMs}ms</span>}
          <span className="opacity-50">{new Date(log.createdAt).toLocaleString()}</span>
          {log.error && <span className="text-red-500 ml-2 truncate">{log.error}</span>}
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 4: Create the deprecation README** at `tools/scanner-setup/README.md`:

```markdown
# tools/scanner-setup — DEPRECATED

This Node CLI is **deprecated** as of 2026-05-29. Use the web-based Scanner Setup Wizard in IECentral instead:

> Equipment → Scanner Manager → "Setup New Scanner" button

The wizard does the same work (detect device → install APKs → push RT config → grant permissions → activate Device Admin → register in IECentral) entirely in the browser via WebUSB. No local install, no Terminal, no `npm install`.

This CLI is kept in the repo for one more release for emergency manual use (Bluetooth setup, custom flashing scenarios) but will be removed in a follow-up PR once the web wizard has been used in production for a few weeks without issues.
```

- [ ] **Step 5: TS + commit**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | grep "equipment/scanners/\[id\]" | head -3
git add app/equipment/scanners/\[id\]/page.tsx tools/scanner-setup/README.md
git commit -m "feat(scanner-setup): Setup History on scanner detail + deprecate Node CLI"
```

---

## Task 23: End-to-end smoke test on a real scanner

**Files:** No code changes — manual verification + capture any last-minute fixes.

- [ ] **Step 1: Plug a Zebra TC51 (preferably a known-good one, not the W08-842/W08-002 broken-cam units) into the Mac running IECentral dev**

- [ ] **Step 2: Start IECentral dev**

```bash
cd /Users/andybarrows/IECentral
npm run dev
```

Open http://localhost:3000/equipment/scanners in **Chrome or Edge**.

- [ ] **Step 3: Click "Setup New Scanner". Walk through the wizard end to end.** Pass criteria for each step:

| Step | Pass criteria |
|---|---|
| Detect | Browser prompts for USB device → grant → wizard shows serial/model/Android version |
| Location | Three location buttons render → pick Latrobe → advances |
| Identity | Scanner number auto-fills with next `W08-NNN` → continue |
| Generate | Spinner → advances to Install within ~2s |
| Install | All ~11 sub-steps complete green: getUrls → downloadApks (progress %) → installRtl → installTireTrack → installAgent → pushRtConfig → grantPerms → settings → deviceAdmin → bloatware → launchSetupActivity |
| Verify | Wizard shows 6-char code → operator types into Scanner Agent on device → wizard auto-advances to Done when `isOnline` flips |
| Done | Shows scanner number + PIN; manual-steps list includes the "Tab Command" instruction |

- [ ] **Step 4: Inspect the new Setup History on the scanner detail page**

Navigate to `/equipment/scanners/<the-new-scanner-id>`. Expected: Setup History section shows ~11 entries (one per install step), all "success".

- [ ] **Step 5: Capture and fix any issues** that surface during the smoke test. Likely categories:
  - **Convex API shape mismatches** — adjust function calls to match real signatures
  - **ya-webadb API mismatches** — the library may have evolved; update WebAdbClient to match the installed version
  - **CORS errors on APK download** — re-check Task 8's CORS config
  - **SHA mismatch** — verify Task 7's metadata backfill ran on all APKs

For each fix:
```bash
cd /Users/andybarrows/IECentral
# Edit the file...
git add <specific-file>
git commit -m "fix(scanner-setup): <what was broken and how it's fixed>"
```

- [ ] **Step 6: Final TypeScript pass**

```bash
cd /Users/andybarrows/IECentral
npx tsc --noEmit 2>&1 | head -30
```

Any errors in files we touched must be addressed. Pre-existing errors elsewhere are acceptable.

---

## Self-review

**Spec coverage check:**

| Spec section | Plan task |
|---|---|
| Wizard step 1 — Plug in | Task 14 (DeviceDetectStep) |
| Wizard step 2 — Confirm device | Task 14 (DeviceDetectStep — shows device info) |
| Wizard step 3 — Pick location | Task 15 (LocationStep) |
| Wizard step 4 — Identity | Task 16 (IdentityStep) |
| Wizard step 5 — Generate | Task 17 (GenerateStep) |
| Wizard step 6 — Install (10+ sub-ops) | Task 18 (InstallStep) |
| Wizard step 7 — Verify | Task 19 (VerifyStep) |
| Wizard step 8 — Done | Task 20 (DoneStep) |
| WebAdbClient wrapper | Task 10 |
| apkManifest with SHA verify + IDB cache | Task 11 |
| useSetupSession state machine | Task 12 |
| Wizard modal shell + step routing | Task 13 |
| Wire into Scanner Manager + browser support detection | Task 21 |
| Setup History on scanner detail | Task 22 |
| `getApkDownloadUrls` action | Task 9 |
| `markScannerSetupComplete` mutation | Task 5 |
| `logScannerSetupStep` mutation + `listSetupLogsByScanner` query | Task 4 |
| `scannerSetupLogs` table | Task 3 |
| Lambda extension for sha256 | Task 6 |
| S3 metadata backfill | Task 7 |
| S3 CORS configuration | Task 8 |
| Deprecation note for Node CLI | Task 22 |
| ya-webadb deps installed | Task 2 |
| Feature branch | Task 1 |
| End-to-end smoke | Task 23 |

All spec sections covered.

**Placeholder scan:** No "TBD" / "fill in details" / "similar to Task N" placeholders found. Each task contains the actual code or the actual CLI commands the implementer needs.

**Type consistency:**
- Function names consistent: `WebAdbClient.connect`, `installApk`, `pushTextFile`, `shell`, `setActiveAdmin`, `disablePackages`, `launchActivity`, `grantPermission`
- Convex function names consistent: `getApkDownloadUrls`, `logScannerSetupStep`, `markScannerSetupComplete`, `listSetupLogsByScanner`, `getProvisionCode`, `storePendingProvision`, `createScannerFromSetup`
- Package names consistent throughout: `com.importexporttire.tiretrack`, `com.rt_systems.rtlhandsfree`, `com.ietires.scanneragent`
- Component prop signatures consistent: every step takes `{ session }`, DoneStep additionally takes `{ onClose }`

**Scope check:** 23 tasks, single feature, single PR. The single-PR scope matches the spec.

**Known-risk areas flagged in the plan:**
- Task 10 notes ya-webadb API may differ from the documented version — TypeScript will surface the mismatch
- Task 9 corrected itself mid-task (must be `action` not `query` because of `fetch()`) — engineer should pay attention
- Task 17 notes the real `createScannerFromSetup` and `storePendingProvision` signatures may differ — look up the actual signatures
- Task 18 notes the same for `getMdmConfigByCode` and `markScannerSetupComplete`
- Task 23 explicitly expects to catch and fix these during the smoke test

Plan complete.
