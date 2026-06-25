# IECentral — HR / Time / Payroll

Internal people-operations cluster for **Import Export Tire Co** ("IE Tire"). Stack: **Next.js 15 (App Router)** front end, **Convex** reactive backend (`convex/*.ts`, schema in `convex/schema.ts`), with one **AWS-adjacent SOAP integration** to QuickBooks Desktop via the QuickBooks Web Connector (QBWC).

This document covers the modules that run the daily life of an hourly/salaried employee from the company's side: the **Personnel record** (the spine of everything), the **time clock** and its **timesheet → payroll → QuickBooks** pipeline, **scheduling/shifts**, **overtime offers**, **time-off / PTO**, **call-offs**, **holidays**, **pay stubs / payroll companies**, and **mileage / expense reimbursement**.

> **Point-in-time disclaimer.** This document describes the code as it stood when last verified against source on **2026-06-25** (original draft 2026-06-22). `file:line` citations are accurate as of then; line numbers drift as files change, so treat them as starting points, not guarantees.

```
Personnel (the employee record)
  ├─ Attendance / Write-ups / Merits / Call logs / Reviews / Training / Tenure check-ins
  ├─ Time Clock (clock in/out/break) ──► raw timeEntries
  │     └─ Timesheet Approvals (CFO: pending→approved→locked) ──► QuickBooks export (QBWC)
  ├─ Shifts (daily whiteboard) ◄── Shift Templates ; Schedule Overrides ; Schedule Templates (hours)
  ├─ Overtime offers ; Time-off requests ◄──► PTO balances/policies ; Call-offs ; Holidays
  ├─ Pay Stubs (per employee) ; Payroll Companies (multi-entity)
  └─ Mileage ; Expense Reports (reimbursement workflows)
```

> **Cross-cutting RBAC note.** Most mutations are guarded by helper functions defined in `convex/authGuards.ts`: `requireManagePersonnel`, `requireAdmin`, `requireRole(ctx, userId, [...])`. App pages gate on permission booleans from `app/auth-context.tsx` (e.g. `canManagePersonnel`, `canManageTimeOff`, `canManageCallOffs`, `canViewShifts`/`canEditShifts`) and tier (`minTier={4}` = admin for `/payroll`). Several role lists are hardcoded inside individual functions (see each module).

---

## 1. Personnel

### Purpose
The master employee record and the foreign key that nearly every other table points at (`personnelId`). Owns hiring, termination/rehire, the 90-day & annual review cycle, onboarding tenure check-ins, training records, temp/staffing-agency eligibility, phone call logs, disciplinary write-ups, merits, attendance, and schedule assignment.

### App routes
| Route | File | Purpose |
|-------|------|---------|
| `/personnel` | `app/personnel/page.tsx` | Roster list — filter by dept/status, search, "temps only" toggle, live clock-status dot, inline location selector, collapsible terminated section, stats bar |
| `/personnel/new` | `app/personnel/new/page.tsx` | Manual create form (basic + employment + temp fields + emergency contact + notes) |
| `/personnel/[id]` | `app/personnel/[id]/page.tsx` (~4,390 lines) | Full record hub — tabs: **Profile, Write-Ups, Attendance, Merits, Equipment, Safety**; plus reviews, tenure check-ins, termination/rehire, schedule assignment/overrides, portal login, training |
| `/personnel/import` | `app/personnel/import/page.tsx` | XLSX/CSV bulk upsert wizard (Upload → Map columns → Preview → Done) |
| `/personnel/reviews` | `app/personnel/reviews/page.tsx` | **Deprecated** — redirects to `/reports/ninety-day-reviews` |

### Backend
- **`convex/personnel.ts`** (2,102 lines). Selected exports:
  - Reads: `list`, `getById`, `getWithStats` (write-up/merit/attendance roll-ups: active write-ups = last 60 days, attendance stats = last 30 days), `getByApplicationId`, `getDepartments`, `getPendingTenureCheckIns`, `searchByEmailOrName`, `getByScheduleTemplate`, `getScheduleOverrides`, `getPendingScheduleOverrides`.
  - Hiring/lifecycle: `createFromApplication`, `create`, `bulkImport`, `bulkUpsert`, `remove` (super-admin hard delete, cascades to writeUps/attendance/merits/performanceReviews), `terminate`, `rehire`, `clearTermination`, `convertTempToHire`.
  - Reviews: `markNinetyDayReview` / `clearNinetyDayReview`, `markAnnualReview` (upsert by `cycleYear`) / `clearAnnualReview`, `setReviewExclusion`.
  - Tenure: `recordTenureCheckIn`, `removeTenureCheckIn`, `setAllTenureCheckInsComplete`, `bulkCompleteTenureCheckIns`, `clearAllTenureCheckIns`.
  - Training: `toggleTraining` (maintains both `trainingRecords[]` and legacy `completedTraining[]`).
  - Call logs: `logCall`, `getCallLogs`, `getRecentCallLogs`, `deleteCallLog`.
  - Schedule: `updateScheduleAssignment`, `clearScheduleAssignment`, `bulkAssignSchedule`, `createScheduleOverride`, `approveScheduleOverride`, `denyScheduleOverride`, `deleteScheduleOverride`.
  - Maintenance: `removeDuplicates`, `updateResumeAndAnalysis`.
- **`convex/attendance.ts`** (864 lines) — attendance records and the auto-write-up engine (below).
- **`convex/merits.ts`** (173 lines) — `listByPersonnel`, `listAll`, `getById`, `listRecent`, `create`, `update`, `remove`.

### Data tables
| Table | Schema | Key fields / notes |
|-------|--------|--------------------|
| `personnel` | L459 | Identity, `position`/`department`, `locationId`, `payrollCompanyId`, `employeeType` (full_time/part_time/seasonal/**temp**), `positionType` (hourly/salaried/management — execs visible only to payroll_manager), `hourlyRate`, `status` (active/on_leave/terminated), `hireDate`/`originalHireDate`, `excludeFromReviews`, temp fields (`staffingAgency`, `tempEligibilityMode` days/hours, `tempEligibilityValue`, `tempEligibleDateOverride`), nested `ninetyDayReview`, `annualReviews[]` (keyed by `cycleYear`), `trainingRecords[]`/`completedTraining[]`, `tenureCheckIns[]`, `employmentHistory[]`, `defaultScheduleTemplateId`, `schedulePreferences`, `jobMatchAnalysis`. Indexes: `by_department`, `by_status`, `by_email`, `by_schedule_template`. |
| `personnelCallLogs` | L565 | `calledAt`, `calledBy`/`calledByName`, `outcome` (answered/no_answer/voicemail/busy/wrong_number), `duration`, `notes`. |
| `writeUps` | L580 | `category`, `severity` (verbal_warning/written_warning/final_warning/suspension), `followUpRequired`, `acknowledgedAt`, `isArchived` (90-day rule), `attachments[]` (`_storage`). |
| `attendance` | L608 | `status` (present/on_time/grace_period/late/absent/excused/no_call_no_show), scheduled vs actual times, `hoursWorked`, `minutesLate`, `wasWithinGrace`, `timeEntryId` link, `linkedWriteUpId`, `attachments[]`. Indexes incl. `by_personnel_date`. |
| `merits` | L642 | `type` (performance/attendance/teamwork/safety/customer_service/initiative), `title`, `description`, `issuedBy`. |

### Key workflows & notable logic
- **Write-up progression (auto-severity).** `attendance.createWriteUpFromAttendance` counts attendance-category write-ups in the **last 6 months** and escalates: 0 prior → `verbal_warning`, 1 → `written_warning`, 2 → `suspension`, 3+ → `termination`. It writes a `writeUps` row and back-links `attendance.linkedWriteUpId`. (Note the UI label in `app/time-clock` shows "final warning" at the 3rd step; the backend constant is `suspension`.)
- **90-day archive rule.** Write-ups carry `isArchived`; they expire/stop counting toward incentives ~90 days after `date` (auto-set, manually overridable).
- **Termination is heavy.** `terminate` sets status + reason, **auto-deactivates linked department_manager user accounts**, auto-creates an `exitInterviews` record with a **7-day reversibility window**, schedules a calendar event ~7 business days out, and sends the exit-interview email. `rehire` restores from terminated only, pushes the prior stint into `employmentHistory[]`, preserves `originalHireDate`, and reactivates the user account.
- **Reviews.** 90-day review is a single object; annual reviews are an array upserted by `cycleYear`. `excludeFromReviews` skips corporate/management. (Insurance eligibility computed in UI as the 1st of the month *following* the 60-day mark; vacation eligibility at 365 days.)
- **Tenure check-ins.** Milestones `1_day / 3_day / 7_day / 30_day / 60_day`; `getPendingTenureCheckIns` flags overdue ones and **skips temps**.
- **Temp → hire.** `convertTempToHire` flips `employeeType`, sets a new `hireDate`, clears the temp eligibility fields, and keeps `staffingAgency` for history.
- **Profile sync.** Updating a personnel record syncs name and managed-scope (`managedLocationIds` for warehouse_manager, `managedDepartments` for department_manager) onto the linked `users` account.
- **Bulk import.** `bulkUpsert` matches existing rows by `firstName + lastName + hireDate` (trimmed, case-insensitive); resolves `locationName` → `locationId` by case-insensitive lookup and returns `unknownLocations[]`. The wizard auto-detects headers, parses Excel serial / `MM/DD/YYYY` / ISO dates, and can split "Last, First MI" names (suffixes stripped).
- **Live clock status** on the roster is reconstructed from `timeEntries` (`attendance.getTodayLive`), and **role-filters who you can see**: warehouse_manager → only hourly employees in their managed locations; payroll_manager/admin/super_admin → everyone; others → only hourly (salaried/management hidden).
- **Gotcha:** `getTodayLive`/`getIssues` filter by role at query time, so the same page renders different rosters per user — expected, not a bug.

---

## 2. Time Clock & Time Entries

### Purpose
Capture raw punch events (`clock_in`, `clock_out`, `break_start`, `break_end`) from kiosk/mobile/admin, detect lateness against the employee's schedule, derive worked hours with 15-minute rounding, and provide a manager dashboard plus an employee-driven time-correction workflow.

### App routes
| Route | File | Purpose |
|-------|------|---------|
| `/time-clock` | `app/time-clock/page.tsx` | Manager dashboard. Tabs: **Live Status, Attendance Issues, Daily View, Corrections**. Stats bar (clocked-in, on-break, late today, grace-period, total hours, needs-action). Add/edit/delete entries, force clock-out, review corrections, create write-ups from issues. |

### Backend
- **`convex/timeClock.ts`** (1,252 lines).
  - Reads: `getCurrentStatus`, `getActiveClocks`, `getEntriesByDate`, `getEntriesByPersonnel`, `getDailySummary`, `getPendingCorrections`, `getCorrections`, `getAllClockStatuses`, `getManagerDashboard(locationId?)`, `canEditTimeEntry(date)` (lock check).
  - Punches: `clockIn` (with `source`, optional `gpsCoordinates`, `bypassScheduleCheck`), `clockOut`, `startBreak`, `endBreak`.
  - Manager edits: `editEntry`, `deleteEntry`, `addMissedEntry`, `forceClockOut` — all stamp `editedBy`/`editedAt`/`originalTimestamp`/`editReason`.
  - Corrections: `requestCorrection` (employee), `reviewCorrection` (manager approve/deny → applies edit/add/delete).
  - Internal: `sendLateAlert` (action), `getLateAlertRecipients`, `checkLatePattern`.
- **`convex/timesheetApprovals.ts`** (608 lines) — pay-period rollup and lock (see §3).

### Data tables
| Table | Schema | Notes |
|-------|--------|-------|
| `timeEntries` | L1501 | `type`, `timestamp` (ms), `source` (admin/mobile/kiosk), `locationId`, `gpsCoordinates`, lateness (`scheduledStart`, `minutesLate`, `isLate`), edit-tracking fields. Indexes incl. `by_personnel_date`. |
| `timeCorrections` | L1529 | `requestType` (edit/add_missed/delete), current vs requested timestamp, `requestedType`, `reason`, `status`, review fields. |

### Key workflows & notable logic
- **Schedule resolution on clock-in.** Looks up today's specific `shift` first, then falls back to the employee's `defaultScheduleTemplateId`, matching by department or assigned-personnel list, to get `scheduledStart`.
- **Grace period = 5 minutes** (`GRACE_PERIOD_MINUTES = 5`). Clock-in **before** scheduled start is blocked; `isLate = minutesLate > 5`. A late punch can trigger `sendLateAlert` push notifications.
- **Late-pattern flag:** `checkLatePattern` flags an employee with **>1 late clock-in in the last 7 days**.
- **Hours computation (the canonical algorithm, reused by payroll/QB):** the reference implementation is `calculateHoursFromEntries` in `timesheetApprovals.ts:255`. Per day: sort the day's entries by `timestamp`; sum `clock_out − clock_in` spans into `workMinutes`; sum matched `break_start`/`break_end` spans into `breakMinutes`; `netMinutes = max(0, workMinutes − breakMinutes)`; then **round each day to the nearest 15 min** via `roundToQuarterHour` (`timesheetApprovals.ts:6`) *before* summing days. OT is computed on the **summed, already-rounded total**: `regularHours = min(total, 40)`, `overtimeHours = max(0, total − 40)` (`timesheetApprovals.ts:335`). There is **no daily-8 OT rule**.
- **OT window subtlety — "weekly >40" is only true week-by-week.** `calculateHoursFromEntries` is invoked with whatever date span its caller passes. The payroll UI passes a **whole 14-day pay period** (`getPayPeriodDetails`/`approvePayPeriod`), so the "over 40" cut is applied **once across all 14 days**, not per ISO week — an employee with 30 h + 30 h in the two weeks shows 40 reg / 20 OT, not 60 reg / 0 OT. The QB **granular** export path (`calculatePendingTimeExports`) is the only place that genuinely slices Sun→Sat weeks; the QB **bulk** path inherits the same whole-period behavior (see §4). Treat the "40" threshold as *per call span*, and know the two payroll surfaces disagree on what that span is.
- **Two near-identical hour calculators exist.** `timeClock.getDailySummary` rounds the *whole day's* `workMinutes` once (`timeClock.ts:56`) for the live dashboard, while `calculateHoursFromEntries` rounds per day and re-sums; `quickbooks.ts` has yet a third inline copy (it does **not** round to quarter-hours at all — see §4). These can differ by a few minutes on the same data; the approval/lock figures (`timesheetApprovals.ts`) are the ones that gate payroll.
- **Correction loop:** employee `requestCorrection` (pending) → manager `reviewCorrection`; on approve it patches/inserts/deletes the underlying `timeEntries` row and records `reviewedBy`/`reviewedAt`/`reviewNotes`.
- **Lock enforcement:** `canEditTimeEntry(date)` consults `timesheetApprovals`; if the covering period is `locked`, edits are refused ("locked for payroll").
- **Late-alert recipients (hardcoded role list):** `super_admin`, `admin`, `warehouse_director`, `coo`, plus the location's `managerId` — must be `isActive` with an `expoPushToken`.
- **Gotcha:** if `break_end` is missing the break minutes are never subtracted (break time lost); an orphan `clock_out` with no `clock_in` is ignored.

---

## 3. Timesheet Approvals & Payroll

### Purpose
Bi-weekly pay-period rollup and the CFO/payroll lock workflow that gates QuickBooks export. Also the pay-stub store and multi-company payroll structure.

### App routes
| Route | File | Purpose |
|-------|------|---------|
| `/payroll` | `app/payroll/page.tsx` (~719 lines, `minTier={4}` admin) | Company selector, pay-period list with status badges (in_progress/pending/approved/locked), per-employee daily breakdown + issue flags, and modals to **Approve**, **Lock for Payroll**, and **Export to QuickBooks**. Company-create modal. |

### Backend
- **`convex/timesheetApprovals.ts`** (608 lines): `getPayPeriods(payrollCompanyId?)`, `getPayPeriodDetails(...)`, `approvePayPeriod`, `lockPayPeriod`, `unlockPayPeriod` (admin override), `markExportedToQB`, `canEditTimeEntry`. Plus the shared hours helpers `getPayPeriodFromDate` / `calculateHoursFromEntries`.
- **`convex/payrollCompanies.ts`** (266 lines): `getAll`, `getById`, `getCompanyEmployees`, `getAllDepartments`, `getUnassignedEmployees`, `create`, `update`, `deactivate`, `assignEmployee`, `unassignEmployee`, `bulkAssignByDepartment`. **All mutations require `requireAdmin`** (no separate `payroll_manager` role enforced here).
- **Pay stubs** live in **`convex/employeePortal.ts`**: `getMyPayStubs(personnelId)` and `markPayStubViewed(payStubId)`. (There is no create/upload mutation wired in — `payStubs` are populated by import/QB sync; `source` ∈ manual/quickbooks/import.)

### Data tables
| Table | Schema | Notes |
|-------|--------|-------|
| `timesheetApprovals` | L1773 | `payPeriodStart`/`End`, optional `payrollCompanyId`, `status` (pending/approved/locked), summary stats, `issueCount`, `lockedAt`/`lockedBy`, `exportedToQB`/`exportedAt`. Index `by_company_period`. |
| `payrollCompanies` | L1754 | `code` (unique), `departments[]`, optional `qbCompanyName`/`qbConnectionId`, custom `payPeriodReference`/`payPeriodDays`, `isActive`. |
| `payStubs` | L1715 | hours/pay/`deductions[]`, optional PDF (`fileId`), `source`, `externalId` (QB), `employeeNotifiedAt`/`employeeViewedAt`. |

### Key workflows & notable logic
- **Pay period math:** anchor `PAY_PERIOD_REFERENCE = 2024-01-01`, **14-day** periods. `getPayPeriodFromDate` (`timesheetApprovals.ts:15`) floors `(date − anchor)/14days` to a `payPeriodNumber`, then derives `startDate`/`endDate` (`start + 13`). Periods are **computed, never stored**, until an approval row is created — `getPayPeriods` synthesizes a status of `in_progress` (future/current) or `pending` (past) for any period lacking an approval row (`timesheetApprovals.ts:83`).
- **Approval state machine** (status lives only on the `timesheetApprovals` row; absence = unmanaged):

  | From | Mutation | Guard | To | Side effects |
  |------|----------|-------|----|--------------|
  | *(none)* / `pending` | `approvePayPeriod` | recomputes totals from live entries | `approved` | upserts the row; stamps `approvedBy`/`approvedAt`, `totalEmployees`, `totalRegularHours`/`totalOvertimeHours`/`totalHours` |
  | `approved` | `lockPayPeriod` | throws unless current status is exactly `approved` | `locked` | `lockedAt`/`lockedBy`; from here `canEditTimeEntry` refuses edits |
  | `locked` | `unlockPayPeriod` | admin escape hatch (no status precondition) | `approved` | clears `lockedAt`/`lockedBy` |
  | `locked` | `markExportedToQB` | throws unless `locked` | *(stays `locked`)* | sets `exportedToQB=true`/`exportedAt` (a flag, not a status) |

  `approvePayPeriod` is **idempotent/re-runnable** — re-approving an already-`approved` (or even `locked`) row patches it back to `approved` with freshly recomputed totals, silently un-doing a lock. `exportedToQB` is also set directly by `exportPayPeriodToQB` (§4), so the `/payroll` "Export" button never calls `markExportedToQB`.
- **Issues flagged** per employee (`getPayPeriodDetails`): pending-correction count, and **missing clock-out** (the last entry of any day is a `clock_in`/`break_start`). Call-off days are surfaced separately (`callOffDays`) and an employee is included in the period view if they have any hours **or** any issue **or** any call-off (`timesheetApprovals.ts:225`). `issueCount`/`totalIssues` aggregate these.
- **Multi-company scoping:** company-scoped reads/approvals filter personnel by **direct `payrollCompanyId` first, then department membership** in the company's `departments[]` (`timesheetApprovals.ts:125`). Company-scoped rows use index `by_company_period`; the "all companies" view filters `payrollCompanyId === undefined` (legacy/default bucket).
- **Multi-company gotcha:** `canEditTimeEntry`, `markExportedToQB`, `getPayPeriodDetails`'s `approval` lookup, and `exportPayPeriodToQB` all query **`by_pay_period` `.first()` with no company filter**. With two companies running the *same* pay-period start, the lock/edit/export check resolves to whichever approval row the index returns first — i.e. a lock on Company A can spuriously block (or fail to block) edits attributed to Company B. The fully company-aware paths are `getPayPeriods`, `approvePayPeriod`, `lockPayPeriod`, `unlockPayPeriod`.
- **Gotcha:** the schema groups `payrollCompanies` and `timesheetApprovals` adjacently with a slightly misplaced comment header; they are distinct tables.

---

## 4. QuickBooks Integration (QBWC, end-to-end)

### Purpose
Push approved time to **QuickBooks Desktop** (and read its employee list) using the **QuickBooks Web Connector** SOAP protocol. QuickBooks Desktop runs a Web Connector service on a Windows machine that polls a public endpoint on a schedule; IECentral answers with QBXML work to run inside QuickBooks.

```
QuickBooks Desktop ──(Web Connector, every N min)──► POST /api/qbwc (SOAP)
   route.ts parses SOAP ──► Convex (convex/quickbooks.ts) ──► qbSyncQueue / qbPendingTimeExport
   ◄── QBXML request to run in QB ──► QB executes ──► QBXML response ──► Convex updates state
```

### App route / backend files
| File | Role |
|------|------|
| `app/api/qbwc/route.ts` | SOAP 1.1 endpoint (`maxDuration: 120`). Manual regex XML parsing (no SOAP lib). `POST` dispatches by method name via a `switch`; `GET` returns a plain info/HTML page (**no generated WSDL**). |
| `convex/quickbooks.ts` (933 lines) | All session/queue/mapping/log/export queries+mutations and QBXML generators. |
| `app/settings/quickbooks/page.tsx` | Config UI (connection, employee mapping, .QWC download). Access: `super_admin`/`admin` only. |
| `app/payroll/page.tsx` | Triggers `exportPayPeriodToQB`. |

### Data tables
| Table | Schema | Notes |
|-------|--------|-------|
| `qbConnection` | L1977 | `wcUsername`/`wcPassword` (see gotcha), sync toggles (`syncTimeEntries`/`syncPayStubs`/`syncEmployees`/`autoSyncEnabled`), `syncIntervalMinutes`, `connectionStatus`, `qbVersion`, `lastError`. |
| `qbEmployeeMapping` | L2004 | personnel ↔ QB `qbListId`/`qbName` (+`qbEditSequence`), `isSynced`. |
| `qbSyncQueue` | L2021 | `type`/`action`/`referenceId`/`referenceType`, `status` (pending/processing/completed/failed), `priority`, `attempts`/`maxAttempts` (default 3), request/response XML. |
| `qbSyncLog` | L2042 | grouped by `sessionId` (the ticket), `operation`/`direction`/`status`/`message`/`errorDetails`/`durationMs`. |
| `qbPendingTimeExport` | L2060 | per-employee per-week aggregate (`weekStartDate` Sun → `weekEndDate` Sat), regular/OT/total hours, `status` (pending/approved/exported/error), `qbTxnId`. |
| `qbwcSessions` | L2452 | ephemeral `ticket`, `username`, `companyFile`, `requestCount`, `lastRequest`, `expiresAt` (**30-min** TTL). |

### Backend function inventory (`convex/quickbooks.ts`)
- **Sessions:** `createQbwcSession`, `getQbwcSession` (expiry-aware), `updateQbwcSession`, `deleteQbwcSession`.
- **Connection:** `getConnection`, `saveConnection`, `updateConnectionStatus`.
- **Mapping:** `getEmployeeMappings`, `getUnmappedPersonnel` (active, non-temp), `createEmployeeMapping`, `updateEmployeeMapping`, `deleteEmployeeMapping`.
- **Queue:** `addToSyncQueue` (dedups on pending `referenceType+referenceId`), `getPendingSyncItems`, `updateSyncQueueItem`.
- **Logs/stats:** `createSyncLog`, `getSyncLogs`, `getSyncStats` (dashboard rollup).
- **Time export:** `getPendingTimeExports`, `calculatePendingTimeExports`, `approveTimeExport`, `markExportCompleted`, `getExportablePayPeriods`, `exportPayPeriodToQB`.
- **QBXML generators (QBXML version 13.0):** `generateTimeTrackingAddXml`, `generateEmployeeQueryXml`, `generatePaycheckQueryXml`, and **`generateQwcFile`** — note this last one is an **`internalQuery`**, not a public query (`quickbooks.ts:570`), with a security comment explaining the `.qwc` payload embeds the QBWC username/password and so must never be client-callable. The settings page must reach it via a server route, not a direct `useQuery`.
- **Queue ordering / dedup:** `addToSyncQueue` dedups against any existing **pending** row with the same `(referenceType, referenceId)` and returns the existing id (`quickbooks.ts:270`); default `priority = 10`. `getPendingSyncItems` reads the `by_status_priority` index and `.take(limit)` — lower `priority` numbers sort first, so the **priority-5** `time_entry` items enqueued by the export paths drain ahead of any default-10 work. `updateSyncQueueItem` increments `attempts` when a row moves to **`failed` *or* `processing`** (`quickbooks.ts:328`), so simply handing an item to QBWC already burns one of its 3 attempts.

### SOAP method sequence (as implemented in `route.ts`)
1. **`serverVersion()`** → returns a server version string.
2. **`clientVersion(strVersion)`** → `""` to accept; returns `"E:..."` and aborts if the connector is older than 2.0.
3. **`authenticate(strUserName, strPassword)`** → compares against the active `qbConnection.wcUsername`/`wcPassword`. On mismatch returns `["", "nvu"]` (not-valid-user). On success: generates a ticket `QBWC-<ts>-<rand>`, creates a `qbwcSessions` row (30-min expiry), sets `connectionStatus="connected"`, logs `connect`, and returns `[ticket, ""]` (`""` = no company-file restriction). (`none`/`nvu`/`busy` are the standard QBWC codes.)
4. **`sendRequestXML(ticket, hcpResponse, companyFile, country, majorVers, minorVers)`** → validates the session; on first call records the company-file path and detected QB version. **Work selection:** pull one pending `qbSyncQueue` item; if a `time_entry` referencing `qbPendingTimeExport`, generate a **`TimeTrackingAddRq`** and mark the item `processing`. If the queue is empty *and* `syncEmployees` is on *and* this is `requestCount === 0`, send an **`EmployeeQueryRq`** instead. If nothing to do, return `""`.
5. **`receiveResponseXML(ticket, response, hresult, message)`** → logs to `qbSyncLog`. If `lastRequest === "employee_query"`, parse `<EmployeeRet>` (`ListID`+`Name`) pairs (used for **manual** mapping — auto-mapping is a stub). Otherwise mark the queue item completed/failed by `hresult` (`""`/`"0"` = success) and store the response XML. Returns a **percent-complete-ish integer**: `"1"`/positive = more work (QBWC loops back to `sendRequestXML`), `"0"` = done, `"-1"` = error.
6. **`connectionError(ticket, hresult, message)`** → sets `connectionStatus="error"`, logs, returns `"done"`.
7. **`getLastError(ticket)`** → returns `""` (no error queue).
8. **`closeConnection(ticket)`** → logs disconnect with `requestCount`, sets `connectionStatus="disconnected"`, deletes the session, returns `"OK"`.

### QBXML payloads
- **`TimeTrackingAddRq`** — `TxnDate` = the export row's `weekEndDate`, `EntityRef/ListID` from the employee mapping, a single `Duration` (ISO-8601 `PT#H#M`, computed from `totalHours` only), `Notes` referencing the IECentral week. **Only `totalHours` is sent** — the `regularHours`/`overtimeHours` split stored on `qbPendingTimeExport` is computed but **never emitted** (QB receives one lump time entry; OT classification has to be done QB-side via the payroll item). Returns `null` (the route then sends `""`, skipping) if the employee has no `qbEmployeeMapping`. `onError="stopOnError"`.
- **`EmployeeQueryRq`** — `ActiveStatus=ActiveOnly`.
- **`PaycheckQueryRq`** — date-range filtered with `IncludeLineItems`. **Generator exists but `receiveResponseXML` does not parse paycheck data — pay-stub import is unimplemented.**
- **`.QWC` config (`generateQwcFile`)** — `AppName`, `AppURL = {appUrl}/api/qbwc`, `UserName`, random `OwnerID`/`FileID`, `QBType=QBFS`, `Scheduler/RunEveryNMinutes = syncIntervalMinutes`, `IsReadOnly=false`. The admin downloads this and imports it into the Web Connector, entering the password manually.

### Two export paths
Both iterate **only over employees who have a `qbEmployeeMapping`** (unmapped staff are silently skipped — there is no warning surfaced) and both recompute hours with an **inline calculator in `quickbooks.ts` that does *not* round to quarter-hours** (`quickbooks.ts:459`, `:855`) — so QB durations can differ by a few minutes from the locked approval totals shown on `/payroll`. Both dedup on `(personnelId, weekStartDate)`, which means the two paths **collide if mixed**: the bulk path stores `weekStartDate = payPeriodStart`, so a later granular run for the first Sun-week of the same period (or vice versa) is suppressed as "already exists."

- **Granular:** `calculatePendingTimeExports(weekStartDate, payPeriodStart?)` is the only true **Sun→Sat weekly** slicer (`weekEndDate = start + 6`). If `payPeriodStart` is passed it requires that period to be **`locked`**. It builds per-week `qbPendingTimeExport` rows in `pending`; `approveTimeExport` flips a row to `approved` and enqueues a priority-5 `qbSyncQueue` `time_entry` item.
- **Bulk (the `/payroll` "Export to QuickBooks" button):** `exportPayPeriodToQB` validates the period is `locked` and not already `exportedToQB`, then for each mapped employee with `totalHours > 0` creates a **single export row spanning the whole 14-day period** (`weekStartDate = payPeriodStart`, `weekEndDate = payPeriodEnd`), status `approved` (auto-approved since locked), immediately enqueues a priority-5 item, and finally sets `timesheetApprovals.exportedToQB = true` directly. Consequence: the `TimeTrackingAdd.Duration` is the **whole-period total** and `TxnDate` is the period end (only a Saturday if the period happens to align), so the "weekly" framing in QBXML is nominal for this path.

### Notable gotchas / design decisions
- **`wcPassword` is stored and compared in plain text** despite the still-present schema comment `// ...(hashed)` at `schema.ts:1982`. `handleAuthenticate` does a literal `connection.wcPassword !== password` string compare (`route.ts:137`). It travels only over TLS but is at-rest plaintext, and `generateQwcFile` returns it verbatim for the `.qwc` download. The comment is stale — there is no hashing anywhere.
- **Manual XML via regex** — `parseSOAPRequest` (`route.ts:27`) extracts the method from the body element and each param via a fixed regex table; fragile for large/edge responses (e.g. the `<response>` capture is non-greedy `[\s\S]*?`). QBXML is always emitted at version **13.0** regardless of the QB version detected on `sendRequestXML`.
- **No background retry / no stuck-item recovery** — there is no cron or scheduled action driving QBWC; everything advances only when the Windows-side connector re-polls. `attempts` is bumped on entering `processing` (not just on failure), so an item left `processing` after a connector crash both **counts against `maxAttempts=3`** and is **never auto-reclaimed** to `pending`.
- **No paycheck import, no auto employee-mapping, `qbTxnId` not persisted back.** `markExportCompleted(exportId, qbTxnId)` exists and *would* write `qbTxnId` + flip the export to `exported`, but `receiveResponseXML` never calls it: it regex-extracts `<TxnID>` from a `TimeTrackingRet` into a local match and then **drops it** in an empty `if` block (`route.ts:284`). So exports stay `approved`, never reach `exported`, and `qbTxnId` is never stored. Employee `processEmployeeQueryResponse` likewise parses `<EmployeeRet>` `ListID`+`Name` pairs but only logs the count — auto-mapping is an explicit "would happen here" stub (`route.ts:329`).
- **Static endpoint expectation:** the connector posts to a fixed `AppURL`; the platform is hosted on Vercel (see `reference_iecentral_deploy`), so the public `/api/qbwc` URL must remain stable for the Windows-side Web Connector config.

---

## 5. Overtime

### Purpose
Offer optional (typically Saturday) overtime to targeted employees and track accept/decline responses, with a slot cap.

### App route / backend
- `app/overtime/page.tsx` — admin offers list + detail pane (responses, send-reminders, close/reopen/cancel/delete) and a create modal (default times **06:00–14:30**, "1.5x for hours over 40/week" note).
- `convex/overtime.ts` (575 lines): `listOffers`, `getOfferById`, `getAvailableOffersForEmployee`, `getEmployeeOvertimeHistory`, `createOffer`, `respondToOffer`, `closeOffer`, `cancelOffer`, `reopenOffer`, `deleteOffer`, `sendReminders`.

### Data tables
| Table | Schema | Notes |
|-------|--------|-------|
| `overtimeOffers` | L1554 | `date`, times, `targetType` (all/department/location/specific), `targetPersonnelIds[]`, `maxSlots`, `payRate`, `status` (open/closed/cancelled). |
| `overtimeResponses` | L1582 | `response` (pending/accepted/declined), `respondedAt`, `notifiedAt`, `reminderSentAt`. Index `by_offer_personnel`. |

### Key workflows & notable logic
- **Lifecycle:** `open → closed | cancelled`, reversible via `reopen` (which patches straight back to `open`). If `sendNotification` is true at create time, `createOffer` resolves the target set (specific list, or active personnel filtered by department/location, or "all") and **pre-creates a `pending` `overtimeResponses` row for each target** so the employee app shows the offer; it also stamps `notificationSentAt`.
- **`payRate` is vestigial.** The schema keeps `overtimeOffers.payRate`, and the create modal shows a "1.5× for hours over 40/week" note, but `createOffer` **does not accept or set `payRate`** — its own comment says "Pay rate is not needed - overtime is calculated as hours over 40/week" (`overtime.ts:231`). OT pay is purely a function of the weekly-40 hours rule at payroll time; the offer carries no rate.
- **`respondToOffer`** accepts `"accepted"`/`"declined"`, requires the offer to still be `open`, and **upserts** the employee's single response row (so an employee can freely flip accept↔decline while the offer is open; `respondedAt` is restamped).
- **maxSlots enforced on accept** — on an accept it counts existing `accepted` rows and throws "This overtime slot is already full" once that reaches `maxSlots`. **Race condition:** the count-then-insert is **not** re-read-guarded (unlike the time-off mutations, which re-read status after patch), so two simultaneous accepts on the last slot can both pass the check and overfill. The employee view exposes `slotsRemaining`/`isFull` for display.
- **On accept**, in-app `notifications` go to every active user in the hardcoded role list `super_admin`, `admin`, `payroll_manager`, `warehouse_director`, `warehouse_manager`.
- **Audit logging:** `createOffer`, `closeOffer`, `cancelOffer`, and `deleteOffer` each write an `auditLogs` row; `reopenOffer` and `sendReminders` do **not** (inconsistent). `deleteOffer` cascade-deletes all `overtimeResponses` first.
- **Gotcha:** **push notifications are TODO** — `createOffer`/`cancelOffer`/`sendReminders` only set timestamps / create in-app notifications (`// TODO: Actually send push notifications here`); no Expo push is sent for overtime (unlike call-offs/late-alerts, which do push).

---

## 6. Time Off / PTO & Holidays

### Purpose
Employee PTO requests with manager approval that move balances through pending→used, backed by per-position accrual policies and per-employee/year balances; plus a company holiday calendar.

### App route / backend
- `app/time-off/page.tsx` — manager review dashboard (stats, status/search filters, approve/deny modal). Gated on `canManageTimeOff`.
- `convex/timeOffRequests.ts` (416 lines): `getAll`, `getPending`, `getMyRequests`, `getByDateRange`, `getStats`, `submit`, `approve`, `deny`, `cancel`.
- `convex/holidays.ts` (265 lines): `list`, `listByYear`, `listUpcoming`, `isHoliday(date, locationId?, department?)`, `getById`, `create`, `update`, `remove`, `createStandardHolidays(year)`.

### Data tables
| Table | Schema | Notes |
|-------|--------|-------|
| `timeOffRequests` | L1600 | `requestType` (vacation/sick/personal/bereavement/other), `startDate`/`endDate`, `totalDays`, `status`, review fields. |
| `ptoPolicies` | L1817 | per-`position` accrual: `eligibleAfterMonths`, vacation/sick/personal days per year, `accrualMethod` (annual/monthly/per_pay_period), `maxCarryoverDays`, `tenureBonuses[]`. |
| `ptoBalances` | L1843 | per personnel-year accrued/used/**pending**/carriedOver buckets for vacation/sick/personal, `eligibleDate`, `lastAccrualDate`. Index `by_personnel_year`. |
| `holidays` | L1465 | `type` (holiday/closure/override), `isPaidHoliday`, `affectedLocations[]`/`affectedDepartments[]` (empty = all), `isRecurring`. |

### Key workflows & notable logic
- **Balance accounting (the exact bucket math):** `submit` computes `totalDays = ceil(|end−start| / 1 day) + 1` — **calendar days, inclusive**, with no business-day/holiday exclusion (a Fri→Mon request counts 4 days). It then resolves the current-year `ptoBalances` row by index `by_personnel_year` and **increments `{requestType}Pending`** via a dynamic key (`vacationPending` / `sickPending` / `personalPending`). `approve` moves the days **pending → used** (`Math.max(0, pending − totalDays)` and `used + totalDays`); `deny` and `cancel` **back the days out of pending** (`Math.max(0, pending − totalDays)`). `approve`/`deny` update status **first**, then **re-read** the row and throw "already processed by another manager" if the status isn't theirs — the race guard.
- **No validation / overdraft is possible.** `submit` never checks that `pending + used + totalDays ≤ accrued`; nothing blocks requesting more PTO than the balance holds, and `requestType` values like `bereavement`/`other` have **no matching `{type}Pending` column**, so those requests adjust no balance at all (the dynamic-key guard `pendingField in ptoBalance` simply skips).
- **Silent no-op when no balance row exists.** Every balance update is wrapped in `if (ptoBalance)`. If the employee has **no `ptoBalances` row for the current year**, `submit`/`approve`/`deny`/`cancel` still succeed and change the request's status, but touch **no balances at all**. This is the practical consequence of accrual living elsewhere (below) — until something seeds the year's row, PTO requests are tracked but never debited.
- **`cancel` deletes; `deny` keeps.** A denied request is retained with `status="denied"` for the record; a cancelled request is **hard-deleted** (`ctx.db.delete`) after backing out its pending days. Both are pending-only; `cancel` additionally checks `request.personnelId === args.personnelId` (an employee can only cancel their own).
- **Accrual itself is not in `timeOffRequests.ts`** — these mutations only adjust the pending/used columns; accrual population of `ptoBalances` (from `ptoPolicies`: `eligibleAfterMonths`, per-year day grants, `accrualMethod`, `maxCarryoverDays`, `tenureBonuses[]`) lives elsewhere/externally and is not wired into this file.
- **`isHoliday`** filters by `affectedLocations`/`affectedDepartments` (empty arrays = applies to all), returning the first match.
- **`createStandardHolidays`** seeds 9 US holidays with dynamic date math (4th Thu Nov, last Mon May, 1st Mon Sep, 3rd Mon Jan, etc.) marked `isRecurring`.
- **Notifications:** request submission creates an in-app notification for the location manager (`managerNotifiedAt`).

---

## 7. Call-Offs

### Purpose
Same-day absence reporting with manager acknowledgment and push alerts.

### App route / backend
- `app/call-offs/page.tsx` — manager dashboard (Today / Unacknowledged tabs, acknowledge modal, manual-add modal). Gated on `canManageCallOffs`.
- `convex/callOffs.ts` (429 lines): `getAll`, `getToday`, `getUnacknowledged`, `getMyCallOffs`, `getStats`, `getByDateRange`, `submit`, `acknowledge`, `addManual`; internal `getCallOffAlertRecipients`, `sendCallOffPush` (Expo).

### Data table
| Table | Schema | Notes |
|-------|--------|-------|
| `callOffs` | L1624 | `date`, `reason`, `reportedVia` (app/phone/text/other; default "app"), `acknowledgedBy`/`acknowledgedAt`, `managerNotes`, `managerNotifiedAt`. |

### Key workflows & notable logic
- **`submit`** (employee) creates the call-off, an in-app notification to the location manager, and **schedules Expo push** to recipients (hardcoded roles `super_admin`/`admin`/`warehouse_director`/`coo` + the location manager) who have an `expoPushToken`.
- **`addManual`** (admin, `requireManagePersonnel`) is for phone/text reports and **auto-acknowledges**, skipping notifications.
- **Gotcha:** call-offs are **standalone** — there is no automatic link to `attendance` or `writeUps` here. (The attendance side separately reads call-offs/time-off in `detectMissedShifts` to avoid falsely flagging a no-call/no-show.)

---

## 8. Shifts & Scheduling

There are three related-but-distinct scheduling concepts:

| Concept | Table | What it is |
|---------|-------|-----------|
| **Daily shift plan** | `shifts` | A whiteboard: per-department open positions for one date with assigned crew and a lead. |
| **Shift template** | `shiftTemplates` | A saved full-day plan (all departments + crew + leads) that can be applied to a date. |
| **Schedule template (hours)** | `shiftTemplates` (used as "work schedules") | Reusable start/end-time schedules (e.g. 6:00–14:30) assigned to an employee via `personnel.defaultScheduleTemplateId`. |
| **Schedule override** | `scheduleOverrides` | One-off change to an employee's regular schedule (day_off/modified_hours/extra_shift/swap) — **managed in `convex/personnel.ts`, not `shifts.ts`.** |

### App routes
| Route | File | Purpose |
|-------|------|---------|
| `/shifts` | `app/shifts/page.tsx` (~1,550 lines) | Drag-and-drop daily whiteboard: per-department columns, lead drop-zone, daily goals/tasks, copy-yesterday, load/save templates, print. Gated on `canViewShifts` (edit on `canEditShifts`). |
| `/schedule-templates` | `app/schedule-templates/page.tsx` | "Work Schedules" CRUD — name + start/end times (default 06:00–14:30). |

### Backend
- `convex/shifts.ts` (729 lines): `listByDate`, `listByDateRange`, `listByPersonnel`, `getById`, `getAvailablePersonnel` (overlap-aware), `getDepartments` (defaults: Shipping/Receiving/Inventory/Purchases/Janitorial/Ecommerce/Retail), shift CRUD + `assignPersonnel`/`unassignPersonnel`/`setLead`/`removeLead`/`copyFromDate`/`removeByDate`, and daily-task ops (`getDailyTasks`, `addDailyTask`, `removeDailyTask`, `toggleDailyTaskComplete`, `setDailyTasks`). **All mutations require `requireManagePersonnel`.**
- `convex/shiftTemplates.ts` (300 lines): `list`, `getById`, `create`, `saveFromDate`, `update`, `remove`, `applyToDate(clearExisting?)`.

### Data tables
| Table | Schema | Notes |
|-------|--------|-------|
| `shifts` | L656 | date, times, `position`, `department`, `locationId`, `requiredCount`, `assignedPersonnel[]`, `leadId`. |
| `shiftTemplates` | L679 | `departments[]` each with position/times/requiredCount/`assignedPersonnel[]`/`leadId`. |
| `shiftDailyTasks` | L700 | per date+department `tasks[]` (`{id,text,completed?}`) — department to-dos, not personnel-linked. |
| `scheduleOverrides` | L717 | `overrideType` (day_off/modified_hours/extra_shift/swap), `status` (pending/approved/denied), `swapWithPersonnelId`, approval fields. |

### Key workflows & notable logic
- **Overlap protection:** `getAvailablePersonnel` and assignment check time overlap (`start < other.end && end > other.start` in minutes) so a person can't be double-booked on a date; dragging from one department to another auto-unassigns from the source.
- **`applyToDate`** re-validates that each templated person/lead is still **active** before creating shifts (so inactive employees aren't scheduled); `clearExisting` wipes the date first.
- **`copyFromDate`** copies shift structure **without** personnel assignments.
- **Schedule overrides** are created/approved/denied through `personnel.ts` (`createScheduleOverride` with optional `autoApprove`, `approveScheduleOverride`, `denyScheduleOverride`); admin-created overrides typically auto-approve.
- **Gotcha:** `shiftTemplates` is overloaded — it backs both "apply a full day plan" (`/shifts` templates) and the per-employee "work schedule" hours (`/schedule-templates`, referenced by `personnel.defaultScheduleTemplateId` and used by the time clock for lateness).

---

## 9. Mileage & Expense Reimbursement

### Purpose
Two parallel reimbursement workflows: IRS-rate mileage logs and itemized expense reports.

### App routes / backend
| Module | Route | Backend |
|--------|-------|---------|
| Mileage | `app/mileage/page.tsx` (~985 lines) | `convex/mileage.ts` (295 lines): `list`, `getSummary`, `getCurrentRate`, `getById`, `create`, `update`, `updateStatus`, `bulkUpdateStatus`, `remove`. |
| Expenses | `app/expense-report/page.tsx` (~842 lines) | `convex/expenseReports.ts` (375 lines): `list`, `listMine`, `getById`, `getPendingApproval`, `getSummary`, `create`, `update`, `submit`, `approve`, `reject`, `markPaid`, `remove`, `revertToDraft`. |

### Data tables
| Table | Schema | Notes |
|-------|--------|-------|
| `mileageEntries` | L2082 | `fromLocation`/`toLocation`, `miles`, `isRoundTrip`, `purpose`, `irsRate` snapshot, `reimbursementAmount`, `status` (pending/submitted/approved/paid). |
| `expenseReports` | L2110 | `items[]` (`{date,description,category,amount,hasReceipt}`), `totalAmount`, `status` (draft/submitted/approved/rejected/paid), approval/rejection/paid audit fields. |

### Key workflows & notable logic
- **Mileage rate:** `CURRENT_IRS_RATE = 0.725` (2026 rate), default home `"Latrobe, PA"`. Reimbursement = `(isRoundTrip ? miles*2 : miles) * irsRate`, rounded to cents. On **create** the rate used is the live `CURRENT_IRS_RATE` constant and is **snapshotted** onto the entry as `irsRate`; on **update** the recalc multiplies by `entry.irsRate` (the stored snapshot), not the current constant — so historical entries keep their original rate even after the constant changes. Workflow: `pending → submitted → approved → paid` (timestamp per transition). **`updateStatus` enforces a strict forward transition** (it only stamps the per-state timestamp when the prior status matches, e.g. `approved` only from `submitted`), but **`bulkUpdateStatus` skips that prior-state check** — it stamps the timestamp for the new status regardless of where the entry was, so bulk actions can move an entry to any status out of order. `updateStatus`/`bulkUpdateStatus`/`remove` require `requireAdmin`. Despite the schema comment "super_admin only," the guard in code is `requireAdmin`.
- **Expenses:** `totalAmount` auto-summed from `items[]`. Workflow `draft → submitted → approved → paid`, with `reject` (→ `rejected`) and `revertToDraft` (rejected → draft for edit/resubmit). `create` can `submitImmediately`. Editing/deleting is **draft-only**; `approve`/`reject`/`markPaid`/`remove` require `requireAdmin`. UI has ~13 hardcoded categories and an invoice-style print template with certification + signature lines.

---

## Appendix — Magic numbers & hardcoded values

| Value | Meaning | Location |
|-------|---------|----------|
| 5 min | Clock-in grace period | `timeClock.ts` (`GRACE_PERIOD_MINUTES`) |
| 15 min | Worked-hours rounding | `timeClock.ts` / `timesheetApprovals.ts` |
| 40 hrs | Overtime threshold — applied **per calculation span** (genuinely weekly only in `calculatePendingTimeExports`; per-14-day-period in the payroll/approval UI) | `timeClock.ts`, `timesheetApprovals.ts`, `quickbooks.ts` |
| 5 / 10 | QB sync-queue priority — time-entry exports (5) drain ahead of default (10) | `quickbooks.ts` |
| 14 days, ref `2024-01-01` | Pay-period length & anchor | `timesheetApprovals.ts` |
| >1 in 7 days | Late-pattern flag | `timeClock.ts` |
| 0/1/2/3+ → verbal/written/suspension/termination | Attendance write-up escalation (6-mo window) | `attendance.ts` |
| 90 days | Write-up archive/expiry | `personnel.ts` / `writeUps` |
| 60 days → 1st of next month; 365 days | Insurance / vacation eligibility (UI) | `app/personnel/[id]` |
| 30 min | QBWC session TTL | `quickbooks.ts` / `qbwcSessions` |
| QBXML 13.0 | Emitted QB request version | `quickbooks.ts` |
| 3 | QB sync queue max attempts | `qbSyncQueue` |
| 0.725 /mi, "Latrobe, PA" | IRS mileage rate (2026), home base | `mileage.ts` |
| 06:00–14:30 | Default shift/overtime times | `overtime.ts` UI, `schedule-templates` |

## Appendix — Known gaps / TODOs discovered in code

- **QuickBooks:** plaintext `wcPassword` (schema comment still falsely says "hashed"); paycheck import unimplemented; employee auto-mapping is a stub; `markExportCompleted` exists but is never called, so `qbTxnId` is never stored and exports never leave `approved` for `exported`; QBXML sends only `totalHours` (reg/OT split dropped); only mapped employees export (unmapped skipped silently); `attempts` is consumed on entering `processing`, and there's no stuck-`processing` recovery or background retry.
- **Hours/OT consistency:** three separate hour calculators (live dashboard rounds whole-day once; approvals round per-day then sum; QB export does not round at all), so the same punches can yield slightly different hours across surfaces. The "40-hour" OT cut is applied across whatever span the caller passes — a whole 14-day period in the payroll UI, true Sun→Sat weeks only in the granular QB path.
- **Multi-company:** lock/edit/export checks (`canEditTimeEntry`, `markExportedToQB`, `exportPayPeriodToQB`, `getPayPeriodDetails`'s approval lookup) use `by_pay_period.first()` with **no company filter**, so two companies sharing a pay-period start can cross-block each other.
- **Approvals:** `approvePayPeriod` is re-runnable and will silently revert a `locked` period back to `approved` (recomputing totals) if invoked again.
- **Overtime:** push notifications are TODO (in-app only); `maxSlots` accept-check is not re-read-guarded (can overfill on concurrent accepts); `payRate` field is vestigial/unused.
- **PTO:** accrual population of `ptoBalances` from `ptoPolicies` is not in `timeOffRequests.ts` (request mutations only adjust pending/used); **no overdraft validation**; all balance updates are **no-ops if the current-year `ptoBalances` row is missing**; `bereavement`/`other` request types have no balance bucket; `totalDays` counts calendar days (weekends/holidays included).
- **Pay stubs:** no in-app create/upload mutation; rows arrive via import/QB `source`; `PaycheckQueryRq` generator exists but its response is never parsed.
- **Mileage:** `bulkUpdateStatus` skips the forward-only transition guard that `updateStatus` enforces.
- **Time clock:** missing `break_end` silently drops break time; orphan clock-outs ignored.
