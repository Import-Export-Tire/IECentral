# See Something, Say Something — Anonymous Reporting — Design

**Date:** 2026-06-17
**Status:** Approved

## Goal

A printable per-location poster with a QR code that opens a public, anonymous reporting
form. Submissions land in an admin inbox and fire in-app + push + email notifications.

## Components

### 1. Public report form — `/report?loc=<locationId>` (no auth)
Client page (mirrors `/exit-survey/[id]`): renders a form, submits via a public Convex
mutation. No login, **no IP/device logging**.
- **Category** (required, radio/select): Safety hazard · Security / suspicious activity ·
  Theft · Harassment / misconduct · Other.
- **Location** (select, pre-selected from `?loc=`): active locations from `locations` table.
- **Description** (required textarea).
- **When it happened** (optional free text).
- **Optional contact** — name, phone, email, clearly labeled "only if you want follow-up".
- On submit: thank-you screen showing a short **reference code** (e.g. `SR-7F3K2`).
- Generic `/report` (no `loc`) also works; reporter picks a location or leaves blank.

### 2. Backend — `convex/safetyReports.ts` + `safetyReports` table
Schema `safetyReports`:
```
category: v.string()
locationId: v.optional(v.id("locations"))
locationName: v.optional(v.string())
description: v.string()
occurredAt: v.optional(v.string())
reporterName: v.optional(v.string())
reporterPhone: v.optional(v.string())
reporterEmail: v.optional(v.string())
referenceCode: v.string()
status: v.string()            // "new" | "in_review" | "resolved" | "dismissed"
reviewNotes: v.optional(v.string())
reviewedBy: v.optional(v.id("users"))
reviewedByName: v.optional(v.string())
createdAt: v.number()
updatedAt: v.number()
```
Indexes: `by_status`, `by_created`, `by_location` (locationId).

Functions:
- `submit` — **public** mutation (no requestingUserId). Inserts the report with a generated
  `referenceCode` and `status:"new"`, then `ctx.scheduler.runAfter(0, internal.safetyReports.notifyNewReport, { reportId })`. Returns `{ referenceCode }`.
- `notifyNewReport` — internal action: loads the report, resolves recipient users
  (`super_admin` + `admin` roles), and fans out: an in-app notification per recipient
  (mirror `convex/notifications.ts` create), a push (mirror `pushNotifications.ts`), and an
  email alert (existing email send helper) summarizing category + location + reference code,
  linking to `/safety-reports`.
- `list` — admin-guarded query (`requireManagerOrAdmin`/equivalent from `authGuards`), optional
  filters (status, locationId, category), newest first.
- `get` — admin-guarded single report.
- `updateStatus` — admin-guarded: sets `status`, `reviewNotes`, `reviewedBy/Name`, `updatedAt`.

Reference code: derived deterministically in the mutation from non-time-varying inputs is not
required; generate from `Date.now()` + a short random-ish suffix built from the inserted id.
(Convex mutations may use `Date.now()`.)

### 3. Admin inbox — `/safety-reports` (authed, admin/HR only)
- Guarded page (follow existing admin-page guard pattern; redirect/empty if not permitted).
- Table/cards of reports with status + category + location + age; filter by status/location/
  category; detail panel with full description + optional contact; status control + review
  notes textarea (saves via `updateStatus`).
- Sidebar link added under an appropriate group (e.g. near Safety Checks), visibility gated to
  the same roles.

### 4. Printable poster + QR — `/safety-reports/posters`
- Lists active locations; each row has a **Print poster** action.
- Poster is a print-optimized full page: large "If You See Something, Say Something" heading,
  one-line instructions ("Scan to report a safety or security concern — anonymously."), the
  location name, and a QR code (via `qrcode.react`, reused from `components/QRCodeModal.tsx`)
  encoding `${NEXT_PUBLIC_APP_URL||"https://www.iecentral.com"}/report?loc=<locationId>`.
- A print stylesheet hides app chrome; user prints via browser **Print → Save as PDF**.
- Also offer a **generic poster** (no location) encoding `/report`.

## Data flow
Poster QR → public `/report?loc=…` → `safetyReports.submit` → scheduler → `notifyNewReport`
(in-app + push + email to admins) + row in `/safety-reports` inbox → admin triages via
`updateStatus`.

## Error handling
- Form: client-side required-field validation; submit failure shows an inline error, no data
  loss. Mutation is the only write.
- `notifyNewReport` is best-effort — each channel (in-app/push/email) wrapped so one failing
  doesn't block the others or the submission (submission already committed before it runs).
- Unknown/missing `loc` on the form → location simply unselected; submission still allowed.

## Security / privacy
- `submit` is intentionally unauthenticated (anonymous). It writes only what the reporter types;
  no IP, headers, or identifiers are captured.
- All read/manage functions require admin role via `authGuards`.

## Testing
- `submit` returns a reference code and creates a `new` report.
- `updateStatus` rejects a non-admin requestingUserId.
- Reference-code format stable; list filters narrow correctly.
- Manual: scan/open `/report?loc=<id>` → submit → appears in `/safety-reports`, notification +
  email fire; print a poster → QR resolves to the right location URL.

## Out of scope
- Per-report file/photo attachments (could add later).
- A settings screen for recipients (role-based for now).
- Server-side PDF generation (print-to-PDF instead).
