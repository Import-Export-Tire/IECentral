# Doc Hub Persisted Thumbnails — Design

**Date:** 2026-06-17
**Status:** Approved (design)

## Goal

Every Doc Hub card shows a real preview image — page 1 for PDF/Word/Excel/PowerPoint, the
image itself for images — generated **server-side at upload**, stored once in Convex storage,
and served instantly on every subsequent load. If generation ever fails, the card falls back
to today's file-type icon (no regression).

Side benefit: because Office docs get their `previewPdfFileId` populated at upload time, the
preview modal opens them **instantly from cache** instead of converting on open — fixing the
"Word previews are unreliable" complaint.

## Architecture

Mirrors the existing Office→PDF cache pattern (`generatePreviewUploadUrl` / `setPreviewPdf` /
`previewPdfFileId`) one-for-one.

### 1. Schema (`convex/schema.ts`)
Add to the `documents` table:
```ts
thumbnailFileId: v.optional(v.id("_storage")), // Cached page-1 PNG preview for cards
```
Expose `thumbnailFileId` on the documents returned by `getAll` / `getById` (they already
return the full row, so no change beyond the schema field).

### 2. Convex mutations (`convex/documents.ts`)
Two new functions, copied from the preview-PDF pair and secret-guarded:
- `generateThumbnailUploadUrl({ secret })` → returns a storage upload URL.
- `setThumbnail({ documentId, fileId, secret })` → deletes any prior thumbnail, patches
  `thumbnailFileId`.

### 3. Generator route — `POST /api/documents/thumbnail` (`maxDuration = 300`)
Body: `{ id: documentId }`. Secret required via header `x-preview-secret` (same `PREVIEW_PDF_SECRET`).
Steps:
1. Load doc + file bytes via existing Convex queries/actions.
2. Resolve type with `resolveFileType(doc.fileType, doc.fileName)`:
   - **Image** → `sharp(bytes).resize({ width: 480, withoutEnlargement: true }).png()`.
   - **PDF** → render page 1 to PNG via `pdf-to-img` (wraps the bundled `pdfjs` + `@napi-rs/canvas`).
   - **Word/Excel/PPT** → invoke the existing Office→PDF Lambda (reuse the exact logic from
     `office-pdf/route.ts`), store the PDF in `previewPdfFileId` via `setPreviewPdf`, then render
     page 1 of that PDF the same way as the PDF case.
   - **Anything else** → no thumbnail (return 204); card keeps its icon.
3. Upload the PNG (`generateThumbnailUploadUrl` → POST bytes) and save (`setThumbnail`).
4. All failures are swallowed and logged; route returns a non-2xx but never throws to the user.

### 4. Thumbnail proxy — `GET /api/documents/thumb?id=` (`maxDuration = 60`)
Streams the stored PNG with `Cache-Control: private, max-age=86400`. Returns `404` if the doc
has no `thumbnailFileId` yet (the card's `onError` then shows the icon).

### 5. Upload trigger (server-side generation, client-initiated)
A DRY helper `requestThumbnail(docId)` (fire-and-forget `fetch` to the generator route) is called
right after `createDocument(...)` in every upload path:
- `components/dochub/DocHubContext.tsx` → `handleUpload`
- `components/dochub/DocHubContext.tsx` → `handleUploadNewVersion`
- `components/dochub/FolderUploadModal.tsx`

The upload itself does not block on generation. The route does all heavy work server-side.

### 6. Card rendering (`components/dochub/FileCard.tsx` → `FileThumb`)
Replace the current image/pdf.js logic with: render `<img src="/api/documents/thumb?id=…">`
lazily (keep the IntersectionObserver gate). `onError` → fall back to the existing file-type
icon. This removes the client-side pdf.js rendering entirely (server owns it now) and extends
coverage to Word/Excel/PPT, not just PDF.

### 7. Backfill
One-time Node script (`scripts/backfill-thumbnails.mjs`) that lists all active docs via
`documents:getAll` and POSTs each id to the generator route (small concurrency), warming
thumbnails and Office PDF renditions for the existing ~119 docs.

## Dependencies (new)
- `sharp` — image resize (first-class on Vercel).
- `pdf-to-img` — page-1 PDF → PNG (pulls `@napi-rs/canvas`, the Vercel-supported native canvas).

## Error handling
Generation is best-effort. Any failure (corrupt PDF — e.g. the known bad separation form,
Lambda timeout, unsupported type) leaves `thumbnailFileId` unset; the card shows the icon.
No user-facing errors. Server logs the failure reason.

## Testing
- Pure type-dispatch helper (`fileType` → strategy) — unit testable.
- `setThumbnail` guard rejects a bad secret.
- `thumb` proxy returns 404 when `thumbnailFileId` is unset.
- Manual: upload one image, one PDF, one .docx → all three cards show real previews; the .docx
  opens instantly in the modal.

## Out of scope
- Re-rendering thumbnails when a doc is replaced is handled (new version triggers regeneration
  via `handleUploadNewVersion`).
- Multi-page thumbnails / hover-to-flip. Page 1 only.
