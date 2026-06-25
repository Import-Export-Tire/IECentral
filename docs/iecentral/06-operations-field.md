# IECentral — Operations / Field Cluster

Internal platform for **Import-Export Tire (IE Tires)**. Stack: **Next.js 15 (App Router)** frontend + **Convex** realtime backend + **AWS** (IoT Core, Lambda/SAM, S3, Secrets Manager) for device management and document conversion.

This document covers the Operations / Field cluster: scanner fleet (MDM), physical equipment & vehicles, safety checklists, anonymous safety reports, daily logs & tasks, projects & suggestions, the Document Hub, locations & org chart, and the employee/department portals.

Convex deployment URL referenced throughout: `https://outstanding-dalmatian-787.convex.cloud` (HTTP actions on the matching `.convex.site` host).
Scanner MDM API Gateway base (prod): `https://7brylwlei6.execute-api.us-east-1.amazonaws.com/prod` (region `us-east-1`).

---

## Table of Contents

1. [Scanner MDM (Zebra TC51 provisioning)](#1-scanner-mdm-zebra-tc51-provisioning)
2. [Equipment & Vehicles](#2-equipment--vehicles)
3. [Safety Checklists](#3-safety-checklists)
4. [See Something, Say Something (Safety Reports)](#4-see-something-say-something-safety-reports)
5. [Daily Logs & Tasks](#5-daily-logs--tasks)
6. [Projects, Jobs & Suggestions](#6-projects-jobs--suggestions)
7. [Documents / Doc Hub](#7-documents--doc-hub)
8. [Locations & Org Chart](#8-locations--org-chart)
9. [Employee & Department Portals](#9-employee--department-portals)

---

## 1. Scanner MDM (Zebra TC51 provisioning)

**Purpose:** End-to-end mobile-device-management for the warehouse RF scanner fleet (Zebra TC51, MC3300, etc.). Covers in-browser device provisioning over WebUSB/ADB, AWS IoT Core identity issuance, OTA APK installation, remote command/telemetry, lock-down policy, and a claim-code onboarding handshake.

### Routes

| Route | Purpose |
|-------|---------|
| `app/equipment/scanners/page.tsx` | Fleet dashboard — KPIs (total/online/offline/avg battery/alerts), location + status filters, add-scanner modal, "Setup New Scanner" (opens wizard, SSR disabled) |
| `app/equipment/scanners/[id]/page.tsx` | Per-scanner detail: telemetry, assignment/return, PIN change, remote control (lock/unlock/reset PIN/push update/push config/restart/factory wipe), setup-log history |
| `app/equipment/scanners/settings/page.tsx` | Per-location MDM config + global lock policy editor |
| `app/equipment/scanners/setup/SetupWizard.tsx` | The WebUSB/ADB setup wizard (modal state machine) |
| `app/api/scanner-mdm/{provision,apk,config,lookup,command}/route.ts` | Next.js route handlers (mostly proxies to API Gateway; `lookup` queries Convex) |

### Setup wizard internals (`app/equipment/scanners/setup/`)

The wizard is fully client-side device automation built on **`@yume-chan/adb` over WebUSB** (Chrome only). It runs as a reducer state machine.

- **`useSetupSession.ts`** — reducer holding `step`, ADB `connection`, location/identity, `scannerId`, `provisionCode`, generated `pin`, per-step `installProgress`, `installedVersions`, and `mode` (`"new"` | `"update"`).
- **`WebAdbClient.ts`** — pure-TS ADB wrapper. Methods: `connect()` (WebUSB picker → ADB daemon auth → reads model/serial/Android version), `disconnect()` (must release the USB device or Chrome keeps it claimed), `shell()` (shellProtocol with noneProtocol fallback for old Android), `installApk()` (push to `/data/local/tmp` → `pm install -r`), `uninstall()`, `setActiveAdmin()`, `isDeviceOwner()`/`setDeviceOwner()`, `disablePackages()` (`pm disable-user --user 0`), `configureDataWedgeTab()` (DataWedge intent broadcast — Tab keystroke after each scan), `pushTextFile()`, `grantPermission()`, `launchActivity()`. IET package IDs: `com.importexporttire.tiretrack`, `com.rt_systems.rtlhandsfree`, `com.ietires.scanneragent`.
- **`apkManifest.ts`** — `fetchApk()` streams presigned-URL APKs, verifies SHA-256, and caches them in IndexedDB (`scanner-setup-apk-cache`) keyed by `s3Key|sha256`.

**Step flow** — New (7): DeviceDetect → Location → Identity → Generate → Install → Verify → Done. Update (5): DeviceDetect → Manage → Install → Verify → Done.

| Step | What it does |
|------|--------------|
| `DeviceDetectStep` | `connect()` over USB; looks up `getScannerBySerialNumber` to detect an already-registered device → offers update vs new |
| `LocationStep` | Pick warehouse (`listMdmConfigs`, `locations.listByType`) |
| `IdentityStep` | Auto-suggests next scanner number (`getNextScannerNumber`); RT device ID |
| `GenerateStep` | Generates 4-digit PIN; `createScannerFromSetup` → POST `/api/scanner-mdm/provision` (Lambda mints IoT thing+cert) → `storePendingProvision` (stores cert/key + 6-char claim code) |
| `InstallStep` | The heavy lifter — see below |
| `VerifyStep` | Polls `getScannerDetail` for `isOnline`; shows the claim code to type on-device; 2-min timeout with "mark done anyway" |
| `ManageStep` (update only) | Change status / reassign / condition notes before reinstall |
| `DoneStep` | Confirmation + remaining manual on-device steps (Wi-Fi, lock-screen PIN, RS507 Bluetooth, etc.) |

**`InstallStep` sequence:** fetch APK URLs (`getApkDownloadUrls` action) → parallel download+SHA-256 verify (IndexedDB cache) → install RTLocator/TireTrack/ScannerAgent (auto-uninstall+retry on `INSTALL_FAILED_UPDATE_INCOMPATIBLE`) → push `/sdcard/My Documents/rtlconfig.xml` (DEVICEID substituted) → grant permissions → device settings (screen timeout, rotation) → activate Device Admin → **promote Device Owner** (fails if any accounts exist — must remove them first) → DataWedge Tab (if policy) → **lock-down** (disable every package not in keep-set = IET apps + essential system prefixes + `allowedPackages`) → launch on-device `SetupActivity` → log each step (`logScannerSetupStep`) → `markScannerSetupComplete` (new) / `updateScannerFromSetup` (update).

### Convex backend — `convex/scannerMdm.ts`

Key queries: `getScannerFleetOverview`, `getScannerDetail`, `getScannerBySerialNumber`, `getScannersNeedingAttention` (offline >2h or battery <20%), `getMdmConfig`/`getMdmConfigByCode`/`listMdmConfigs`, `getNextScannerNumber` (`{code}-NNN` zero-padded), `getProvisionCode`, `listSetupLogsByScanner`, `getLockPolicy`.

Key mutations: `provisionScanner`, `deprovisionScanner`, `logScannerCommand`, `updateCommandStatus`, `upsertMdmConfig`, `createScannerFromSetup` (dedupe by number+location and serial), `storePendingProvision` (generates claim code), `logScannerSetupStep`, `markScannerSetupComplete`, `setLockPolicy` (`requireAdmin`), `updateScannerFromSetup`.

Internal mutations: `updateScannerTelemetry` (consumes IoT telemetry; raises/clears alerts — see gotchas), `bulkUpdateOnlineStatus` (offline if `lastSeen` >5 min), `claimProvision(code)` (validates not-claimed/not-expired, returns certs + RT config XML), `cleanupExpiredProvisionCodes` (nulls cert/key on claimed-or-expired codes).

Action: `getApkDownloadUrls(locationCode)` — fans out 3 GETs to the API Gateway `/scanner-mdm/apk` endpoint.

### Convex backend — `convex/scratchpad.ts` + `app/scratch`

Pastebin-style ephemeral text sharing. `createCode` (unique 4-digit `0000`–`9999`, 24-hour TTL, opportunistic GC of up to 20 expired rows per call, content ≤100 KB), `getByCode` (regex-validated), `deleteCode`. Table: `scratchpadCodes`. Frontend: `app/scratch/page.tsx`.

### AWS SAM stack — `aws/scanner-mdm/`

`template.yaml` (Python 3.12 Lambdas) provisions:

- **S3** `ietires-scanner-assets` (versioned) — APKs (`apks/...`), RT configs, certs.
- **Secrets Manager** `scanner-mdm/convex-credentials` — `{convex_deploy_key, webhook_secret}`.
- **IoT Core** thing group `ietires-scanners`, policy `ietires-scanner-policy` (Connect `scanner-*`; Publish telemetry/ack/shadow; Subscribe/Receive cmd + shadow topics).
- **IoT Topic Rule** `scanner_telemetry_to_lambda` — `SELECT *, topic(3) as thingName FROM 'dt/scanners/+/telemetry'` → invokes StatusFunction.
- **API Gateway** `scanner-mdm-api` (CORS `*`) with stage `prod`.
- **CloudWatch** alarm on provision errors → SNS `scanner-mdm-alarms` (email `andy@ietires.com`).

| Lambda | File | Trigger | Behavior |
|--------|------|---------|----------|
| `scanner-provision` | `lambdas/provision.py` | POST `/scanner-mdm/provision` | Creates IoT thing (idempotent), mints fresh cert+keys, attaches policy, sets initial shadow, returns PEM/key/endpoint, calls Convex `scannerMdm:provisionScanner`. Supports `action:"retire"` to retire all-but-one cert **at claim time** (so an abandoned provision never strands a device) |
| `scanner-command` | `lambdas/command.py` | POST `/scanner-mdm/command` | Publishes MQTT to `cmd/scanners/{thing}/{command}` (QoS 1); for `install_apk` adds a 1-hr presigned S3 URL; lock/unlock also write desired shadow. Valid: lock, unlock, wipe, install_apk, push_config, restart, update_pin |
| `scanner-fetch-apk` | `lambdas/fetch_apk.py` | GET `/scanner-mdm/apk` | Returns presigned URL + SHA-256 (from S3 `x-amz-meta-sha256`) for tiretrack/rtlocator/agent; reads MDM config from Convex; Expo source is a TODO placeholder (falls back to S3) |
| `scanner-setup-config` | `lambdas/setup_config.py` | GET `/scanner-mdm/config/{locationCode}` | Returns merged MDM config; falls back to per-code defaults (hardcoded RT URLs for W08 Latrobe / R10 Everson / W09) and a default Zebra bloatware list |
| `scanner-status` | `lambdas/status.py` | IoT Rule | Maps device shadow telemetry → POST to Convex HTTP endpoint `…/scanner-telemetry` on the `.convex.site` host, authenticated with `x-webhook-secret` |

### Tables

`scanners`, `scannerMdmConfigs`, `scannerCommandLog`, `scannerProvisionCodes`, `scannerSetupLogs`, `scannerLockPolicy`, `pickers`, `scratchpadCodes`. (See schema lines 879–1129, 959–991, 3342 in `convex/schema.ts`.)

### Notable logic / gotchas

- **Claim-code provisioning:** 6-char codes from alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/I/1), **15-minute TTL**, up to 10 retries for uniqueness. Cert PEM + private key live in `scannerProvisionCodes` only until claimed/expired, then `cleanupExpiredProvisionCodes` nulls them (≥1 day) to avoid credential leakage.
- **Retire-at-claim:** Old certs are retired only after the device adopts the new one (`provision.py action:"retire"`), preventing stranded devices.
- **Telemetry alerts** (`updateScannerTelemetry`): low battery <15% (clears ≥15%), offline >30 min (clears on reconnect), low storage <500 MB (clears ≥500 MB); capped at 20 alerts/scanner.
- **Lock-down is effectively one-way** on-device (needs factory reset / manual `pm enable`) — that's why it's policy-gated. Device-Owner promotion fails if Google/Exchange accounts exist.
- **`/api/scanner-mdm/command`** enforces `confirmed:true` for `wipe` (defense-in-depth on top of upstream).
- All scanner-mdm Next routes require env `SCANNER_MDM_API_GATEWAY_URL`; `lookup` uses `NEXT_PUBLIC_CONVEX_URL` (defaults to the hardcoded Convex URL).
- Lock policy defaults: `lockdownEnabled:true`, `dataWedgeTab:true`, `screenTimeoutMs:1800000` (30 min), `screenRotation:"portrait"` (memory note says lock-down was seeded **OFF** pending live validation — verify the live row).

---

## 2. Equipment & Vehicles

**Purpose:** Lifecycle management of all physical equipment — scanners, pickers (order-picking devices), company vehicles, and computers — with signed responsibility agreements, return condition checks, and a full audit history.

### Routes & backend

- App: `app/equipment/page.tsx` (tabs: pickers / scanners / vehicles / computers; assign / return / reassign / retire; QR modal; safety + equipment history modals).
- Convex: `convex/equipment.ts` (~2000 lines).

### Tables

| Table | Notes |
|-------|-------|
| `equipment` | Computers/laptops/printers/phones — stores admin/user passwords (plaintext), Chrome Remote Desktop ID, IP/MAC (schema line 1935) |
| `pickers` | Order-picking devices (line 970) |
| `vehicles` | Company fleet: VIN/plate, insurance & registration expiry, mileage tracking, maintenance (line 1132) |
| `equipmentAgreements` | Signed disclosures — base64 signature, witness, `equipmentValue`, revocation fields (line 994) |
| `equipmentConditionChecks` | 7-item return checklist, overall condition, deduction amount, sign-off signature (line 1017) |
| `equipmentHistory` | Audit trail of assign/unassign/status/condition events (line 1183) |
| `equipmentChecklistConfig` | Per-equipment / per-person safety-checklist overrides (line 1225) |

(`scanners` itself is shared with module 1.)

### Key functions (`convex/equipment.ts`)

- **Scanners & pickers (parallel API):** `listScanners`/`listPickers`, `getScanner`/`getPicker`, `getAvailableScanners`/`getAvailablePickers`, `createScanner`/`createPicker` (unique number per location), `updateScanner`/`updatePicker` (logs PIN changes to history), `assignScanner`/`unassignScanner` (and picker equivalents).
- **Agreements & checks:** `assignEquipmentWithAgreement` (captures base64 signature, default value $100), `returnEquipmentWithCheck` (7-item checklist → if repair-required or not-ready, equipment → `maintenance`, else `available`; can record pay deduction; auto-revokes active agreement), `reassignEquipment` (return-check + revoke old + new agreement + reassign in one call), `getEquipmentAgreement`, `getPersonnelAgreements`, `getEquipmentConditionHistory`, `generateAgreementText`.
- **Status/history:** `getEquipmentHistory`, `changeEquipmentStatus`, `retireEquipment` (admin), `deleteEquipment` (admin; cascades history/agreements/checks), `updateConditionNotes`.
- **Vehicles:** `listVehicles`, `getVehicle`, `getVehicleByVin`, `createVehicle` (unique VIN, uppercases VIN/plate), `updateVehicle`, `assignVehicle`/`unassignVehicle`, `updateVehicleMileage`, `retireVehicle`/`deleteVehicle` (admin).
- **Computers:** `listComputers`, `getRemoteAccessComputers`, `createComputer`, `updateComputer`, `updateChromeRemote`, `deleteComputer` (admin). Chrome Remote URL built as `https://remotedesktop.google.com/access/session/{chromeRemoteId}`.
- **Mobile/employee:** `getMyEquipment`, `getPersonnelEquipment`.

### Notable logic / gotchas

- Most writes gated by `requireManagePersonnel`; destructive ops by `requireAdmin`.
- Signatures are base64 PNGs stored inline (no file storage).
- Computer `adminPassword`/`userPassword` and Chrome Remote codes are stored **plaintext** (`equipment.ts:1819-1820`), but the queries that return them are now **gated to tier 2+** (security-hardening update): `listComputers` (`:1685`) and `getRemoteAccessComputers` (`:1742`) both call `requireMinTier(ctx, requestingUserId, 2)`, so anonymous and tier-1 callers never receive the secrets. Codes remain unencrypted at rest.
- Reassignment writes two history rows (unassign + assign) plus a condition check.

---

## 3. Safety Checklists

**Purpose:** Pre-use equipment safety inspections (primarily pickers), with admin-editable templates, per-equipment / per-person overrides, timing gates, training eligibility, and historical record fix-ups.

### Routes & backend

- App: `app/safety-check/[equipmentId]/page.tsx` (mobile floor workflow — select personnel → timed checklist → submit; has an error boundary that shows operator-readable errors) and `app/safety-check/manager/page.tsx` (per-date/per-location completion review + printable record). Template editing lives under `app/settings/safety-checklists`.
- Convex: `convex/safetyChecklist.ts`.

### Tables

`safetyChecklistTemplates` (line 1201), `equipmentChecklistConfig` (line 1225), `safetyChecklistCompletions` (line 1259).

### Key functions

`getDefaultTemplate`, `getAllTemplates`, `getEquipmentChecklist` (merges template + equipment additions + personnel overrides; uses `ctx.db.normalizeId` to tolerate bad QR/URL ids), `upsertTemplate` (auto-unsets other defaults), `deleteTemplate`, `configureEquipmentChecklist`, `addPersonnelOverride`, `createDefaultTemplate`, `getEligiblePersonnel` (requires "Picker Training Video" — checks both new `trainingRecords` and legacy `completedTraining`), `getCompletionsByDate`, `getPersonnelCompletions`, `getEquipmentCompletions`, `hasCompletedToday`, `submitChecklist`, `fixHistoricalCompletions` (bulk-rewrites `passed` where a "no" answer should count as passing, e.g. "are you impaired?").

### Notable logic / gotchas

- Template fallback chain: equipment-type-specific → `"all"` → hardcoded `DEFAULT_PICKER_CHECKLIST_ITEMS` (12 items).
- Each item has `minimumSeconds` — the **frontend enforces** elapsed time before allowing proceed.
- Items support `responseType` (`yes_no`/`yes_no_na`/`condition_report`), `requiresDetailsOn`, and `expectedAnswer` (so a "no" can be the passing answer).
- No external integrations — pure Convex.

---

## 4. See Something, Say Something (Safety Reports)

**Purpose:** Anonymous safety / security / theft / harassment reporting. A public QR-driven form feeds a **super-admin-only** inbox with multi-channel alerting; photos are EXIF-stripped for reporter anonymity.

### Routes & backend

| Route | Purpose |
|-------|---------|
| `app/report/page.tsx` | **Public** form. Location auto-set from `?loc=` QR param; category, description, occurred-at, optional photo, optional contact. Calls `safetyReports.submit` |
| `app/safety-reports/page.tsx` | Super-admin inbox — status filter, report cards, photo, reference code |
| `app/safety-reports/posters/page.tsx` | Printable per-location QR posters (`?loc=`) |
| `app/api/safety-reports/photo/route.ts` | Photo upload endpoint (Node runtime, `sharp`) |
| `components/SafetyReportsWidget.tsx` | Dashboard widget (super-admin-only counts) |

### Convex backend — `convex/safetyReports.ts`

- `submit` (unauthenticated) — generates `SR-XXXXX` reference code, schedules notification fan-out.
- `generatePhotoUploadUrl` — secret-gated (`PREVIEW_PDF_SECRET`).
- `list`, `counts`, `updateStatus`, `getPhotoUrl` — all require `super_admin`.
- `notifyNewReport` (internalAction, `runAfter(0)`) — fans out in-app notifications + Resend email to all active super-admins (best-effort; one channel failing doesn't block the other). Helpers `_notifyData`, `sendReportEmail`.

### Table

`safetyReports` (line 3640): category, locationId + locationName snapshot, description, occurredAt, `photoFileId`, optional reporter contact, `referenceCode`, status (`new`/`in_review`/`resolved`/`dismissed`), review fields.

### One-page PDF export (jsPDF)

The inbox prints a single report to a **one-page PDF generated client-side with jsPDF** — the prior CSS `@media print` / `window.print()` approach was abandoned because it "kept spilling onto a blank second page across browsers/margin settings" (`app/safety-reports/page.tsx:171-173`).

- `printReportPdf()` (`app/safety-reports/page.tsx:175-304`) dynamically imports jsPDF (`const { jsPDF } = await import("jspdf")`, line 176) and builds a Letter-size portrait doc in inches (`new jsPDF({ unit: "in", format: "letter", orientation: "portrait" })`, line 177). Triggered by the per-report button at line 371.
- Layout: header "See Something, Say Something — Report" (line 214); reference code / status / submission timestamp (216-219); a 2×2 facts grid — Category, Location, When, Reporter (222-232); description (271); optional reporter contact (272-274); optional review notes + reviewer name (276-278); confidentiality + print-time footer (290-292).
- **Photo** is loaded via canvas to a dataURL (234-254) and embedded as a JPEG (282-287). Reserve calculations (256-264) keep everything on a single page — there are no `addPage()` calls. Output is streamed to a hidden iframe for the print dialog (294-303).

### Notable logic / gotchas

- **EXIF stripping** happens in `app/api/safety-reports/photo/route.ts`: `sharp().rotate().resize(1600, fit:inside).jpeg(82)` with **no `.withMetadata()`**, dropping GPS/timestamp/device data. Limits: image/* only, ≤25 MB; gated by `PREVIEW_PDF_SECRET`.
- Reviewer/recipient roles hardcoded to `["super_admin"]` (intentionally tight for sensitive reports).
- Stores only user-typed data — no IP/device fingerprinting on submit.

---

## 5. Daily Logs & Tasks

**Purpose:** Daily work logs (with auto-captured activity from audit logs), per-user recurring daily task checklists, and project task management with AI-assisted task generation.

### Routes & backend

- App: `app/daily-log/page.tsx` (admin team view, live activity, submit-on-behalf, reviewer comments, unlock) and `app/daily-log/report/page.tsx` (analytics).
- Convex: `convex/dailyLogs.ts`, `convex/tasks.ts`, `convex/aiTasks.ts`.

### Tables

`dailyLogs` (line 352), `dailyTaskTemplates` (line 392), `dailyTaskCompletions` (line 405), `tasks` (line 96).

### Key functions

- **`dailyLogs.ts`:** queries `getByDate`, `getByDateRange`, `getMyLogs`, `getLogsForUsers`, `getTodayLiveActivity` (rolls up `auditLogs`), `getWeeklyOverview`, `getUsersRequiringDailyLog`, `getAutoActivities`, `getDailyTasksWithStatus`; mutations `create`/`update`/`submit`/`saveLog`/`remove`, `submitOnBehalf` (admin), `unlockLog` (admin), `addReviewerComment` (hidden from submitter), daily-task CRUD (`createDailyTask`, `updateDailyTask`, `deleteDailyTask`, `toggleDailyTaskCompletion`, `reorderDailyTasks`), internal `sendWeeklyDigestEmails`.
- **`tasks.ts`:** `create`, `createBatch` (used by AI), `update`, `updateStatus` (sets `completedAt`, writes auditLog), `remove`, `reorder`; queries `getByProject`, `getAssignedToUser`. Sends `task_assigned` notifications.
- **`aiTasks.ts`:** `generateTasks` action — **Anthropic Claude** (`claude-sonnet-4-20250514`, env `ANTHROPIC_API_KEY`, max 2000 tokens) breaks a project description into 3–10 tasks, persists via `tasks.createBatch`; graceful keyword-based fallback if the key is missing or the call fails.

### Notable logic / gotchas

- Auto-activity capture: on create/submit, counts `auditLogs` for the day (projects created/moved, tasks completed) and snapshots into `dailyLogs.autoActivities`.
- Draft vs submitted: submitted logs are locked; admin `unlockLog` reopens them. `reviewerComment` is stored but never shown to the submitter (print reports only).

---

## 6. Projects, Jobs & Suggestions

**Purpose:** Kanban project tracking with tasks, notes/@mentions, sharing/visibility, an activity feed, and a teammate-to-teammate project suggestion workflow.

### Routes & components

- App: `app/projects/page.tsx` (Kanban + tasks + AI generation + notes), `app/suggestions/page.tsx` (suggestion inbox/outbox).
- Components: `components/KanbanBoard.tsx`, `KanbanColumn.tsx`, `ProjectCard.tsx` (dnd-kit drag-drop across backlog/in_progress/review/done), `ActivityFeed.tsx`.

### Convex backend

- **`convex/projects.ts`:** queries `getAll` (access-filtered: owner + assigned + shared + public), `getByStatus`, `getById`, `getWithTasks`, `getStats`, `getArchived`, `getNotes`, `getSharedUsers`; mutations `create`, `update`, `updateStatus` (sets `doneAt`/`archivedAt`, audit-logged), `archive`/`unarchive`, `remove` (cascades tasks), `shareProject`/`unshareProject`, `updateVisibility`, `addNote`/`updateNote`/`deleteNote` (mention notifications); internal `autoArchiveOldDoneProjects` (>1 week in `done`, cron-driven).
- **`convex/projectSuggestions.ts`:** `create`/`createWithUser`, `approve` (→ creates a `projects` row, status `backlog`, links `projectId`), `deny`, `remove`; queries `getInbox`, `getOutbox`, `getAllPending`, `getById`. Approve/deny gated to the recipient or a manager.
- **`convex/activity.ts`:** `getRecentActivity(limit)` (default 50) — **still no dedicated activity table**; it synthesizes a feed on each call from `applications`, `projects`, `personnel`, `safetyChecklistCompletions` (last 10 of each), and `messages` (last 5), then sorts by timestamp and slices to `limit` (`activity.ts:5-175`). `getEntityActivity` remains a stub returning `[]` (`:178-188`). Scales poorly at volume.

### Tables

`projects` (line 62), `tasks` (line 96), `projectNotes` (line 115), `projectSuggestions` (line 824), `jobs`/`applications` (line 128/150 — recruiting, adjacent). No `activity` table.

### Notable logic / gotchas

- Kanban statuses are exact strings (`backlog`/`in_progress`/`review`/`done`/`archived`).
- Suggestion → project is one-way; the approved suggestion keeps a `projectId` back-reference and stores `estimatedTimeline`.
- Mention notifications fire only for **newly** added mentions on note updates.

---

## 7. Documents / Doc Hub

**Purpose:** Internal document hub on Convex storage — nested folders, visibility levels, group sharing, password-protected (HIPAA-style) folders with audit logging, version history, e-signatures, server-generated thumbnails, and in-house Office→PDF rendering via a private LibreOffice Lambda.

### Routes & components

- App: `app/documents/page.tsx` (+ legacy `page.old.tsx`).
- Components: `components/dochub/*` — `DocHubContext`, `DocHubSidebar`, `FileBrowser`, `FileCard`, `Breadcrumbs`, `ContextMenu`, `FolderModal`, `FolderUploadModal`, `UploadModal`, `PreviewModal`, `ShareAccessModal`, `HelpModal`.
- API routes: `app/api/documents/{file,thumbnail,thumb,office-pdf,upload-s3}/route.ts`.

### Convex backend

- **`convex/documents.ts`:** queries `getAll`/`getRootDocuments`/`getByCategory`/`search` (all visibility-filtered), `getById`, `getDownloadUrl`, `getCategoryCounts`, `getArchived`, `getVersions`, `getExpiring`, `getPublicBySlug`/`getPublicFileUrl` (no auth), `getStorageUsage` (the storage meter), `getThumbnailUrl`, `getPreviewPdfUrl`; mutations `generateUploadUrl`, `create`, `update`, `shareWith`/`unshareWith`/`shareWithGroups`/`unshareWithGroups`, `incrementDownload`, `archive`/`remove`/`restore`, `togglePublic` (slug = name + last-6 of docId), `setExpiration`/`removeExpiration`, `generatePreviewUploadUrl`/`setPreviewPdf`, `generateThumbnailUploadUrl`/`setThumbnail` (secret-gated), `uploadNewVersion`/`restoreVersion`.
- **`convex/documentFolders.ts`:** folder tree + sharing + HIPAA logging. **Folder cards now count files recursively and show a subfolder count.** A shared helper trio computes this once per query call: `buildDirectDocCount(allDocs)` maps each `folderId` → direct file count (`documentFolders.ts:140-147`); `countDocsInSubtree(folderId, childrenByParent, directCount)` **recursively** walks the children-by-parent map and sums the folder's own files plus every descendant folder's files (`150-160`); `getFolderWithCounts(...)` returns the folder enriched with `documentCount` (recursive total), `directDocumentCount` (this folder only), `subfolderCount` (immediate children), and `isProtected` (`166-179`). Used by `getMyFolders` (`199-224`), `getCommunityFolders` (`227-251`), and `getAll` (`255-322`). The UI renders the label via `folderCountLabel(folder)` in `components/dochub/types.ts:200-207` (e.g. `"2 folders · 14 files"`, falling back to `"Empty"`), drawn in `FileCard.tsx` at `:370` (grid) and `:458` (list). Notable: `getProtectedDocuments` action with a layered access check — community visibility (no auth) → owner → non-revoked/non-expired grant → group membership → `internal` visibility → password (PBKDF2, 100k iters, SHA-256, constant-time compare); **super-admins do NOT bypass folder passwords** (minimum-necessary). Logs both successful and failed (`password_attempt`) access. `moveFolder` walks the parent chain to prevent cycles; `archive` requires the folder be empty; `moveDocument` returns quietly if the doc is missing.
- **`convex/documentTemplates.ts`:** `list`, `create`/`createFromUpload`, `useTemplate` (spawns a document, bumps `usageCount`), `archive`.

### API routes

| Route | Method | Purpose / notes |
|-------|--------|------|
| `documents/file` | GET | Same-origin stream proxy of a Convex-stored file (avoids CORS/X-Frame); RFC-5987 filenames; `?dl=1` forces attachment; `Cache-Control: private, max-age=60` |
| `documents/thumb` | GET | Streams the cached page-1 PNG; `max-age=86400`; 404 if not yet generated |
| `documents/thumbnail` | POST | **Generates** the thumbnail (Node runtime, maxDuration 300): images via `sharp`, PDFs via `pdf-to-img`, Office/text via the LibreOffice Lambda → page-1 PNG; caches to Convex. Best-effort (silent fallback to icon) |
| `documents/office-pdf` | GET | Returns a PDF rendition of an Office doc for inline preview/print; cache-hit streams `previewPdfFileId`, miss converts via Lambda then caches; 503 if not configured; `max-age=300`. **Now transports the file through Convex storage URLs, not the invoke payload:** it gets a source download URL (`documents.getFileDownloadUrl`) + a preview upload URL (`documents.generatePreviewUploadUrl`) and invokes the Lambda with `{secret, filename, srcUrl, uploadUrl}` so neither the source nor the rendered PDF rides the 6 MB synchronous invoke request/response cap (`office-pdf/route.ts:64-92`, rationale at `:71-75`). The Lambda fetches, converts, uploads, and returns just `{storageId}` |
| `documents/upload-s3` | POST | Presigned S3 PUT (`DOCHUB_S3_BUCKET`, default `iecentral-dochub`); key `documents/{ts}-{sanitized}`; 1-hr expiry |

### Office→PDF Lambda — `aws/office-to-pdf/index.js`

Node 20 (AL2023) Function-URL Lambda. LibreOffice ships as a brotli tarball at `/opt/lo.tar.br`, decompressed+untarred to `/tmp/instdir` on first warm invocation (writes a minimal `fonts.conf`; sets `HOME=/tmp`, `LD_LIBRARY_PATH`). Auth via `x-convert-secret` header (`CONVERT_SECRET`). Runs `soffice.bin --headless --convert-to pdf`. Gotchas noted in-file: do **not** pass `-env:UserInstallation` (causes exit 81); 55s internal timeout. Invoked from the Next routes via SDK using `OFFICE_PDF_LAMBDA_FUNCTION` (default `office-to-pdf`), `OFFICE_PDF_AWS_REGION`/`S3_REGION`, and dedicated `OFFICE_PDF_AWS_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`; payload secret is `PREVIEW_PDF_SECRET` on the Next side.

**Two transport modes** (`aws/office-to-pdf/index.js:90-111`): the handler destructures `{ filename, contentBase64, srcUrl, uploadUrl }` and errors `400` unless one of `contentBase64`/`srcUrl` is present (`:90-91`).

- **URL mode (preferred, for the preview/print PDF):** request `{filename, srcUrl, uploadUrl}` — the Lambda fetches the source from `srcUrl`, converts, POSTs the rendered PDF to `uploadUrl` (a Convex storage upload URL), and returns just `{storageId}`. This keeps large files off the 6 MB synchronous-invoke cap. Used by `documents/office-pdf`.
- **Inline mode (legacy fallback, still fully supported):** request `{filename, contentBase64}` → returns `{pdfBase64}`. Still used by `documents/thumbnail` (`thumbnail/route.ts:60-61`), which needs the PDF bytes locally to rasterize a page-1 PNG rather than just storing the PDF.

### Tables

`documents` (line 1295), `docHubSignatures` (line 1335), `documentFolders` (line 1350), `folderAccessGrants` (line 1373), `folderAccessLog` (line 1390), `userFolderOrder` (line 1408), `groups` (line 1418), `documentVersions` (line 3178), `documentTemplates` (line 3193).

### Notable logic / gotchas

- Visibility: `private` (owner + shared users/groups), `internal` (all authenticated), `community` (all authenticated / public-capable). Folder visibility is `private` | `community` | `internal`.
- `uploadNewVersion` intentionally inserts the archived version as `versionN` and the new file as `versionN+2` (skips N+1).
- Public slugs persist even when `isPublic` is toggled off (re-enable without regenerating).
- Thumbnail/preview/PDF caching is best-effort; stale cached storage objects trigger re-conversion.
- Both `setPreviewPdf` and `setThumbnail` mutations are gated by `PREVIEW_PDF_SECRET`.

---

## 8. Locations & Org Chart

**Purpose:** Master location registry (warehouses/retail/office/distribution) with security codes, plus a tier-based RBAC org chart.

### Routes & backend

- App: `app/locations/page.tsx`, `app/org-chart/page.tsx`. Label helper: `lib/locationLabels.ts`.
- Convex: `convex/locations.ts`, `convex/orgChart.ts`.

### `convex/locations.ts`

Queries `list`, `listActive`, `listActiveWarehouses`, `get`, `getByName`, `listByType`. Mutations `create`/`update`/`deactivate`/`reactivate`/`seedLocations` (all `requireAdmin`). Deactivate is blocked if personnel or equipment (scanners/pickers) are still assigned; unique-name enforced. `managerId` FK feeds termination/manager rollup reports.

**Security codes are now gated (security-hardening update).** Codes (`pinCode`, `alarmCode`, `gateCode`, `wifiPassword`, `securityNotes`) are still stored **plaintext** in the schema and accepted by `create`/`update` (`locations.ts:92-96`), **but they are no longer returned by the general-purpose queries.** A `stripSecrets()` helper (`locations.ts:11-15`) destructures those fields off every row returned by `list` (`:18-24`), `listActive` (`:27-36`), `listActiveWarehouses` (`:39-48`), `get` (`:51-56`), and `getByName` (`:59-68`); `listByType` returns only `_id`/`name`/`locationType` (`:291-301`). The codes are exposed **only** through the dedicated `listWithSecurity` query, which is `requireAdmin`-gated (`locations.ts:72-78`, gate at `:75`). The older "exposed plaintext to all callers" note is stale.

### `convex/orgChart.ts`

`getOrgChartData` — groups `users` by RBAC tier (T5 super_admin → T1; **T0 excluded**), deduplicates by email keeping the highest tier, enriches with managed departments/locations and flags (`isFinalTimeApprover`, `isPayrollProcessor`, `requiresDailyLog`), and returns tier labels/permissions/colors for the UI.

### Tables

`locations` (line 846). (Org chart reads `users` + `locations`; no dedicated table.)

---

## 9. Employee & Department Portals

**Purpose:** Employee self-service (time off, call-offs, schedule, hours, time clock, pay stubs, announcements, overtime) and a department-scoped dashboard. Backs the mobile app via Expo push.

### Routes & backend

- App: `app/portal/page.tsx` with sub-routes `app/portal/{call-off,corrections,documents,hours,paystubs,schedule,surveys,time-off}`; `app/department-portal/page.tsx`.
- Convex: `convex/employeePortal.ts` (~1000 lines).

### Key functions (`convex/employeePortal.ts`)

- **Time off:** `getMyTimeOffRequests`, `getPendingTimeOffRequests`, `submitTimeOffRequest`, `cancelTimeOffRequest`, `reviewTimeOffRequest`.
- **Call-offs:** `getMyCallOffs`, `getPendingCallOffs`, `submitCallOff`, `acknowledgeCallOff`.
- **Schedule/hours:** `getMySchedule`, `getMyHours` (daily summaries + totals), `getCurrentPayPeriod` (bi-weekly from 2024-01-01), `getMyAssignedSchedule`, `getMyTimeCorrections`.
- **Time clock:** `clockIn` (checks schedule template, 5-min grace, records GPS + attendance, notifies managers if late), `clockOut`, `startBreak`, `endBreak`, `getCurrentTimeEntry`.
- **Pay & announcements:** `getMyPayStubs`, `markPayStubViewed`, `getActiveAnnouncements`, `markAnnouncementRead`.
- **Overtime:** `getAvailableOvertimeCount` (targetType all/department/location/specific, maxSlots).
- **Mobile:** `registerPushToken` (Expo push token on the user record).

### Tables (read/written)

`personnel`, `timeOffRequests`, `callOffs`, `shifts`, `timeEntries`, `attendance`, `timeCorrections`, `payStubs`, `announcements`, `announcementReads`, `overtimeOffers`, `overtimeResponses`, `notifications`, `users`. (These belong primarily to the HR/Time cluster; the portal is the employee-facing read/write surface.)

### Notable logic / gotchas

- Clock-in reads `personnel.defaultScheduleTemplateId` → `scheduleTemplate.departments[0].startTime`; skips weekends; 5-min grace; computes `minutesLate` and writes an `attendance` row (`on_time`/`grace_period`/`late`).
- `clockOut` throws if not clocked in or currently on break.
- GPS coordinates captured on clock in/out; late arrivals notify managers.

---

## Appendix — Cross-cutting integrations

| Integration | Where | Notes |
|-------------|-------|-------|
| **AWS IoT Core** | Scanner MDM | Thing group `ietires-scanners`, per-device certs, MQTT cmd/telemetry/shadow topics |
| **AWS Lambda (SAM)** | `aws/scanner-mdm/` | 5 Python Lambdas behind API Gateway `7brylwlei6…/prod` |
| **AWS Lambda (LibreOffice)** | `aws/office-to-pdf/` | Private Office→PDF + thumbnail conversion; secret `CONVERT_SECRET` / `PREVIEW_PDF_SECRET` |
| **AWS S3** | Scanners + Doc Hub | `ietires-scanner-assets` (APKs/certs), `iecentral-dochub` (large uploads) |
| **AWS Secrets Manager** | Scanner Lambdas | `scanner-mdm/convex-credentials` (`convex_deploy_key`, `webhook_secret`) |
| **Convex storage (`_storage`)** | Doc Hub, safety photos | File proxy via `/api/documents/file`; thumbnails; EXIF-stripped photos |
| **Anthropic Claude** | `convex/aiTasks.ts` | `claude-sonnet-4-20250514`, env `ANTHROPIC_API_KEY`, keyword fallback |
| **Resend (email)** | `convex/safetyReports.ts` | Super-admin alert emails |
| **Expo push** | `convex/employeePortal.ts` | Mobile notifications via stored push tokens |
| **`@yume-chan/adb` (WebUSB)** | Scanner setup wizard | Browser-side ADB device automation (Chrome) |

### Common env vars

`SCANNER_MDM_API_GATEWAY_URL`, `NEXT_PUBLIC_CONVEX_URL`, `PREVIEW_PDF_SECRET`, `CONVERT_SECRET`, `OFFICE_PDF_LAMBDA_FUNCTION`, `OFFICE_PDF_AWS_REGION` / `S3_REGION`, `OFFICE_PDF_AWS_ACCESS_KEY_ID` / `OFFICE_PDF_AWS_SECRET_ACCESS_KEY`, `DOCHUB_S3_BUCKET`, `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, `ANTHROPIC_API_KEY`.
