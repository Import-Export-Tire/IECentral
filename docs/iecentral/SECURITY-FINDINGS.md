# IECentral — Backend Authorization Findings

**Date:** 2026-06-22 · **Scope:** Convex backend (`convex/*.ts`) + the Next API routes that call it.

## Summary

IECentral's auth model is **"userId-arg-based"**: clients call Convex functions and pass a
`requestingUserId`; each handler is responsible for verifying that user's authority (helpers in
`convex/authGuards.ts`). Convex's built-in identity (`ctx.auth`) is not wired up. **Every
`query`/`mutation`/`action` is callable by any anonymous client** — function names ship in the
browser bundle — so a handler with no guard is wide open. `internalQuery`/`internalMutation`/
`internalAction` are *not* client-callable and are safe.

A full read of the backend (665 mutations across ~90 files; ~195 guard call-sites in 21 files)
confirms the prior `RBAC_AUDIT*.md` conclusion: **authorization is enforced on a minority of the
backend.** The original audit's headline example (`auth.updateUser` self-promotion) is **stale** —
that handler now calls `requireAdmin`. But many other sensitive endpoints remain unguarded,
including several that leak secrets to anonymous callers.

> All items below were verified by reading the actual handlers. `file:line` is point-in-time
> (branch `main`, this date).

---

## Fixed in this pass

| # | Function | Was | Fix |
|---|---|---|---|
| 1 | `auth.seedSuperuser` | public mutation — anon could create an admin or **overwrite any user's password + set role admin** (account takeover) | → `internalMutation` (commit `0ab7657`) |
| 2 | `auth.setForcePasswordChange` | public mutation, patches any userId, no check | → `internalMutation` |
| 3 | `auth.setRequiresDailyLog` | public mutation, patches any userId, no check | → `internalMutation` |
| 4 | `quickbooks.generateQwcFile` | public query — returned QBWC username + plaintext password in the `.qwc` payload | → `internalQuery` (no app callers) |
| 5 | `zoomAccounts.getWithCredentials` | public query — returned any user's Zoom OAuth tokens | → `internalQuery` (+ repointed the `zoomMeetings` action to `internal.*`) |
| 6 | `documentFolders.getFolderWithPassword` | public query — returned folder `passwordHash` (offline brute-force) | → `internalQuery` (+ in-file callers) |
| 7 | `documentFolders.getDocumentsInternal` | public query — **bypassed folder password/access control**, returned every doc in any protected folder | → `internalQuery` (+ in-file callers) |

All fixes were verified to have no external (Next-route) callers; `convex` typechecks clean.

---

## Open — CRITICAL (anonymous secret disclosure / control). Fix next.

These return secrets or grant control to any anonymous caller. Most are **queries that power admin
UI screens**, so the fix is *not* a simple `internalQuery` flip — it's "strip the secret fields
from the public query and add a guarded variant for the admin screen," or add a server-secret gate.

| Function | Exploit | Recommended fix |
|---|---|---|
| `locations.list` / `listActive` / `get` / `getByName` | Returns every location's `pinCode`, `alarmCode`, `gateCode`, `wifiPassword`, `securityNotes` | Strip secret fields from the public query; add `requireAdmin` variant for the admin screen |
| `equipment.listComputers` / `getRemoteAccessComputers` | Returns every computer's `adminPassword`, `userPassword`, `remoteAccessCode`, usable Chrome Remote URL | Same: strip secrets from public query, guarded variant for admin |
| `deletedRecords.getDeletedRecords` / `getDeletionAuditLog` | Returns full JSON snapshots of soft-deleted users/personnel/equipment — **incl. deleted computers' passwords** | Add super_admin guard (the delete/restore mutations here already gate on `ctx.auth`) |
| `auditLogs.log` | Anon can **forge audit-log entries** with arbitrary userId/email/details | Make `internalMutation`, or guard; logging should be server-initiated |
| `scannerMdm.logScannerCommand` | Anon can issue arbitrary commands (lock/wipe) to any scanner | Add `requireAdmin`; verify caller |
| `quickbooks.saveConnection` | Anon overwrites the active QB Web Connector username/password (hijack payroll sync) | `requireAdmin(ctx, args.userId)` |
| `ftpConnections.getWithCredentials` | Public query (used by `ftp-sync`/`ftp-list` server routes) leaks **encrypted** password + host/user to anon. `ftp-list` route itself has **no auth** | Gate the query behind a shared service secret; require auth on `app/api/reports/ftp-list` |

---

## Open — HIGH (cross-user PII / financial / destructive, no caller check)

Grouped; all are public and unguarded unless noted. Fix = add the cited guard (or `internalMutation`
for pipeline-only writes).

**Payroll / time / financial approval bypass**
- `timesheetApprovals.approvePayPeriod` (+ `lockPayPeriod`, `unlockPayPeriod`, `markExportedToQB`) — anon approves/locks a pay period → `requireRole([... ,"payroll_manager"])`
- `quickbooks.exportPayPeriodToQB`, `quickbooks.approveTimeExport` — anon queues payroll to QB → `requireAdmin`
- `timeClock.editEntry` / `deleteEntry` / `addMissedEntry` / `reviewCorrection` — anon fabricates/edits/deletes anyone's punches → `requireManagePersonnel`
- `timeOffRequests.approve` / `deny` — anon approves PTO + mutates balances → `requireManagePersonnel`
- `wtdCommission.saveReport`, `dealerRebates.setRebateMonthly` / `deleteManualUploadsFromMonth`, `reportData.deleteByUploadId` — anon overwrites/destroys financial/report data → `internalMutation` or `requireAdmin`
- `jmkUploads.setUploadAccess` — anon grants self report-upload access → `requireAdmin`
- `ftpConnections.create` / `update` — anon writes FTP creds / redirects sync → `requireAdmin`

**HR records (cross-user write/delete)**
- `attendance.upsert` / `bulkCreate` / `remove` / `createWriteUpFromAttendance`
- `writeUps.create` / `update` / `remove`
- `merits.create` / `update` / `remove`
  → all `requireManagePersonnel` (add a `requestingUserId` where missing)

**Confidential HR data disclosure / destruction**
- `exitInterviews.list` / `getById` / `getByPersonnel` / `getAnalytics` / `generateAISummary` — leak confidential exit-interview responses → guard with super_admin (matches existing `complete`/`signOff`)
- `exitInterviews.remove` / `decline` / `resetToPending` / `resetAllToPending` — anon destroys exit interviews (mass-wipe) → super_admin guard
- `surveys.deleteCampaign` (+ `getRecentResponses`) — destroys/leaks anonymous survey responses → guard
- `employeePortal.getMyPayStubs` — anon reads any employee's pay stubs by personnelId → ownership check

**Documents / Doc Hub**
- `documents.getDownloadUrl` / `getFileDownloadUrl` — return a live download URL for any document/storage id, bypassing visibility → enforce ownership/visibility
- `documentFolders.grantAccess` / `setPassword` / `update` (private→community) / `remove` / `moveDocument` / `moveFolder` — anon grants self access, resets folder passwords, exposes/deletes folders → owner/manager check
- `onboardingDocuments.deleteDocument` (+ `getDocumentUrl`, `getSignaturesForDocument`) — anon deletes onboarding docs + signatures → `requireAdmin`
- `offerLetters.*` (create/createAndSend/send/withdraw/remove) — anon creates/sends/deletes offer letters + candidate emails → guard

**Messaging / comms (read private / impersonate / destroy)**
- `messages.getMessages` — anon reads any DM/group thread; `messages.sendMessage` — forge as any user; `messages.deleteConversation` — delete any thread → participant/identity checks
- `employeeChat.deleteRoom` / `createRoom` / moderation (`approveMessage`/`rejectMessage`/`bulkApprove`) / `sendMessage` → `requireManagePersonnel` / identity check
- `broadcastMessages.create` / `update` / `remove` — anon posts site-wide banners (phishing) → `requireManagePersonnel`
- `meetingNotes.updateTranscript` / `updateNotes` / `updateStatus` / `create` — anon corrupts any meeting's notes → host/participant check
- `techWizardChats.getById` / `addMessage` / `remove` — read/append/delete any user's AI chat → ownership check
- `zoomAccounts.createOrUpdate`, `zoomMeetings.createZoomMeeting` — anon plants/uses any user's Zoom tokens, gets host start URL → ownership check

**Other PII dumps (queries)**
- `dealerInquiries.getAll` (+ getRecent/byStatus/byAssignee/byId) and `remove`/`update` — dump/delete all sales leads → `requireAdmin`
- `contactMessages.getAll` (+ variants) and `remove` — dump/delete all website contact submissions → `requireAdmin`

**Field / devices**
- `scannerMdm.provisionScanner` / `deprovisionScanner` (+ `upsertMdmConfig`) — anon provisions/hijacks device identity, edits provisioning Wi-Fi/APK config → `requireAdmin`
- `projects.remove` (cascades to tasks), `tasks.remove` — anon deletes any project/task → owner/admin check
- `employeePortal.reviewTimeOffRequest` / `acknowledgeCallOff` / `clockIn`(+out/break) / `registerPushToken` — manager actions + time-fraud + push hijack without checks → ownership/manager checks
- `webPush.subscribe`, `notifications.create` — bind push endpoint to / spam any user → ownership check / internal

---

## Open — MEDIUM / LOW (selected)

- `systemBanners.create` / `update` / `toggle` / `remove` — anon site-wide banners (phishing) → `requireAdmin`
- `documentSignatures.sign` — caller not verified == signer → **legal signatures forgeable** → identity check
- `mileage.update` — edits any user's mileage reimbursement (no ownership check)
- `savedReports.remove`, `jmkUploads.deleteUpload`, `inventoryAdjustments.add`/`remove`
- `attendance.detectMissedShifts` — anon triggers no-show records + manager notification spam → `internalMutation`
- `scratchpad.getByCode` / `deleteCode` — 4-digit code, no rate-limit → brute-forceable (may hold pasted secrets) → longer code + rate-limit
- `documentFolders.verifyPassword` — no brute-force rate-limiting
- `dailyLogs.unlockLog` / `submitOnBehalf` — admin actions without role guard
- `holidays.*`, `shiftTemplates.*`, `groups.*`, `dashboardSettings.*` — unguarded config writes (low impact)
- `emails.testExitInterviewEmail` — public action; can send a company-branded email to any address (spam)

### Confirmed safe / by-design (not findings)
`personnel.*` and `employeeReviews.*` mutations (guarded); `announcements.*`, `events.*`,
`training.*` (guarded); `credentials.*` (super_admin-gated); `pushNotifications.*` (internal);
`safetyReports` reads (super_admin); `safetyReports.submit` + `documentFolders.getProtectedDocuments`
+ `applications.submitApplication` + `jobs.getActiveJobs` + `documents.getPublicBySlug` (public by
design); `deletedRecords` delete/restore mutations (gate on `ctx.auth`, fail closed).

---

## Recommended remediation approach

The root cause is structural — guards are opt-in per handler. Suggested order:

1. **Stop the bleeding (CRITICAL secret leaks)** — the items in the CRITICAL table. For UI-feeding
   queries, strip secret fields from the public query and add a guarded admin variant.
2. **Lock down financial + HR-record writes** (HIGH) with `requireAdmin` / `requireManagePersonnel`
   / `requireRole`, adding a `requestingUserId` arg where one is missing.
3. **Convert pipeline-only writes** (report-data deletes, `detectMissedShifts`, `auditLogs.log`) to
   `internalMutation`.
4. **Ownership checks** for self-service resources (messages, push tokens, AI chats, signatures).
5. **Systemic guardrail:** consider a lint/CI check that fails when a non-`internal*` `mutation`/
   `action` in a sensitive file doesn't call a `require*` guard, so new gaps can't be added silently.

This is a multi-session effort (dozens of endpoints, many feeding live UI that needs per-endpoint
testing). Prioritize 1–2 first; they are the genuinely dangerous, remotely-exploitable items.
