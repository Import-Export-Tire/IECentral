# IECentral — HR / Time / Payroll

Internal people-operations cluster for **Import Export Tire Co** ("IE Tire"). Stack: **Next.js 15 (App Router)** front end, **Convex** reactive backend (`convex/*.ts`, schema in `convex/schema.ts`), with one **AWS-adjacent SOAP integration** to QuickBooks Desktop via the QuickBooks Web Connector (QBWC).

This document covers the modules that run the daily life of an hourly/salaried employee from the company's side: the **Personnel record** (the spine of everything), the **time clock** and its **timesheet → payroll → QuickBooks** pipeline, **scheduling/shifts**, **overtime offers**, **time-off / PTO**, **call-offs**, **holidays**, **pay stubs / payroll companies**, and **mileage / expense reimbursement**.

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
- **Hours computation (single source of truth, reused by payroll/QB):** pair `clock_in`/`clock_out`, subtract break spans, then `roundToQuarterHour` (nearest 15 min) before converting to hours. Overtime is **weekly, >40 hrs** (`regularHours = min(total, 40)`, `overtimeHours = max(0, total−40)`) — there is **no daily-8 OT rule**.
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
- **Pay period math:** reference date `2024-01-01`, **14-day** periods (`getPayPeriodFromDate`). Periods are computed, not stored, until an approval row is created.
- **Lifecycle:** `pending → approved → locked → exportedToQB`. `lockPayPeriod` requires an existing `approved` state; `markExportedToQB` requires `locked`. `unlockPayPeriod` is the admin escape hatch back to `approved`.
- **Issues flagged** per employee: pending corrections count, and **missing clock-out** (last entry of a day is `clock_in`/`break_start`). These roll into `issueCount`.
- **Multi-company scoping:** employee→company resolution is **direct `payrollCompanyId` first, then department membership** in the company's `departments[]`. Approvals are per `(payrollCompanyId, payPeriodStart)`.
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
- **QBXML generators (QBXML version 13.0):** `generateQwcFile`, `generateTimeTrackingAddXml`, `generateEmployeeQueryXml`, `generatePaycheckQueryXml`.

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
- **`TimeTrackingAddRq`** — `TxnDate` = `weekEndDate` (Saturday), `EntityRef/ListID` from the employee mapping, `Duration` as ISO-8601 `PT#H#M`, `Notes` referencing the IECentral week. Returns null (skips) if no mapping exists.
- **`EmployeeQueryRq`** — `ActiveStatus=ActiveOnly`.
- **`PaycheckQueryRq`** — date-range filtered with `IncludeLineItems`. **Generator exists but `receiveResponseXML` does not parse paycheck data — pay-stub import is unimplemented.**
- **`.QWC` config (`generateQwcFile`)** — `AppName`, `AppURL = {appUrl}/api/qbwc`, `UserName`, random `OwnerID`/`FileID`, `QBType=QBFS`, `Scheduler/RunEveryNMinutes = syncIntervalMinutes`, `IsReadOnly=false`. The admin downloads this and imports it into the Web Connector, entering the password manually.

### Two export paths
- **Granular:** `calculatePendingTimeExports` (requires the covering `timesheetApprovals` to be **locked**) builds per-week `qbPendingTimeExport` rows in `pending`; `approveTimeExport` flips them to `approved` and enqueues a `qbSyncQueue` `time_entry` item (priority 5).
- **Bulk (the `/payroll` button):** `exportPayPeriodToQB` validates the period is `locked` and not already exported, then for every mapped employee creates an `approved` export and immediately enqueues it, and sets `timesheetApprovals.exportedToQB=true`.

### Notable gotchas / design decisions
- **`wcPassword` is stored and compared in plain text** despite the schema comment saying "hashed." It travels only over TLS but is at-rest plaintext.
- **Manual XML via regex** — fragile for large/edge responses; QBXML is always emitted at version 13.0 regardless of the detected QB version.
- **No background retry / no stuck-item recovery** — `maxAttempts=3` only advances when QBWC re-polls; an item left `processing` after a connector crash is not auto-reclaimed.
- **No paycheck import, no auto employee-mapping, `qbTxnId` not persisted back** onto the export from `TimeTrackingRet` (extracted but dropped).
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
- **Lifecycle:** `open → closed | cancelled` (with `reopen`). If `sendNotification`, pending `overtimeResponses` are pre-created for all targets.
- **maxSlots enforced on accept** — `respondToOffer` throws "already full" once accepted count reaches `maxSlots`; the employee view exposes `slotsRemaining`/`isFull`.
- **On accept**, in-app `notifications` go to managers (hardcoded roles: `super_admin`, `admin`, `payroll_manager`, `warehouse_director`, `warehouse_manager`).
- **Gotcha:** **push notifications are TODO** — `createOffer`/`cancelOffer`/`sendReminders` only set timestamps / create in-app notifications; no Expo push is sent for overtime (unlike call-offs/late-alerts, which do push).

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
- **Balance accounting:** `submit` computes `totalDays = ceil((end−start)/day)+1` and **increments `{type}Pending`** on the current-year `ptoBalances`; `approve` moves the days **pending → used**; `deny`/`cancel` (pending only) **back out the pending**. Race-safe re-read of status after patch.
- **Accrual itself is not in `timeOffRequests.ts`** — these mutations only adjust the pending/used columns; accrual population of `ptoBalances` (from `ptoPolicies`) lives elsewhere/externally.
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
- **Mileage rate:** `CURRENT_IRS_RATE = 0.725` (2026 rate), default home `"Latrobe, PA"`. Reimbursement = `(isRoundTrip ? miles*2 : miles) * irsRate`, rounded to cents; the rate is **snapshotted** onto each entry, so edits recalc against the stored rate, not the current one. Workflow: `pending → submitted → approved → paid` (timestamp per transition). `updateStatus`/`bulkUpdateStatus`/`remove` require `requireAdmin`. Despite the schema comment "super_admin only," the guard in code is `requireAdmin`.
- **Expenses:** `totalAmount` auto-summed from `items[]`. Workflow `draft → submitted → approved → paid`, with `reject` (→ `rejected`) and `revertToDraft` (rejected → draft for edit/resubmit). `create` can `submitImmediately`. Editing/deleting is **draft-only**; `approve`/`reject`/`markPaid`/`remove` require `requireAdmin`. UI has ~13 hardcoded categories and an invoice-style print template with certification + signature lines.

---

## Appendix — Magic numbers & hardcoded values

| Value | Meaning | Location |
|-------|---------|----------|
| 5 min | Clock-in grace period | `timeClock.ts` (`GRACE_PERIOD_MINUTES`) |
| 15 min | Worked-hours rounding | `timeClock.ts` / `timesheetApprovals.ts` |
| 40 hrs/week | Overtime threshold (weekly only) | `timeClock.ts`, `timesheetApprovals.ts`, `quickbooks.ts` |
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

- **QuickBooks:** plaintext `wcPassword`; paycheck import unimplemented; employee auto-mapping is a stub; `qbTxnId` not persisted back; no stuck-`processing` recovery or background retry.
- **Overtime:** push notifications are TODO (in-app only).
- **PTO:** accrual population of `ptoBalances` from `ptoPolicies` is not in `timeOffRequests.ts` (the request mutations only adjust pending/used).
- **Pay stubs:** no in-app create/upload mutation; rows arrive via import/QB `source`.
- **Time clock:** missing `break_end` silently drops break time; orphan clock-outs ignored.
