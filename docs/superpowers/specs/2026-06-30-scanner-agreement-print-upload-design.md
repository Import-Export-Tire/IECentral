# Scanner Agreement — Print & Upload (paper-signing path)

> Design spec. Created 2026-06-30 (branch `main`). Point-in-time — verify `file:line`
> references against current code before editing.

## Goal

Let an admin handle the scanner Equipment Responsibility Agreement on **paper** as an
alternative to the on-screen signature: **print** the pre-filled agreement, have the
employee sign it by hand, then **upload** the signed copy to complete the assignment.
Both paths (on-screen signature **and** upload) remain available.

### Success criteria
- From the Assign modal, an admin can print a one-page PDF of the agreement pre-filled with
  the assignee, scanner #, serial, terms, and a signature/printed-name/date line.
- An admin can complete an assignment by **either** drawing a signature **or** uploading a
  signed copy (photo/scan or PDF). Assignment requires at least one of the two.
- For an already-assigned scanner, an admin can reprint the agreement and attach a signed copy
  after the fact.
- The agreement record shows how it was signed (drawn vs uploaded paper) with a link to view/
  download the uploaded copy.

### Non-goals
- No change to the agreement's legal text or terms.
- No e-signature/audit-trail beyond what exists (witnessedBy + timestamp).
- Pickers get the shared backend changes for free, but the UI entry points in this spec are the
  **scanner** detail page only (picker UI can adopt the same components later).

---

## Current state (what exists)

- **Agreement record** — `equipmentAgreements` table (`convex/schema.ts:994`): `equipmentType`,
  `equipmentId`, `personnelId`, `equipmentNumber`, `serialNumber`, `equipmentValue`,
  `agreementText` (full text), `signatureData` (**required** base64 drawn signature), `signedAt`,
  `witnessedBy`/`witnessedByName`, revocation fields, `createdAt`.
- **Assign mutation** — `convex/equipment.ts:796 assignEquipmentWithAgreement` (args:
  `equipmentType`, `equipmentId`, `personnelId`, `signatureData` **(required)**, `userId`,
  `userName`, `equipmentValue?`). Guarded by `requireManagePersonnel`. Inserts the agreement,
  patches equipment to `assigned`, writes an `equipmentHistory` row. Agreement text is built by
  `generateAgreementText(...)` (`convex/equipment.ts:748`).
- **Read** — `getEquipmentAgreement` (`convex/equipment.ts:1001`) returns the active agreement;
  `getAgreementsForPersonnel` (`:1022`).
- **Assign UI** — `app/equipment/scanners/[id]/page.tsx`: 2-step Assign modal; step 1 picks the
  person, step 2 shows the agreement text + `<SignaturePad>` (`components/SignaturePad.tsx`) →
  `handleAssign` calls `assignWithAgreement`. Client builds preview text via `getAgreementText()`
  (`:161`). `EQUIPMENT_VALUE` constant in the page.
- **Reusable patterns:** `jsPDF` is already a dependency, used for one-page PDFs in
  `app/safety-reports/page.tsx` and `app/bin-labels/page.tsx`. Convex storage upload flow
  (`generateUploadUrl` → `POST` → store `_storage` id) is used by Doc Hub
  (`convex/documents.ts`). A sibling flow already stores an optional
  `signedDocumentStorageId: v.id("_storage")` (`convex/schema.ts:2198`) — mirror it.

---

## Design

### 1. Print agreement (PDF)
A **"Print Agreement"** button renders a one-page PDF with `jsPDF` (mirror
`app/safety-reports/page.tsx`'s pattern: dynamic `import("jspdf")`, Letter portrait, hidden-iframe
print). Content: a title, the **pre-filled** agreement body (reuse the same text the modal shows —
extract `getAgreementText()` into a shared helper so the PDF and the on-screen text never drift),
then a signature block at the bottom: **Signature ____  Printed name ____  Date ____**.

A small client helper `lib/equipmentAgreementPdf.ts` exports `printAgreementPdf({ personName,
equipmentNumber, serialNumber, equipmentValue, agreementText })`. Used from:
- Assign modal (enabled once a person is selected in step 1/2).
- The existing-assignment panel ("Print Agreement" / reprint).

### 2. Upload signed copy (completes the assignment)
**Schema** (`convex/schema.ts` `equipmentAgreements`):
- Make `signatureData` **optional** (`v.optional(v.string())`) — a record may be proven by a drawn
  signature OR an uploaded paper.
- Add `signedDocumentStorageId: v.optional(v.id("_storage"))` and
  `signedDocumentType: v.optional(v.string())` (mime, e.g. `image/jpeg`, `application/pdf`).

**Backend** (`convex/equipment.ts`):
- `generateAgreementUploadUrl` — `mutation({ requestingUserId })` → `requireManagePersonnel` →
  `ctx.storage.generateUploadUrl()`.
- `assignEquipmentWithAgreement` — change `signatureData` to optional; add optional
  `signedDocumentStorageId` + `signedDocumentType`. **Validate: at least one of
  `signatureData` / `signedDocumentStorageId` is present**, else throw. Persist whichever is
  given. (Keep all other behavior: equipment patch + history row.)
- `attachSignedAgreement` — `mutation({ equipmentType, equipmentId, signedDocumentStorageId,
  signedDocumentType, requestingUserId })` → `requireManagePersonnel` → find the active
  (non-revoked) agreement for that equipment and `patch` the signed-doc fields onto it. Errors if
  no active agreement.
- `getSignedAgreementUrl` — `action({ storageId })` → `ctx.storage.getUrl(storageId)` so the UI
  can view/download the uploaded copy. (Read; gate at the page/UI level as the other equipment
  reads are.)

**Frontend** (`app/equipment/scanners/[id]/page.tsx`):
- Assign modal step 2 gets a segmented toggle: **Sign on screen** | **Print & upload signed copy**.
  - *Sign on screen* → existing `<SignaturePad>` (unchanged).
  - *Print & upload* → the **Print Agreement** button + a file input (`accept="image/*,.pdf"`).
    On file pick: `generateAgreementUploadUrl` → `POST` the file → keep the returned storageId +
    mime in state; show the filename.
  - `handleAssign` sends `signatureData` (if drawn) **or** `signedDocumentStorageId` +
    `signedDocumentType` (if uploaded). The Assign button is disabled until a person is selected
    **and** one of (drawn signature / uploaded file) is present.
- Existing-assignment panel: **Print Agreement** (reprint) and **Attach signed copy** (file input →
  upload → `attachSignedAgreement`).
- Agreement display: show "Signed on screen" or "Signed copy uploaded" with a **View / Download**
  link (calls `getSignedAgreementUrl`) when a `signedDocumentStorageId` exists.

### Data flow (upload path)
`pick person → [Print & upload] → print PDF → sign on paper → choose file →
generateAgreementUploadUrl → POST file to storage → handleAssign({signedDocumentStorageId,
signedDocumentType}) → assignEquipmentWithAgreement inserts agreement (no signatureData) +
marks equipment assigned`.

### Error handling
- Upload failure (network / bad file) → surface an inline error; do not mark assigned.
- Assign with neither signature nor file → blocked client-side (disabled button) and server-side
  (mutation throws) — defense in depth.
- `attachSignedAgreement` with no active agreement → returns a clear error.

---

## Constraints
- **Both options kept** — drawn signature and uploaded copy are equally valid; **at least one** required (a record may have either, or both).
- Manager-only (`requireManagePersonnel`) for assign/attach/upload-url, matching the existing flow.
- The on-screen agreement text and the printed PDF must come from **one shared text helper** (no
  drift).
- Mobile-friendly (the assign modal was just mobile-hardened) and correct in **light + dark**.
- The uploaded file is viewable/downloadable by managers via a short-lived storage URL.

## Verification plan
- No unit-test runner in this project → gate on `npx tsc --noEmit` + `npm run build`.
- Manual (logged in, on a scanner): (a) print → PDF opens pre-filled with the right person/scanner;
  (b) assign via drawn signature still works; (c) assign via uploaded photo + via uploaded PDF
  works and the record shows "uploaded" with a working View link; (d) Assign button stays disabled
  with neither; (e) reprint + attach-signed-copy work on an already-assigned scanner; (f) check the
  modal on a phone and in dark mode.

## Out of scope
- Picker UI entry points (backend changes are shared and ready; picker page can adopt later).
- Changing agreement legal text, OCR/parsing of the uploaded copy, or multi-page agreements.

## Key files
- `convex/schema.ts:994` (equipmentAgreements) — optional `signatureData`, add `signedDocumentStorageId`/`signedDocumentType`.
- `convex/equipment.ts` — `assignEquipmentWithAgreement` (:796), `generateAgreementText` (:748);
  add `generateAgreementUploadUrl`, `attachSignedAgreement`, `getSignedAgreementUrl`.
- `app/equipment/scanners/[id]/page.tsx` — assign modal toggle + upload; existing-assignment
  print/attach; agreement display.
- `lib/equipmentAgreementPdf.ts` (new) — shared agreement-text + `printAgreementPdf` helper.
- `components/SignaturePad.tsx` — unchanged (still used for the on-screen path).
