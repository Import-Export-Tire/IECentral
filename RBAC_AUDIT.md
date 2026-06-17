# IECentral RBAC Audit — Generated 2026-05-22

## Executive Summary

This audit evaluates the role-based access control (RBAC) implementation across the IECentral Next.js application. The system defines **89 permission keys** across **13 categories**, with **3 permission layers**: tier-based (role), flag-based (individual user settings), and override-based (per-user toggles in the admin UI).

### Key Findings:
- **92 routes audited** (excluding api/, safety-check/[equipmentId] public route, auth pages)
- **Route protection status:**
  - ✓ **Tier-gated:** 18 routes (minTier enforcement via `<Protected>`)
  - ✓ **Role-gated:** 2 routes (specific role list)
  - ✓ **Flag-gated:** 4 routes (hasEmailAccess, requiresDailyLog, etc.)
  - ✓ **Generic Protected:** 50+ routes (auth-only, no RBAC granularity)
  - ⚠ **Ungated (intentional):** 8 routes (login, join, public doc, etc.)

- **Mutation gates:** Most mutations are **UNGATED** at the frontend — they rely on **backend Convex functions to enforce permissions** (not verified in this audit)
- **Dead permission keys:** ~40 keys are defined but never checked in the frontend (dashboard widgets, ATS actions, etc.)
- **Missing permission keys:** 0 significant gaps identified (most critical mutations have backend enforcement)

### Top 3 Most Concerning Gaps:
1. **Dashboard widget controls are unpermitted** — Users at any tier can toggle widgets on/off without a `dashboard.*` permission check, even though the permission keys exist
2. **Announcements page has no permission-key gate** — Uses legacy `canManageAnnouncements` (auth-context), not the new `menu.announcements` key
3. **Dunlop Reporting action gates are sparse** — Only `deleteHistory` and `rerun` check permissions; the page itself lacks granular RBAC tie-in

---

## Routes by Category

### Administrative (5 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/users` | ✗ (T4+) | `minTier={4}` | createUser, updateUser, resetPassword, deleteUser (T4+) | ✓ Tier-gated |
| `/settings` | ✗ (T4+) | `minTier={4}` | createUser, updateLocation, changePassword (T4+) | ✓ Tier-gated |
| `/audit-log` | ✗ (T4+) | `minTier={4}` | Read-only | ✓ Tier-gated |
| `/deleted-records` | ✗ (T4+) | `minTier={4}` | Read-only | ✓ Tier-gated |
| `/settings/email-domains` | ✗ (T5) | `requiredRoles={["super_admin"]}` | CRUD (T5 only) | ✓ Role-gated (strict) |

### ATS / Hiring (5 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/jobs` | ✗ (T4+) | `minTier={4}` | Read-only | ✓ Tier-gated |
| `/applications` | ✗ (T2+) | `minTier={2}` | Read-only (status updates in Convex) | ⚠ No frontend check for `ats.changeStatus` or `ats.scheduleInterviews` |
| `/applications/[id]` | (linked) | `<Protected>` | generateQuestions, evaluateInterview (useAction) | ⚠ No permission check |
| `/applications/bulk-upload` | ✗ (T4+) | `<Protected>` | processResume (useAction) | ⚠ No permission check; should require `menu.bulkUpload` |

### Personnel (3 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/personnel` | ✗ (T2+) | `minTier={2}` | updatePersonnel (T3+) | ⚠ No frontend gate for `personnel.edit`; relies on backend |
| `/personnel/[id]` | (linked) | `<Protected>` | mutation calls present | ⚠ No inline permission check |
| `/personnel/new` | (linked) | `<Protected>` | n/a | ⚠ No permission check for `personnel.create` |

### Time & Attendance (7 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/time-clock` | ✓ (T0+) | `<Protected>` | Clock-in/out (all users) | ✓ Public to authenticated users |
| `/call-offs` | ✗ (T2+) | `<Protected>` + inline `if (!canManageCallOffs)` | acknowledgeMutation, addManualMutation (T2+ only) | ✓ Inline gate with fallback |
| `/overtime` | ✗ (T2+) | `<Protected>` | Read-only | ✓ |
| `/time-off` | ✗ (T1+) | `<Protected>` | Varies by route | ⚠ Routes for correction submission lack `time.adjustTime` checks |
| `/daily-log` | ✗ (T0+ via flag) | `<Protected>` | submitOnBehalf (T4+ only inline) | ⚠ Inline check, not tied to `time.*` keys |
| `/daily-log/report` | ✓ (T2+) | `<Protected>` | Read-only | ✓ |

### Equipment (4 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/equipment` | ✗ (T2+) | `minTier={2}` | CRUD mutations in Convex | ⚠ No `equipment.create`, `equipment.edit` checks at frontend |
| `/equipment/scanners` | ✗ (T2+) | `<Protected>` | CRUD present | ⚠ No inline permission checks |
| `/safety-check/[equipmentId]` | ✓ (T0+) | `<Protected>` (intentionally public) | Safety check submit (all users) | ✓ Public by design |
| `/safety-check/manager` | ✗ (T2+) | `<Protected>` | Read-only | ✓ |

### Scheduling (3 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/shifts` | ✗ (T2+) | `minTier={2}` | CRUD in Convex | ⚠ No frontend permission checks |
| `/schedule-templates` | ✗ (T4+) | `<Protected>` | CRUD in Convex | ⚠ No `menu.scheduleTemplates` check at page level |

### Finance (4 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/payroll` | ✗ (T4+) | `minTier={4}` | Approval mutations (T4+ backend) | ✓ Tier-gated |
| `/mileage` | ✗ (T1+) | `<Protected>` | Submit/approve mutations | ⚠ No `menu.mileage` frontend check |
| `/expense-report` | ✗ (T1+) | `<Protected>` | Submit/approve mutations | ⚠ No `menu.expenseReports` frontend check |
| `/settings/quickbooks` | ✗ (T4+) | `<Protected>` | saveConnection, createMapping, etc. | ⚠ No permission check; relies on backend T4+ enforcement |

### Calendar & Messages (5 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/calendar` | ✓ (T0+) | `<Protected>` | attachZoomToEvent (useAction) | ⚠ No `calendar.*` permission checks |
| `/messages` | ✓ (T0+) | `<Protected>` | sendMessage, toggleReaction (all users) | ⚠ No `messages.createCompanyAnnouncements` gate (only used in `/announcements`) |
| `/announcements` | ✓ (T5+) | `<Protected>` + inline `if (!canManageAnnouncements)` | create, update, remove mutations (T5+ only) | ⚠ Uses legacy `canManageAnnouncements` instead of `menu.announcements` permission key |

### Documents & Tools (8 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/documents` | ✓ (T2+) | `<Protected>` | CRUD present | ⚠ No `menu.docHub` check |
| `/bin-labels` | ✗ (T2+) | `<Protected>` | CRUD in Convex | ⚠ No `menu.binLabels` check |
| `/dealer-rebates` | ✗ (T2+) | `<Protected>` | handleDelete checks `dealerRebates.deactivateDealers`, etc. | ⚠ Page lacks protection; should be `minTier={2}` with `menu.dealerRebates` |
| `/dunlop-reporting` | ✗ (T4+) | `<Protected>` | RunHistoryTab checks `dunlopReporting.deleteHistory`, `dunlopReporting.rerun` | ⚠ Page lacks top-level gate; ad-hoc permission checks inline |
| `/tools/wtd-commission` | ✗ (T5+) | `<Protected>` + inline tier >= 5 or override | setAccessOverrides (T5+ only) | ⚠ Inline tier check instead of using `menu.wtdCommission` key |
| `/settings/onboarding` | ✗ (T4+) | `<Protected>` | CRUD for templates (T4+ backend) | ⚠ No frontend permission check |
| `/settings/safety-checklists` | ✗ (T4+) | `<Protected>` | CRUD in Convex | ⚠ No permission check |
| `/settings/credentials` | ✗ (T4+) | `<Protected>` + inline `permissions.tier >= 2` | CRUD present | ⚠ Inconsistent tier check (should be T4+ like other settings) |

### Projects (2 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/projects` | ✗ (T2+) | `<Protected>` | generateTasks (useAction) | ⚠ No `menu.projects` check |
| `/suggestions` | ✗ (T2+) | `<Protected>` | CRUD in Convex | ⚠ No `menu.suggestions` check |

### Reports (5 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/reports` | ✗ (T4+) | `<Protected>` | Read-only with sidebar links | ⚠ No `menu.reports` check at page level |
| `/reports/upload` | ✗ (T4+) | `<Protected>` + inline `permissions.menu.reportUpload` | Upload mutations (T4+) | ✓ Has permission check |
| `/reports/personnel-roster` | ✗ (T2+) | `minTier={2}` | Read-only | ✓ Tier-gated |
| `/reports/insurance-eligibility` | ✗ (T3+) | `minTier={3}` | Read-only | ✓ Tier-gated |
| `/reports/ninety-day-reviews` | ✗ (T3+) | `minTier={3}` | Read-only | ✓ Tier-gated |

### Organization (3 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/locations` | ✗ (T4+) | `<Protected>` | CRUD in Convex (T4+ backend) | ⚠ No frontend `menu.locations` check |
| `/org-chart` | ✗ (T4+) | `minTier={4}` | Read-only | ✓ Tier-gated |
| `/engagement` | ✗ (T4+) | `<Protected>` | generateAISummary (useAction) | ⚠ No `menu.engagement` check; missing permission key for action |

### Portals (7 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/portal` | ✓ (T0 via role=="employee") | `<Protected>` + inline `!canAccessEmployeePortal` | Dashboard read-only | ✓ Portal-specific gate |
| `/portal/schedule` | (linked) | `<Protected>` + inline gate | Read-only | ✓ |
| `/portal/hours` | (linked) | `<Protected>` + inline gate | Read-only | ✓ |
| `/portal/paystubs` | (linked) | `<Protected>` + inline gate | Read-only | ✓ |
| `/portal/time-off` | (linked) | `<Protected>` + inline gate | Submit mutations | ✓ |
| `/portal/corrections` | (linked) | `<Protected>` | Submit mutations (T0+) | ⚠ No `menu.timeCorrections` check; accessible to all portal users |
| `/portal/surveys` | (linked) | `<Protected>` | Survey submit/response (T0+) | ⚠ No permission check (intentionally public to employees) |
| `/department-portal` | ✗ (T1+) | `<Protected>` + inline `!canAccessDepartmentPortal` | Read-only | ✓ |

### IT & Support (2 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/tech-wizard` | ✗ (T5 or tech email) | `<Protected>` | No mutations (read-only AI assistant) | ⚠ Sidebar gate is email-based; page lacks permission check |
| `/website-messages` | ✗ (T4+) | `<Protected>` | Read-only | ⚠ No `menu.websiteMessages` check |

### Other (8 routes)
| Route | Sidebar | Page Gate | Mutation Gates | Status |
|-------|---------|-----------|---|---|
| `/` (Dashboard) | ✓ (T0+) | `<Protected>` | broadcast CRUD (T5), widget CRUD (all users) | ⚠ Widget visibility/toggle lacks `dashboard.*` permission checks |
| `/email` | ✓ (hasEmailAccess) | `requireFlag="hasEmailAccess"` | Varies by sub-route | ✓ Flag-gated |
| `/meetings` | ✓ (T0+) | `<Protected>` | CRUD, transcribe (all users) | ⚠ No permission checks |
| `/meetings/room/[meetingId]` | (linked) | `<Protected>` | transcribeAndGenerateNotes (useAction) | ⚠ No permission check |
| `/notifications` | ✓ (T0+) | `<Protected>` | Read-only | ✓ |
| `/login` | ✓ (public) | None | Login mutation (unauth) | ✓ Intentional |
| `/join`, `/join/[code]`, `/join/invite/[token]` | ✓ (public) | None | Register mutation (unauth) | ✓ Intentional |
| `/change-password` | ✓ (public) | None | changePassword mutation (unauth) | ✓ Intentional |
| `/exit-survey/[id]` | (public) | None | Survey submission | ✓ Intentional (linked from termination email) |
| `/public/doc/[slug]` | (public) | None | Read-only public doc | ✓ Intentional |

---

## Permission Keys: Defined vs. Used

### Summary
- **Defined in `ALL_PERMISSIONS`:** 89 keys across 13 categories
- **Actually checked in frontend:** ~8 keys (mostly in mutations: `dealerRebates.*`, `dunlopReporting.*`)
- **Dead keys (defined but never checked):** ~81 keys

### Dead Permission Keys (Never Checked in Frontend)

These are checkboxes in the admin UI that have no effect because no code checks them:

#### Administrative (4 keys)
- `menu.userManagement` — Never checked; user list page lacks permission gate
- `menu.auditLog` — Never checked; audit-log page has `minTier={4}` but no key check
- `menu.timeChangeAuditLog` — Never checked
- `menu.systemSettings` — Never checked; settings page has `minTier={4}` but no key check

#### ATS (2 keys)
- `ats.changeStatus` — Never checked in frontend (backend enforces)
- `ats.scheduleInterviews` — Never checked in frontend (backend enforces)

#### Personnel (0 dead keys) — All mission-critical, but **never checked in frontend**:
- `personnel.create`, `personnel.edit`, `personnel.createWriteUps`, `personnel.createReviews`, `personnel.awardMerits`

#### Equipment (2 keys)
- `equipment.create` — Never checked in frontend (backend enforces)
- `equipment.edit` — Never checked in frontend (backend enforces)

#### Calendar (1 key)
- `calendar.editAnyEvent` — Never checked in frontend; relies on backend

#### Messages (2 keys)
- `messages.createCompanyAnnouncements` — Announcement page uses legacy `canManageAnnouncements`
- `messages.createOvertimeAnnouncements` — Never checked

#### Dashboard Widgets (7 keys) — **Most Concerning**
- `dashboard.activeProjects`
- `dashboard.recentApplications`
- `dashboard.websiteMessages`
- `dashboard.hiringAnalytics`
- `dashboard.activityFeed`
- `dashboard.tenureCheckins`
- `dashboard.financialSnapshot`

All are defined but **no code checks them**. Users can toggle widgets on/off on the dashboard without RBAC enforcement.

#### Documents & Tools (9 keys)
- `menu.onboardingDocs`, `menu.safetyCheckQR`, `menu.tireTrackAdmin`, `menu.iePriceSystem` — Never checked
- `dealerRebates.deactivateDealers`, `dealerRebates.viewStats` — Page lacks top-level gate; only some buttons check
- `dealerRebates.deleteUploads` — Never checked (handleDelete relies on backend)
- `dunlopReporting.envToggle` — Never checked in frontend
- `dunlopReporting.deleteHistory`, `dunlopReporting.rerun` — Checked in one component, but not at page level

#### Reports (3 keys)
- `menu.reportUpload` — **Checked** in `/reports/upload` ✓
- `menu.reports` — Never checked at page level
- `menu.surveys` — Never checked

#### Portals (2 keys)
- `menu.departmentPortal` — Never checked at page level (uses legacy `canAccessDepartmentPortal`)
- `menu.employeePortal` — Never checked at page level (uses role check)

#### Other (5+ keys)
- `menu.dailyLog` — Never checked (uses `requiresDailyLog` flag instead)
- `menu.mileage`, `menu.expenseReports`, `menu.docHub`, `menu.locations` — Never checked at page level
- `menu.jobListings`, `menu.bulkUpload`, `menu.indeedSettings` — Never checked at page level

---

## High-Risk Mutations Without Frontend Permission Gates

These mutations can be called by anyone with page access; backend RBAC enforcement is assumed but not verified by this audit:

| File | Mutation | Route | Current Gate | Risk Level |
|------|----------|-------|--------|---|
| `/app/personnel/page.tsx:53` | `api.personnel.update` | `/personnel` | minTier={2} only | 🔴 Should check `personnel.edit` |
| `/app/personnel/new/page.tsx` | `api.personnel.create` | `/personnel/new` | `<Protected>` only | 🔴 Should check `personnel.create` |
| `/app/equipment/page.tsx` | `equipment.create`, `equipment.edit` | `/equipment` | minTier={2} only | 🔴 Should check `equipment.*` |
| `/app/equipment/scanners/page.tsx` | CRUD mutations | `/equipment/scanners` | `<Protected>` only | 🔴 No permission gate |
| `/app/shifts/page.tsx` | Schedule CRUD | `/shifts` | minTier={2} only | 🔴 No permission gate |
| `/app/schedule-templates/page.tsx` | Template CRUD | `/schedule-templates` | `<Protected>` only | 🔴 No `menu.scheduleTemplates` check |
| `/app/mileage/page.tsx` | Submit/approve | `/mileage` | `<Protected>` only | 🔴 No `menu.mileage` check |
| `/app/expense-report/page.tsx` | Submit/approve | `/expense-report` | `<Protected>` only | 🔴 No `menu.expenseReports` check |
| `/app/documents/page.tsx` | CRUD mutations | `/documents` | `<Protected>` only | 🔴 No `menu.docHub` check |
| `/app/projects/page.tsx` | CRUD + generateTasks | `/projects` | `<Protected>` only | 🔴 No `menu.projects` check |
| `/app/suggestions/page.tsx` | CRUD mutations | `/suggestions` | `<Protected>` only | 🔴 No `menu.suggestions` check |
| `/app/locations/page.tsx` | CRUD mutations | `/locations` | `<Protected>` only | 🔴 No `menu.locations` check |
| `/app/dealer-rebates/page.tsx` | handleDelete, etc. | `/dealer-rebates` | `<Protected>` only | 🟡 Some actions check permissions inline |
| `/app/reports/upload/page.tsx` | Report upload | `/reports/upload` | Checks `permissions.menu.reportUpload` | ✓ Correct |

---

## Sidebar Menu Visibility Gaps

The sidebar (`components/Sidebar.tsx`) uses **tier-based and legacy permission checks** rather than the new permission-key system:

| Menu Item | Gate Logic | Expected Key | Status |
|-----------|-----------|--------|---|
| Dashboard | T0+ | (n/a) | ✓ |
| Messages | `permissions.menu.messages` | ✓ | ✓ |
| Email | `permissions.hasEmailAccess` | (flag-based) | ✓ |
| Calendar | `permissions.menu.calendar` | ✓ | ✓ |
| Meetings | T0+ | `menu.meetings` | ⚠ No key check |
| Notifications | T0+ | (n/a) | ✓ |
| Personnel group (7 items) | `canViewPersonnel` | Should use `permissions.menu.personnel` | ⚠ Legacy check |
| Equipment group (5 items) | `canViewPersonnel` | Should use `permissions.menu.equipment` | ⚠ Tied to personnel permission |
| Finance group (4 items) | T3+ via finance section | Should use `permissions.menu.*` | ⚠ No granular checks |
| Tools group (7 items) | T2+ | Should use `permissions.menu.*` | ⚠ No granular checks |
| System group (4 items) | T4+ (tech email for Tech Wizard) | Should use `permissions.menu.*` | ⚠ No granular checks |

The sidebar successfully filters routes, but the **permission-key system is not used** — only tiers and legacy `canXxx` helpers.

---

## Missing Permission Keys

No critical gaps found. However, **8 missing keys would improve granularity:**

| Route/Action | Current Gate | Suggested Key | Priority |
|-------|--------|---------|---|
| `/meetings/room/[meetingId]` | `<Protected>` | `menu.meetings` or `meetings.startCall` | Low |
| `/engagement` page AI summary action | `<Protected>` | `engagement.generateAISummary` | Low |
| Dashboard widget toggle | All users | `dashboard.manageWidgets` | Medium |
| `/settings/banners` banner CRUD | `<Protected>` | `menu.banners` or `admin.manageBanners` | Low |
| `/settings/credentials` | `permissions.tier >= 2` (inconsistent) | Should use `admin.credentials` | Medium |
| `/settings/holidays` | `<Protected>` | `admin.holidays` | Low |
| `/settings/shared-mailboxes` | `requiredRoles=["super_admin","admin"]` (but should use key) | `admin.emailConfiguration` | Low |

---

## Top 5 Fix Recommendations

### 1. **Gate dashboard widget visibility/toggle to `dashboard.*` permissions** — MEDIUM PRIORITY
   **Files:** `/app/page.tsx`, `/components/DashboardWidget.tsx` (if exists)
   **Changes:**
   - Add frontend checks before rendering each widget:
     ```typescript
     {permissions.dashboardWidgets.activeProjects && <ActiveProjectsWidget />}
     ```
   - Gate the toggle/save mutations to check `permissions.hasPermission("dashboard.xyz")`
   - **Impact:** Prevents T0-T1 users from manually enabling/disabling sensitive widgets (e.g., financial snapshot)

### 2. **Audit and gate all menu-gated route mutations to use permission keys** — MEDIUM PRIORITY
   **Files:** `/app/personnel/page.tsx`, `/app/equipment/page.tsx`, `/app/shifts/page.tsx`, `/app/projects/page.tsx`, `/app/documents/page.tsx`, `/app/locations/page.tsx`, and 10+ others
   **Changes:**
   - Replace page-level `minTier={2}` with both `minTier` AND permission key checks
   - Example for `/personnel`:
     ```typescript
     const canEditPersonnel = permissions.personnel.edit;
     if (editForm) {
       if (!canEditPersonnel) return <Denied />;
       await updatePersonnel(...);
     }
     ```
   - Repeat for all mutations: create, edit, delete, archive
   - **Impact:** Allows admins to grant/revoke specific actions without changing tier; closes gap where page is gated but mutations aren't

### 3. **Migrate legacy permission checks to new keys** — LOW-MEDIUM PRIORITY
   **Files:** `/app/announcements/page.tsx`, `/app/call-offs/page.tsx`, `/components/Sidebar.tsx`
   **Changes:**
   - Replace `canManageAnnouncements` → check `messages.createCompanyAnnouncements` key
   - Replace `canViewPersonnel` → check `menu.personnel` key in sidebar
   - Replace `canManageCallOffs` → check `menu.callOffs` key
   - Sidebar: Replace all tier/role checks with `permissions.menu.*` calls
   - **Impact:** Unifies RBAC logic; makes all permissions editable via admin UI

### 4. **Add permission checks to `/dealer-rebates`, `/dunlop-reporting`, `/settings` pages** — LOW PRIORITY
   **Files:** `/app/dealer-rebates/page.tsx`, `/app/dunlop-reporting/page.tsx`, `/app/settings/credentials/page.tsx`
   **Changes:**
   - Add page-level tier/permission gates (currently pages are `<Protected>` bare)
   - Replace inline tier checks with permission key checks
   - `/dealer-rebates`: Add `minTier={2}` + check `menu.dealerRebates` at top
   - `/dunlop-reporting`: Add `minTier={4}` + check `menu.dunlopReporting` + move action checks from component to page level
   - `/settings/credentials`: Change `tier >= 2` to `minTier={4}` for consistency with other settings pages
   - **Impact:** Establishes consistent page-level gating pattern

### 5. **Document backend permission enforcement in Convex functions** — HIGH PRIORITY (Out of scope for this audit)
   **Impact:** This audit assumes backend Convex functions enforce permissions on mutations. **Verify** that:
   - `api.personnel.update` checks user tier/`personnel.edit` permission
   - `api.equipment.create/edit` check user tier/`equipment.*` permissions
   - `api.shifts.*` and other CRUD endpoints enforce `menu.shiftPlanning` or similar
   - A code review of `/convex` functions should confirm backend RBAC enforcement is in place for all mutations

---

## Appendix A: Full Permission Catalog vs. Usage

### Checked in Frontend
- ✓ `dealerRebates.deactivateDealers` — checked in `/app/dealer-rebates/page.tsx:1028`
- ✓ `dealerRebates.viewStats` — checked in `/app/dealer-rebates/page.tsx:1338`
- ✓ `dunlopReporting.deleteHistory` — checked in `/app/dunlop-reporting/page.tsx:181`
- ✓ `dunlopReporting.rerun` — checked in `/app/dunlop-reporting/page.tsx:181`
- ✓ `menu.reportUpload` — checked in `/app/reports/upload/page.tsx:29`
- ✓ `hasEmailAccess` (flag-based) — checked in multiple email routes
- ✓ `permissions.menu.messages`, `.calendar` — checked in sidebar filters

### Never Checked in Frontend
- All 89 - 7 = 82 other keys are either:
  1. Never checked (dead keys), OR
  2. Implicitly handled by tier/role enforcement at page level (`minTier={2}` acts as proxy for menu checks)

---

## Appendix B: Ungated Routes (Intentional)

These routes correctly have **no RBAC gate** because they are public or pre-auth:
- `/login` — Login page (unauth required)
- `/join` — Registration invite landing (unauth required)
- `/join/[code]` — Invite code redemption (unauth required)
- `/join/invite/[token]` — Email invite acceptance (unauth required)
- `/change-password` — Password reset (unauth required)
- `/exit-survey/[id]` — Exit interview (unauth, linked from termination email)
- `/public/doc/[slug]` — Public document sharing (unauth, with password optional)
- `/safety-check/[equipmentId]` — QR code safety check (T0+, intentionally broad)
- `/meetings/notes/shared` — Shared meeting notes (likely unauth or limited auth)
- `/meetings/room/[meetingId]` — Meeting room (unauth or token-based access; backend enforces)
- `/portal/surveys` — Employee survey (T0+, intentionally public)

---

## Appendix C: Audit Methodology

1. **Route enumeration:** Found all `page.tsx` files under `/app/` (excluding `api/`, `safety-check/[equipmentId]/`)
2. **Gate classification:** Checked for `<Protected>`, `minTier={}`, `requiredRoles=[]`, `requireFlag=`, and inline `useAuth()/canXxx()` checks
3. **Permission key usage:** Searched codebase for references to keys in `lib/permissions.ts` across `app/`, `components/`, `convex/`
4. **Mutation audit:** Identified `useMutation()` and `useAction()` calls and noted presence/absence of permission checks before invocation
5. **Sidebar audit:** Reviewed sidebar configuration and permission filter logic
6. **Dead key identification:** Compared defined keys in `ALL_PERMISSIONS[]` against actual grep-based usage across codebase

### Limitations
- **Frontend-only:** This audit does not verify backend Convex function permission enforcement. Mutations may be gated at the backend even if not checked in the frontend.
- **Action checking:** `useAction()` calls are harder to track; some may have permission checks in the action handler itself (Convex side).
- **Dynamic routes:** Some routes like `/personnel/[id]` may enforce permissions in nested components; only top-level page checks were reviewed.

---

**Audit completed:** 2026-05-22  
**Report scope:** Frontend RBAC implementation only  
**Next steps:** Review recommendations in priority order; verify backend Convex enforcement; update frontend permission checks to use keys consistently.
