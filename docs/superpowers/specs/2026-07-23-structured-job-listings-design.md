# Structured Job Listings — Design

**Date:** 2026-07-23
**Repos:** `IECentral` (admin, listings created here) + `ietireWebsite` (public site, listings displayed here)
**Shared backend:** both point at Convex deployment `outstanding-dalmatian-787`, `jobs` table.

## Problem

A job posting's body is stored in a single free-form field, `jobs.description` (`v.string()`),
filled by a plain 4-row `<textarea>` in IECentral (`app/jobs/page.tsx:793`) and rendered as one
flat `<p>` on the public site (`ietireWebsite/src/app/page.tsx:1489`). Line breaks collapse in
HTML and no section headings exist, so distinct sections ("What You'll Do", "What We're Looking
For", "What We Offer") mash into one unreadable wall of text (see the Receptionist posting).

## Goal

Replace copy-paste body entry with **fixed, named sections** so formatting is guaranteed and
consistent across every posting, with no extra formatting discipline required from staff.

## Data model

Add three optional fields to the `jobs` table; keep `description` for backward compatibility and
the existing AI resume/keyword matching.

```ts
// jobs table — new fields
summary:          v.optional(v.string()),          // "About This Position" intro paragraph
responsibilities: v.optional(v.array(v.string())), // "What You'll Do" bullets
requirements:     v.optional(v.array(v.string())), // "What We're Looking For" bullets
// benefits: v.array(v.string())  — ALREADY EXISTS → renders as "What We Offer"
// description: v.string()         — STAYS; auto-composed on save from structured fields
```

**Definition of "structured":** a posting is structured if any of `summary`,
`responsibilities`, or `requirements` is non-empty.

**`description` auto-composition:** on every save from the new form, `description` is rebuilt from
the structured fields (summary + responsibilities + requirements, joined with headings/newlines).
This keeps anything that still reads `description` working — AI keyword matching, the list-view
preview, and any external/legacy reader — without a separate migration.

**Mirroring:** the schema change and the `create`/`update` mutation arg additions must land in
**both** repos' Convex copies, since both deploy against the same `jobs` table:
- `IECentral/convex/schema.ts` (~line 137) and `IECentral/convex/jobs.ts` (`create` ~46, `update` ~75)
- `ietireWebsite/convex/schema.ts` and `ietireWebsite/convex/jobs.ts`

## Admin form (`IECentral/app/jobs/page.tsx`)

Replace the single Description textarea (lines 793–804) with three grouped inputs:

| Section label | Input | Stored as |
|---|---|---|
| About This Position | textarea | `summary` (string) |
| What You'll Do | **repeatable rows** — one input per bullet, each with a remove (✕) button, plus a "+ Add responsibility" button | `responsibilities` (string[]) |
| What We're Looking For | **repeatable rows** — one input per bullet, each with a remove (✕) button, plus a "+ Add requirement" button | `requirements` (string[]) |
| Benefits | existing comma-separated input (unchanged) | `benefits` (string[]) |

- `JobFormData` gains `summary: string`, `responsibilities: string[]`, `requirements: string[]`.
  Update the `useState` default (line 119), `resetForm` (135), `openEditModal` (171), and
  `openCopyModal` (191).
- Row editing follows the existing `locations` array pattern already in this file (`addLocation`
  / `removeLocation`, ~154–164): add helpers `addResponsibility`/`removeResponsibility(i)` and
  `addRequirement`/`removeRequirement(i)`, editing rows immutably in `formData`.
  Adding a row appends an empty string; the ✕ removes by index.
- `handleSubmit` (228): trim each row and drop empties before saving; compose `description`;
  pass all new fields to `createJob`/`updateJob`.
- Validation: require a non-empty `summary` (replaces the old `required` on the description
  textarea). Responsibilities/requirements may be empty.

## Auto-parse on edit ("then confirm")

When `openEditModal` opens a posting that is **not** structured but has a non-empty `description`,
run a parser to pre-fill the structured fields so staff can verify and save.

Parser (`app/jobs/parseLegacyDescription.ts`, pure function, unit-tested):
- Split `description` on the known section headings (case-insensitive, tolerant of surrounding
  whitespace): `What You'll Do`, `What We're Looking For`, `What We Offer` / `Benefits`.
  - Text before the first heading → `summary`.
  - Block after "What You'll Do" → responsibilities.
  - Block after "What We're Looking For" → requirements.
  - Block after "What We Offer"/"Benefits" → ignored here (benefits already live in their own field).
- Within a bullet block, best-effort split into individual bullets (on newlines if present,
  otherwise on sentence boundaries). **This is explicitly best-effort** — the reason the flow is
  "parse **then confirm**": staff review and fix the pre-filled bullets before saving.

No batch migration. Legacy postings keep working via the renderer fallback until someone edits
them, at which point they become structured on save.

## Public renderer (`ietireWebsite/src/app/page.tsx`, ~1487–1505)

- **Structured posting:** render
  - "About This Position" heading + `summary`
  - "What You'll Do" heading + `responsibilities` as a bulleted list
  - "What We're Looking For" heading + `requirements` as a bulleted list
  - existing "Benefits" section (`benefits[]`, unchanged)
- **Legacy posting** (no structured fields): render `description` as today, but add
  `whitespace-pre-line` to the `<p>` so any newlines are preserved instead of collapsed.

Match existing styling (`text-slate-300 leading-relaxed`, existing heading classes, the benefits
check-icon list pattern already at 1492–1505).

## Testing

- **Convex mutations:** structured `create` persists all fields; `description` is auto-composed;
  `update` patches only provided fields.
- **Parser unit tests:** feed the real Receptionist wall-of-text (from the screenshot) → assert
  summary + section splits are correct; assert a description with no known headings falls back to
  summary-only (no data loss).
- **Renderer:** a structured posting shows headed sections; a legacy posting shows preserved
  line breaks.

## Out of scope (YAGNI)

- Rich-text/markdown editing.
- Arbitrary custom sections (fixed set only).
- Reordering bullets via drag-and-drop (row order is the order they're added).
