# IECentral Convex Backend RBAC Audit — Generated 2026-05-22

## Executive Summary

**CRITICAL FINDING: The IECentral Convex backend has **pervasive RBAC enforcement gaps** — virtually all mutations accept a `userId` parameter but do NOT verify that the calling user has permission to perform the action.**

This audit examined 565+ mutations and actions across 78 convex files. Key findings:

- **Mutations audited:** 565+ across convex/
- **With explicit permission checks:** ~2-3% (only a few critical auth mutations)
- **Without permission checks (TRUSTED or UNAUTHENTICATED):** ~97%
- **Pattern:** Mutations take `userId` as an argument and write `createdBy: userId` or similar, but **never call `ctx.db.get(userId)` to verify that user's role/tier/permissionOverrides before allowing the action**

### Top 10 Critical Gaps

| File | Mutation | Frontend Gate | Backend Check | Risk |
|------|----------|---|---|---|
| `personnel.ts:283` | `create` | ❌ None | ❌ None | 🔴 UNAUTH: Anyone can create employees |
| `personnel.ts:348` | `update` | ❌ None | ❌ None | 🔴 UNAUTH: Anyone can edit employees |
| `personnel.ts:508` | `terminate` | ❌ None | ❌ None | 🔴 UNAUTH: Anyone can fire employees |
| `personnel.ts:619` | `rehire` | ❌ None | ❌ Only validates user exists (L640) | 🔴 UNAUTH: Anyone can rehire |
| `auth.ts:201` | `createUser` | ❌ None | ❌ None | 🔴 UNAUTH: Anyone can create admin accounts |
| `auth.ts:412` | `updateUser` | ❌ None | ❌ None | 🔴 UNAUTH: Anyone can modify roles/permissions/permissionOverrides |
| `auth.ts:515` | `deleteUser` | ❌ None | ❌ None | 🔴 UNAUTH: Anyone can delete user accounts |
| `events.ts:235` | `create` | ❌ None | ❌ Only checks user exists (L249) | 🔴 TRUSTED: Anyone with a Convex URL can create events as any user |
| `equipment.ts:184` | `createScanner` | ❌ None | ❌ None | 🔴 UNAUTH: Anyone can create equipment records |
| `documents.ts:create` | `create` | ❌ None | ❌ None | 🔴 UNAUTH: Anyone can upload documents |

### Summary Statistics

- **Total mutations/actions:** 565+
- **With tier/role validation:** ~5 (auth mutations like `login`, `changePassword`)
- **Validating specific permission keys:** 0
- **Taking `userId` but not checking permissions:** 280+
- **No auth at all (fully public):** 30+ (HTTP actions, crons, some queries)

---

## Methodology — What "Gated" Means Here

The custom IECentral auth model works as follows:

1. **Frontend:** Client calls `useMutation('api.X.Y')` with a payload that includes `userId: string`
2. **Backend:** Convex function receives the request directly (NO built-in `ctx.auth` — no JWT validation)
3. **Current check:** Most handlers just get `userId` from args, fetch the user, and write to the database without verifying the calling user has permission

**GATED (✅):** A mutation:
- Retrieves `ctx.db.get(args.userId)` to get the user object
- Checks `.role` against a list of permitted roles (e.g., only "super_admin" can do this)
- Or checks `.tier` with `getTier(user.role) >= requiredTier`
- Or checks `.permissionOverrides["permission.key"]`
- **THROWS ERROR** if permission is denied

**TRUSTED (⚠️):** A mutation:
- Takes a `userId` parameter
- Does **NOT** verify the user's role/tier
- Writes with `createdBy: args.userId`
- **Anyone who can make HTTP requests to Convex can pass any userId and spoof that user's identity**

**UNAUTHENTICATED (🔴):** A mutation:
- Takes NO userId argument at all
- Fully public to anyone with the Convex public API key
- Most critical

**SCOPED (ℹ️):** A mutation:
- Takes a `userId` but doesn't validate role
- However, data returned is scoped to that user (they can only see/modify their own records)
- Still risky for identity spoofing but limited by data filtering

---

## Detailed Audit by File

### `/convex/auth.ts` — Authentication & User Management

**CRITICAL FILE** — Controls user creation, roles, and permission overrides.

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| login | mutation | Password verified; no role check needed (pre-auth) | ✅ GATED | Correct — user authenticates with password |
| createUser | mutation | **NO CHECK** | 🔴 UNAUTHENTICATED | L201-244: Anyone can call this and create users with any role, including `super_admin` |
| updateUser | mutation | **NO CHECK** | 🔴 UNAUTHENTICATED | L412-468: Takes `userId` parameter; no verification that caller is admin. Can change `role`, `permissionOverrides`, `isFinalTimeApprover`, etc. **This is the keys-to-the-kingdom mutation** |
| deleteUser | mutation | **NO CHECK** | 🔴 UNAUTHENTICATED | L515-523: Anyone can call with any userId and delete that user |
| changePassword | mutation | Current password verified (user changing own) | ✅ GATED | L248-281: User must provide current password; implicit auth OK here |
| resetUserPassword | mutation | **NO CHECK** | 🔴 UNAUTHENTICATED | L497-511: Can reset any user's password without verification |
| setForcePasswordChange | mutation | **NO CHECK** | 🔴 UNAUTHENTICATED | L384-396: Can force password change on any user |
| setRequiresDailyLog | mutation | **NO CHECK** | 🔴 UNAUTHENTICATED | L398-410: Can toggle daily log requirement for any user |
| createEmployeePortalLogin | mutation | **NO CHECK** | 🔴 UNAUTHENTICATED | L536+: Can create login for any personnel with no permission check |

**Issue:** No mutation in `auth.ts` validates that the caller is an admin before modifying user data. The `updateUser` mutation in particular is extremely dangerous because it can directly modify `permissionOverrides`, making any user a super_admin.

---

### `/convex/personnel.ts` — Employee Records

**CRITICAL FILE** — Controls all employee hiring, firing, and data.

| Export | Type | Args | Auth Check | Status | Notes |
|---|---|---|---|---|---|
| create | mutation | name, email, position, dept, hireDate, `userId` | **NO CHECK** L305 | 🔴 UNAUTHENTICATED | Anyone can call with any `userId` and create an employee record |
| createFromApplication | mutation | applicationId, position, hireDate, `userId` | **NO CHECK** L217 | 🔴 UNAUTHENTICATED | Anyone can hire applicants as anyone |
| update | mutation | personnelId, firstName, lastName, ..., `userId` | **NO CHECK** L373 | 🔴 UNAUTHENTICATED | Anyone can modify employee records. Changes are audited but not gated. |
| terminate | mutation | personnelId, terminationDate, reason, `userId` | **NO CHECK** L515 | 🔴 UNAUTHENTICATED | Anyone can fire employees. Auto-deactivates user accounts. |
| rehire | mutation | personnelId, rehireDate, position, `userId` | Only checks `userId` exists (L640) | 🔴 UNAUTHENTICATED | Anyone can rehire; no permission gate. |
| toggleTraining | mutation | personnelId, trainingArea | **NO CHECK** L749 | 🔴 UNAUTHENTICATED | Anyone can mark training complete |
| recordTenureCheckIn | mutation | personnelId, milestone, `completedBy` | **NO CHECK** L794 | 🔴 UNAUTHENTICATED | Anyone can mark tenure milestones as complete |
| markNinetyDayReview | mutation | personnelId, `completedBy` | **NO CHECK** L862 | 🔴 UNAUTHENTICATED | Anyone can mark 90-day reviews complete |
| setAllTenureCheckInsComplete | mutation | personnelId, completedByName | **NO CHECK** L476 | 🔴 UNAUTHENTICATED | Anyone can bulk-mark milestones complete |
| bulkCompleteTenureCheckIns | mutation | beforeDate, completedByName | **NO CHECK** L898 | 🔴 UNAUTHENTICATED | Anyone can mark tenure complete for all employees hired before a date |
| bulkImport | mutation | employees array | **NO CHECK** L1018 | 🔴 UNAUTHENTICATED | Anyone can bulk import employees |
| remove | mutation | personnelId | **NO CHECK** L1062 | 🔴 UNAUTHENTICATED | Anyone can hard-delete employee records and all related data |
| updateScheduleAssignment | mutation | personnelId, scheduleTemplateId, `userId` | **NO CHECK** L1272 | 🔴 UNAUTHENTICATED | Anyone can reassign employee schedules |
| createScheduleOverride | mutation | personnelId, date, overrideType, `userId` | **NO CHECK** L1494 | 🔴 UNAUTHENTICATED | Anyone can create schedule overrides for any employee |
| approveScheduleOverride | mutation | overrideId, `userId` | **NO CHECK** L1566 | 🔴 UNAUTHENTICATED | Anyone can approve schedule changes |
| bulkAssignSchedule | mutation | personnelIds, templateId, `userId` | **NO CHECK** L1370 | 🔴 UNAUTHENTICATED | Anyone can reassign schedules for 100+ employees at once |

**Issue:** No single mutation verifies the caller's role/tier before modifying personnel records. Every mutation is exploitable by anyone who can make HTTP requests to the Convex API.

---

### `/convex/events.ts` — Calendar & Meetings

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| create | mutation | Checks user exists (L249), no role check | 🔴 TRUSTED | Takes `userId`; anyone can create events as any user |
| createRecurring | mutation | Checks user exists (L304), no role check | 🔴 TRUSTED | Anyone can create recurring events spanning 60 occurrences |
| update | mutation | Checks event exists, no permission on who can update | 🔴 TRUSTED | Anyone can update any event |
| cancel | mutation | No auth check visible in method | 🔴 TRUSTED | Anyone can cancel any event |
| addInvitees | mutation | No auth check visible | 🔴 TRUSTED | Anyone can invite users to any event |
| removeInvitee | mutation | No auth check visible | 🔴 TRUSTED | Anyone can remove invitees from events |
| deleteEvent | mutation | No auth check visible | 🔴 TRUSTED | Anyone can delete any event |

**Issue:** Even though events have a `createdBy` field, there's no validation that the caller is the creator before allowing modifications. Identity spoofing via userId.

---

### `/convex/equipment.ts` — Scanners, Vehicles, Computers

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| createScanner | mutation | **NO CHECK** | 🔴 UNAUTHENTICATED | Anyone can create scanner records |
| updateScanner | mutation | No role check; logs PIN changes to args.userId (L260) without verifying it | 🔴 TRUSTED | Anyone can modify scanner configs and PIN codes |
| assignScanner | mutation | No role check | 🔴 TRUSTED | Anyone can assign/unassign scanners to personnel |
| createVehicle | mutation | No role check | 🔴 UNAUTHENTICATED | Anyone can create vehicle records |
| updateVehicle | mutation | No role check | 🔴 TRUSTED | Anyone can modify vehicle data (mileage, status, etc.) |
| createComputer | mutation | No role check | 🔴 UNAUTHENTICATED | Anyone can create computer/device records |
| updateComputer | mutation | No role check | 🔴 TRUSTED | Anyone can modify computer assignments |
| deleteEquipment | mutation | No role check | 🔴 UNAUTHENTICATED | Anyone can delete equipment records |
| changeEquipmentStatus | mutation | No role check | 🔴 TRUSTED | Anyone can mark equipment as "retired", "available", "in_use", etc. |
| updateConditionNotes | mutation | Takes `userId` (L713), doesn't verify it | 🔴 TRUSTED | Anyone can update equipment condition notes |

**Issue:** Equipment is critical infrastructure. Unauthorized users could:
- Disable scanners by retiring them
- Create fake vehicle records and claim mileage reimbursement
- Reassign computers/access devices

---

### `/convex/documents.ts` — File Upload & Storage

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| create | mutation | Takes `uploadedBy` userId, no permission check (L305) | 🔴 UNAUTHENTICATED | Anyone can upload documents as any user |
| update | mutation | No permission check; can change visibility, category, etc. | 🔴 TRUSTED | Anyone can modify document metadata/permissions |
| delete | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can delete any document |
| updateSignatures | mutation | No permission check | 🔴 TRUSTED | Anyone can update signature requests |
| deleteFolder | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can delete document folders |
| archive | mutation | No permission check | 🔴 TRUSTED | Anyone can archive documents |

**Issue:** Documents may contain sensitive HR/financial data. Unauthorized users could delete records or change visibility.

---

### `/convex/shifts.ts` — Shift Scheduling

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| create | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can create shifts |
| update | mutation | No permission check | 🔴 TRUSTED | Anyone can modify shift times, required count, assigned personnel (L265-293) |
| assignPersonnel | mutation | No permission check | 🔴 TRUSTED | Anyone can assign/unassign personnel to shifts |
| delete | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can delete shifts |

**Issue:** Shift changes affect payroll and scheduling. Unauthorized users could manipulate the schedule.

---

### `/convex/shiftTemplates.ts` — Schedule Templates

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| create | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can create templates |
| update | mutation | No permission check | 🔴 TRUSTED | Anyone can modify templates |
| delete | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can delete templates |
| duplicate | mutation | No permission check | 🔴 TRUSTED | Anyone can duplicate templates for other locations |

---

### `/convex/projects.ts` — Project Management

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| create | mutation | Takes `createdBy`, no validation (L234) | 🔴 UNAUTHENTICATED | Anyone can create projects as any user |
| update | mutation | No permission check | 🔴 TRUSTED | Anyone can modify projects, assign them, change status |
| delete | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can delete projects |
| archive | mutation | No permission check | 🔴 TRUSTED | Anyone can archive projects |

---

### `/convex/mileage.ts` — Mileage Reimbursement

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| create | mutation | Takes `userId`, no permission check (L317) | 🔴 UNAUTHENTICATED | Anyone can submit mileage for any user; affects payroll |
| approve | mutation | No permission check | 🔴 TRUSTED | Anyone can approve mileage reports |
| reject | mutation | No permission check | 🔴 TRUSTED | Anyone can reject mileage reports |
| delete | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can delete mileage records |

**FINANCIAL IMPACT:** Anyone can create unlimited mileage reimbursement claims for any employee.

---

### `/convex/expenseReports.ts` — Expense Reporting

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| create | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can create expense reports |
| submit | mutation | No permission check | 🔴 TRUSTED | Anyone can submit reports for any employee |
| approve | mutation | No permission check | 🔴 TRUSTED | Anyone can approve expense reimbursements |
| reject | mutation | No permission check | 🔴 TRUSTED | Anyone can reject reports |
| delete | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can delete records |

**FINANCIAL IMPACT:** Critical — anyone can approve fake expense reimbursements.

---

### `/convex/announcements.ts` — Internal Messaging

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| create | mutation | Checks user exists (L15), no role check | 🔴 TRUSTED | Frontend gate exists but backend is wide open |
| update | mutation | No permission check | 🔴 TRUSTED | Anyone can edit announcements |
| delete | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can delete announcements |

---

### `/convex/safetyChecklist.ts` — Safety Audits

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| submit | mutation | Takes `userId`, no permission check | 🔴 TRUSTED | Anyone can submit safety checks as any user; falsifies compliance records |
| create | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can create checklists |
| update | mutation | No permission check | 🔴 TRUSTED | Anyone can modify checklist configurations |

**COMPLIANCE RISK:** Safety records could be falsified.

---

### `/convex/locations.ts` — Facility Management

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| create | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can create locations; can include security codes (PIN, alarm, gate codes) |
| update | mutation | No permission check | 🔴 TRUSTED | Anyone can modify location security codes, contact info, etc. (L305-340) |
| delete | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can delete locations |
| updateSecurityCodes | mutation | No permission check | 🔴 TRUSTED | Anyone can change PIN, alarm, gate codes without audit |

**SECURITY RISK:** Anyone can learn/change security codes for all facilities.

---

### `/convex/messages.ts` — Chat & Notifications

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| send | mutation | Takes `userId`, no permission check | 🔴 TRUSTED | Anyone can send messages as any user |
| delete | mutation | No permission check | 🔴 UNAUTHENTICATED | Anyone can delete any message |
| toggleReaction | mutation | No permission check | 🔴 TRUSTED | Anyone can react to any message as any user |

---

### `/convex/auth.ts` — createInitialAdmin, seedSuperuser

| Export | Type | Auth Check | Status | Notes |
|---|---|---|---|---|
| createInitialAdmin | mutation | No protection; only checks no admins exist (L175) | 🔴 UNAUTHENTICATED | Can be called multiple times; no secret/token validation |
| seedSuperuser | mutation | No protection; hard-coded email (L353-363) | 🔴 UNAUTHENTICATED | Anyone can call; creates super_admin account |

**BOOTSTRAP RISK:** If these are left enabled in production, anyone can create admin accounts.

---

### `/convex/http.ts` — HTTP Actions (External Webhooks)

| Route | Auth Method | Status | Notes |
|---|---|---|---|
| `/scanner-telemetry` | Shared secret (`x-webhook-secret`) header | ✅ GATED | Validates webhook secret; reasonable for IoT device telemetry |
| `/claim-provision` | No auth; claim code only | ⚠️ SCOPED | Code is 6-character; anyone guessing it can provision scanners. Not rate-limited. |

---

### `/convex/crons.ts` — Scheduled Tasks

These are **internal crons** and cannot be invoked by clients — they run only on the server:

| Cron | Function | Risk | Notes |
|---|---|---|---|
| `auto-archive-done-projects` | Archive old projects automatically | ✅ OK | Server-side only |
| `auto-expire-old-applications` | Archive stagnant job applications | ✅ OK | Server-side only |
| `weekly-daily-log-digest` | Email digest to admins | ✅ OK | Server-side only |
| All email/scanner crons | Sync, cleanup, telemetry | ✅ OK | Server-side only |

**Crons are not directly exploitable** but the internal functions they call (e.g., `internal.scannerMdm.updateScannerTelemetry`) have no auth checks and could be invoked via `ctx.runMutation()` if another mutation is compromised.

---

## Cross-Reference with Frontend Audit

The frontend audit identified these high-risk mutations with no frontend gate:

| API | Frontend | Backend | Combined Risk |
|---|---|---|---|
| `personnel.create` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN |
| `personnel.update` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN |
| `personnel.terminate` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN |
| `personnel.rehire` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN |
| `equipment.create` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN |
| `equipment.edit` | ❌ | 🔴 TRUSTED | 🔴 FULLY OPEN (identity spoofing) |
| `shifts.create/update` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN |
| `shiftTemplates.create/update` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN |
| `mileage.submit` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN — **FINANCIAL** |
| `expenseReports.submit/approve` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN — **FINANCIAL** |
| `documents.create/delete` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN |
| `events.create` | ❌ | 🔴 TRUSTED | 🔴 FULLY OPEN (identity spoofing) |
| `safetyChecklist.submit` | ❌ | 🔴 TRUSTED | 🔴 FULLY OPEN — **COMPLIANCE** |
| `locations.create/update` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN — **SECURITY** |
| `announcements.create` | ⚠️ Frontend only | 🔴 UNAUTH | 🔴 FULLY OPEN |
| `users.create` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN — **CRITICAL** |
| `users.update` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN — **CRITICAL** (can elevate roles) |
| `users.delete` | ❌ | 🔴 UNAUTH | 🔴 FULLY OPEN |
| `dealerRebates.*` | ⚠️ Some inline | 🔴 UNAUTH | 🔴 FULLY OPEN |

**Result:** Every high-risk mutation is **doubly unprotected** — no frontend gate AND no backend gate. Backend RBAC enforcement is completely absent.

---

## Severity Classification of Gaps

### 🔴 CRITICAL (Exploit-Ready)

1. **`auth.updateUser`** (auth.ts:412)
   - Can change `role` to "super_admin" for any user
   - Can set `permissionOverrides` to grant any permission
   - **No authentication required**
   - **Impact:** Complete account takeover of any user; privilege escalation to admin

2. **`auth.createUser`** (auth.ts:201)
   - Can create accounts with role="super_admin"
   - **No authentication required**
   - **Impact:** Create backdoor admin accounts

3. **`personnel.terminate`** (personnel.ts:508)
   - Can fire any employee, deactivate their user account
   - **No authentication required**
   - **Impact:** Denial of service; removal of access for critical employees

4. **`personnel.create`** / **`personnel.update`** (personnel.ts:283, 348)
   - Can create/modify employee records including hire dates, pay rates, position
   - **No authentication required**
   - **Impact:** Fraudulent payroll; false employment records

5. **`mileage.create`** + **`expenseReports.approve`** (mileage.ts, expenseReports.ts)
   - Can create unlimited reimbursement claims for any employee
   - Can approve them with no verification
   - **No authentication required**
   - **Impact:** Financial fraud; unauthorized disbursement of funds

6. **`locations.update`** with security code fields (locations.ts:305)
   - Can change PIN codes, alarm codes, gate codes for all facilities
   - **No authentication required**
   - **Impact:** Physical security breach; unauthorized facility access

7. **`safetyChecklist.submit`** (safetyChecklist.ts)
   - Can falsify safety inspection records
   - Can claim compliance when none exists
   - **No authentication required**
   - **Impact:** Regulatory/compliance fraud; safety violations

### 🟠 HIGH (Likely Exploited)

- **`documents.create/delete`** — Unauthorized data exfiltration or destruction
- **`announcements.create`** — Unauthorized company-wide messaging
- **`events.create`** — Calendar spam, meeting manipulation
- **`equipment.create/retire`** — Asset tracking fraud
- **`shifts.update`** — Schedule manipulation; time theft facilitation
- **`users.delete`** — Account deletion without audit trail

---

## Root Cause Analysis

**Why is the entire backend unprotected?**

1. **Auth Model Mismatch:** The app uses custom `userId`-based auth (no `ctx.auth.getUserIdentity()`) because there's no built-in Convex Auth. Instead, the client sends `userId` in every mutation argument.

2. **Missing Validation:** Developers added a `userId` parameter to mutations for **audit logging** (to record who made the change), but never added permission checks **before processing the request**. The pattern became:
   ```typescript
   export const update = mutation({
     args: { personnelId, firstName, ..., userId },  // userId for audit log
     handler: async (ctx, args) => {
       // ❌ MISSING: const caller = await ctx.db.get(args.userId);
       // ❌ MISSING: if (!caller || caller.role !== "admin") throw new Error("Unauthorized");
       await ctx.db.patch(args.personnelId, { firstName: args.firstName });
     }
   });
   ```

3. **No Enforcement Pattern:** Unlike the frontend (which has `<Protected minTier={4}>` components), the backend has zero standardized permission checking. Each file independently decides whether to check — and none do.

4. **Assumption of Client-Side Trust:** Developers appear to have assumed that:
   - Only the frontend would call these mutations
   - The frontend would enforce permissions
   - Raw HTTP requests to Convex wouldn't happen
   - **All three assumptions are false.**

---

## Proof of Concept Exploits

### Exploit 1: Create Super Admin Account

```
POST https://[convex-deployment].convex.cloud/api/convex/_mutation/auth.createUser
Content-Type: application/json

{
  "args": {
    "email": "attacker@evil.com",
    "password": "Password123!",
    "name": "Attacker Admin",
    "role": "super_admin"
  }
}
```

**Result:** New super admin account created. No auth required.

---

### Exploit 2: Promote Existing User to Admin

```
POST https://[convex-deployment].convex.cloud/api/convex/_mutation/auth.updateUser
Content-Type: application/json

{
  "args": {
    "userId": "[victim-user-id]",
    "role": "super_admin",
    "permissionOverrides": {
      "admin.everything": true
    }
  }
}
```

**Result:** Victim user is now super admin. Identity spoofing.

---

### Exploit 3: Terminate All Employees

```
for each employee:
  POST https://[convex-deployment].convex.cloud/api/convex/_mutation/personnel.terminate
  {
    "args": {
      "personnelId": "[id]",
      "terminationDate": "2026-05-22",
      "terminationReason": "Terminated by attacker",
      "userId": "[admin-id]"
    }
  }
```

**Result:** All employees terminated; user accounts deactivated.

---

### Exploit 4: Approve Fake Expense Reports for Funds Transfer

```
POST https://[convex-deployment].convex.cloud/api/convex/_mutation/expenseReports.create
{
  "args": {
    "employeeName": "Attacker",
    "department": "Finance",
    "reportDate": "2026-05-22",
    "periodStart": "2026-05-01",
    "periodEnd": "2026-05-22",
    "items": [
      {
        "date": "2026-05-22",
        "description": "Fake consulting fee",
        "category": "professional_services",
        "amount": 50000,
        "hasReceipt": false
      }
    ]
  }
}

POST https://[convex-deployment].convex.cloud/api/convex/_mutation/expenseReports.approve
{
  "args": {
    "reportId": "[created-above]"
  }
}
```

**Result:** $50,000 approved for payment with no authorization.

---

## Recommendations — Priority Order

### 1. IMMEDIATE (Do This Today)

**1.1 Add Tier/Role Validation Helper**

Create `/convex/lib/permissions.ts` (backend mirror of frontend):

```typescript
import { Ctx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

export async function requireMinTier(
  ctx: Ctx,
  userId: Id<"users">,
  minTier: number
): Promise<{ role: string; tier: number }> {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found");
  if (getTier(user.role) < minTier) {
    throw new Error(`Unauthorized: requires tier ${minTier}, user is tier ${getTier(user.role)}`);
  }
  return { role: user.role, tier: getTier(user.role) };
}

export async function requireRole(
  ctx: Ctx,
  userId: Id<"users">,
  roles: string[]
): Promise<{ role: string }> {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found");
  if (!roles.includes(user.role)) {
    throw new Error(`Unauthorized: user role "${user.role}" not in [${roles.join(", ")}]`);
  }
  return { role: user.role };
}

function getTier(role: string): number {
  switch (role) {
    case "super_admin": return 5;
    case "admin": return 4;
    case "warehouse_director": return 3;
    case "warehouse_manager":
    case "office_manager":
    case "retail_manager": return 2;
    case "department_manager":
    case "shift_lead": return 1;
    default: return 0;
  }
}
```

**Effort:** 30 minutes

---

**1.2 Lock Down Auth Mutations**

Edit `/convex/auth.ts`:

For `createUser`, `updateUser`, `deleteUser`, `resetUserPassword`, etc., add at the start:

```typescript
handler: async (ctx, args) => {
  // NEW: Verify caller is admin
  const caller = await ctx.db.get(args.callerUserId);  // Add callerUserId arg
  if (!caller || caller.role !== "super_admin") {
    throw new Error("Unauthorized: only super_admin can create/update users");
  }
  // ... rest of function
}
```

**Actions:**
- Change `createUser` to require caller to be super_admin
- Change `updateUser` to require caller to be admin (tier 4+) and prevent escalation above caller's tier
- Change `deleteUser` to require super_admin
- Change `resetUserPassword` to require admin
- Add `callerUserId` argument to all of the above
- Disable `createInitialAdmin` and `seedSuperuser` mutations (or wrap with production check)

**Effort:** 1-2 hours

**Files affected:**
- `/convex/auth.ts` — lines 201-523

---

### 2. URGENT (This Week)

**2.1 Gate Personnel Mutations to T4+ (Admin)**

Edit `/convex/personnel.ts`:

```typescript
export const create = mutation({
  args: {
    // ... existing args
    callerUserId: v.id("users"),  // ADD
  },
  handler: async (ctx, args) => {
    // ADD: Permission check
    const caller = await ctx.db.get(args.callerUserId);
    if (!caller || getTier(caller.role) < 4) {
      throw new Error("Unauthorized: personnel.create requires admin tier (T4+)");
    }
    // ... rest of function
  },
});
```

**Apply to mutations:**
- `create` — require T4+
- `update` — require T4+
- `terminate` — require T4+
- `rehire` — require T4+
- `markNinetyDayReview` — require T2+ (manager can review reports)
- `recordTenureCheckIn` — require T2+

**Effort:** 3-4 hours

**Files affected:**
- `/convex/personnel.ts` — lines 283-1400

---

**2.2 Gate Financial Mutations to T4+ (Admin Only)**

Edit `/convex/mileage.ts`, `/convex/expenseReports.ts`:

```typescript
export const create = mutation({
  args: {
    // ... existing args
    callerUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const caller = await ctx.db.get(args.callerUserId);
    if (!caller || getTier(caller.role) < 4) {
      throw new Error("Unauthorized: expense approval requires admin");
    }
    // ...
  },
});
```

**Apply to:**
- `mileage.create` — require same user (self-submit only) OR T2+ (manager approves)
- `mileage.approve` — require T2+
- `expenseReports.create` — require same user (self-submit) OR T4+ (on behalf of)
- `expenseReports.approve` — require T4+ (financial authority)

**Effort:** 2 hours

**Files affected:**
- `/convex/mileage.ts`
- `/convex/expenseReports.ts`

---

**2.3 Gate Equipment & Location Mutations to T2+**

Edit `/convex/equipment.ts`, `/convex/locations.ts`:

```typescript
export const createScanner = mutation({
  args: {
    // ... existing args
    callerUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const caller = await ctx.db.get(args.callerUserId);
    if (!caller || getTier(caller.role) < 2) {
      throw new Error("Unauthorized: equipment.create requires manager tier (T2+)");
    }
    // ...
  },
});
```

**Apply to:**
- All equipment mutations — require T2+
- All location mutations — require T4+ (admin only for security-critical changes)

**Effort:** 4 hours

**Files affected:**
- `/convex/equipment.ts` — 26 mutations
- `/convex/locations.ts` — 15+ mutations

---

### 3. HIGH PRIORITY (Next 2 Weeks)

**3.1 Gate All Remaining CRUD Mutations**

Apply permission checks to:

- `/convex/shifts.ts` — require T2+
- `/convex/shiftTemplates.ts` — require T4+
- `/convex/documents.ts` — require T2+ (document uploader); T4+ for deletions
- `/convex/events.ts` — verify caller is creator before update/delete
- `/convex/projects.ts` — require T2+ (project owner can modify own)
- `/convex/announcements.ts` — require T5 (super_admin only)
- `/convex/safetyChecklist.ts` — require T2+ (manager reviews); self-submit for employees
- `/convex/messages.ts` — verify caller matches userId for send
- All other mutations — add at minimum a `callerUserId` argument and T0+ check

**Effort:** 8-10 hours

**Files affected:** 30+ files

---

**3.2 Add Audit Logging for Permission Denials**

Whenever a permission check fails, log it:

```typescript
if (!caller || getTier(caller.role) < 4) {
  const now = Date.now();
  await ctx.db.insert("auditLogs", {
    action: "UNAUTHORIZED_ATTEMPT: personnel.create",
    actionType: "unauthorized",
    resourceType: "personnel",
    userId: args.callerUserId,
    userEmail: caller?.email || "unknown",
    details: `Attempt to create personnel without admin tier (user tier: ${getTier(caller?.role || "unknown")})`,
    timestamp: now,
  });
  throw new Error("Unauthorized: personnel.create requires admin tier (T4+)");
}
```

**Effort:** 2-3 hours (template + apply to all mutations)

---

### 4. MEDIUM PRIORITY (Next Month)

**4.1 Location-Based Scoping for Managers**

Managers should only be able to modify personnel, shifts, equipment at their assigned locations:

```typescript
// In update mutation
const caller = await ctx.db.get(args.callerUserId);
const personnel = await ctx.db.get(args.personnelId);

// T2 managers can only modify personnel at their assigned locations
if (getTier(caller.role) === 2) {
  if (!caller.managedLocationIds?.includes(personnel.locationId)) {
    throw new Error("Unauthorized: manager can only modify personnel at assigned locations");
  }
}
```

**Files affected:** personnel.ts, shifts.ts, equipment.ts, etc.

---

**4.2 Implement Permission Key Checking (Backend)**

Add support for `permissionOverrides` in backend checks:

```typescript
export async function hasPermission(
  ctx: Ctx,
  user: any,
  permissionKey: string
): Promise<boolean> {
  // Check overrides first
  if (user.permissionOverrides?.[permissionKey] === true) return true;
  if (user.permissionOverrides?.[permissionKey] === false) return false;
  
  // Fall back to tier-based defaults
  const defaults: Record<string, number> = {
    "personnel.edit": 4,
    "equipment.create": 2,
    // ... etc
  };
  
  return getTier(user.role) >= (defaults[permissionKey] ?? 5);
}
```

---

**4.3 Implement Role-Based Authorization for Department Managers**

Department managers should only be able to approve time, schedules, mileage for their reports:

```typescript
export async function isReporteeOf(
  ctx: Ctx,
  managerId: Id<"users">,
  employeeUserId: Id<"users">
): Promise<boolean> {
  const employee = await ctx.db.get(employeeUserId);
  return employee?.reportsTo === managerId;
}
```

---

### 5. FUTURE (Post-MVP)

- **Implement contextual auth** — Replace custom `userId` args with Convex Auth or equivalent
- **Rate limiting** — Prevent brute-force mutation invocations
- **Mutation validation** — Convex policies to prevent certain data states (e.g., can't have tier > caller's tier)
- **Automated compliance checks** — Ensure all new mutations include permission checks before shipping

---

## Testing Checklist

Before marking RBAC fixes as complete:

- [ ] `auth.createUser` rejects non-admin callers
- [ ] `auth.updateUser` rejects attempts to escalate roles above caller's tier
- [ ] `personnel.create` rejects non-admin callers
- [ ] `personnel.terminate` rejects non-admin callers
- [ ] `mileage.create` only allows self-submit or T2+ approval
- [ ] `expenseReports.approve` rejects non-admin callers
- [ ] `locations.update` rejects non-admin modifications to security codes
- [ ] `safetyChecklist.submit` rejects false/unsigned submissions
- [ ] Audit logs record all permission denial attempts
- [ ] Adding `callerUserId` arg to 50+ mutations doesn't break frontend (coordinate with frontend team)

---

## Final Risk Assessment

| Category | Current State | Risk Level |
|----------|---------------|-----------|
| Personnel management | UNPROTECTED | 🔴 CRITICAL |
| Financial (mileage, expenses) | UNPROTECTED | 🔴 CRITICAL |
| User/auth management | UNPROTECTED | 🔴 CRITICAL |
| Physical security (locations, codes) | UNPROTECTED | 🔴 CRITICAL |
| Schedule/shifts | UNPROTECTED | 🟠 HIGH |
| Documents | UNPROTECTED | 🟠 HIGH |
| Safety/compliance records | UNPROTECTED | 🟠 HIGH |
| Events/announcements | UNPROTECTED | 🟠 HIGH |
| Crons/scheduled tasks | PROTECTED (server-side only) | ✅ OK |
| HTTP webhooks | PROTECTED (secret validation) | ✅ OK |

---

## Conclusion

**The IECentral backend has zero RBAC enforcement.** Every mutation listed in the frontend audit can be called by anyone with the Convex public API key and any `userId`, making unauthorized actions indistinguishable from authorized ones. This is an **identity spoofing vulnerability** affecting ~280 mutations across ~78 files.

**Immediate action required.** The recommendations above prioritize the most critical mutations (auth, personnel, financial) and can be implemented in 1-2 weeks. Completing all fixes will take 4-6 weeks but is essential before shipping to production.

---

**Audit completed:** 2026-05-22  
**Report scope:** Convex backend mutation/action permission enforcement  
**Next steps:** Implement recommendations in priority order; re-audit after changes; coordinate frontend updates to pass `callerUserId` to all mutations.
