# Structured Job Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-form job-description textarea in IECentral with fixed, named sections (About / What You'll Do / What We're Looking For), so postings render as clean headed sections on the public site instead of a wall of text.

**Architecture:** The `jobs` table (Convex deployment `outstanding-dalmatian-787`) gains three optional structured fields; `description` stays and is auto-composed from them on save (for AI keyword matching, list previews, and legacy readers). IECentral owns the deployed Convex backend and the admin form. The public site (ietireWebsite) reads the same table and renders structured sections when present, falling back to the old `description` for un-migrated posts. Legacy posts are pre-filled into the structured fields by a pure parser when a staffer opens them for edit ("parse then confirm").

**Tech Stack:** Next.js 15 / React 19, Convex, TypeScript. New: `vitest` (dev-only) for the pure format module.

## Global Constraints

- **Deploy source of truth:** all schema + Convex mutation changes go in `IECentral/convex/` ONLY. The `ietireWebsite/convex/` copy is stale/independent and must NOT be changed or deployed.
- **Verification gate:** `npx tsc --noEmit` must pass in each repo touched (there is no eslint gate). The format module additionally has vitest unit tests.
- **`viewingJob` in the website is typed `any`** — no TS type changes needed there; access new fields directly.
- **Back-compat:** never drop or rename `description`; it is always written on save.
- **Fixed section set only** — no custom/arbitrary sections, no rich-text, no markdown.
- **Do not push / deploy** until the user explicitly approves; implementation happens on a feature branch off `main`.
- Match existing file style: local `Job`/`JobFormData` interfaces in `app/jobs/page.tsx`, `setFormData({ ...formData, ... })` object-spread pattern, `.ui-*`/`theme-*` classes.

---

### Task 1: Pure format module (compose + parse) — TDD with vitest

The one piece with real branching logic. Pure functions, unit-tested first.

**Files:**
- Create: `IECentral/app/jobs/jobListingFormat.ts`
- Create: `IECentral/app/jobs/jobListingFormat.test.ts`
- Create: `IECentral/vitest.config.ts`
- Modify: `IECentral/package.json` (add `vitest` devDependency + `test` script)

**Interfaces:**
- Produces:
  - `interface StructuredListing { summary: string; responsibilities: string[]; requirements: string[] }`
  - `composeDescription(listing: StructuredListing): string`
  - `parseLegacyDescription(description: string): StructuredListing`

- [ ] **Step 1: Add vitest tooling**

Run:
```bash
cd /Users/andybarrows/IECentral && npm install -D vitest
```
Expected: `vitest` added to devDependencies, exit 0.

Add a `test` script to `package.json` `scripts` (alongside the existing `dev`/`build`/`start`/`lint`):
```json
    "test": "vitest run"
```

Create `IECentral/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write the failing tests**

Create `IECentral/app/jobs/jobListingFormat.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { composeDescription, parseLegacyDescription } from "./jobListingFormat";

describe("composeDescription", () => {
  it("joins summary, responsibilities, and requirements under headings", () => {
    const result = composeDescription({
      summary: "We are hiring.",
      responsibilities: ["Greet visitors", "Answer phones"],
      requirements: ["HS diploma"],
    });
    expect(result).toBe(
      "We are hiring.\n\nWhat You'll Do\n- Greet visitors\n- Answer phones\n\nWhat We're Looking For\n- HS diploma"
    );
  });

  it("omits empty sections and trims", () => {
    expect(
      composeDescription({ summary: "  Hi  ", responsibilities: [], requirements: ["", "  "] })
    ).toBe("Hi");
  });
});

describe("parseLegacyDescription", () => {
  it("splits a run-on description on known headings", () => {
    const legacy =
      "Import Export Tire Company has been trusted since 1972. We'd love to hear from you. " +
      "What You'll Do Greet customers and vendors. " +
      "What We're Looking For High school diploma or equivalent. " +
      "What We Offer Full benefits package.";
    const r = parseLegacyDescription(legacy);
    expect(r.summary.startsWith("Import Export Tire Company")).toBe(true);
    expect(r.summary.includes("What You'll Do")).toBe(false);
    expect(r.responsibilities).toEqual(["Greet customers and vendors."]);
    expect(r.requirements).toEqual(["High school diploma or equivalent."]);
  });

  it("splits multi-line blocks into separate bullets and strips markers", () => {
    const legacy =
      "Intro paragraph.\nWhat You'll Do\n- Greet\n- Answer\nWhat We're Looking For\n- Diploma";
    const r = parseLegacyDescription(legacy);
    expect(r.summary).toBe("Intro paragraph.");
    expect(r.responsibilities).toEqual(["Greet", "Answer"]);
    expect(r.requirements).toEqual(["Diploma"]);
  });

  it("normalizes curly apostrophes in headings", () => {
    const legacy = "Intro. What You’ll Do Do stuff. What We’re Looking For A degree.";
    const r = parseLegacyDescription(legacy);
    expect(r.summary).toBe("Intro.");
    expect(r.responsibilities).toEqual(["Do stuff."]);
    expect(r.requirements).toEqual(["A degree."]);
  });

  it("returns everything as summary when no headings are present", () => {
    const r = parseLegacyDescription("Just a short blurb.");
    expect(r.summary).toBe("Just a short blurb.");
    expect(r.responsibilities).toEqual([]);
    expect(r.requirements).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
cd /Users/andybarrows/IECentral && npm test
```
Expected: FAIL — cannot resolve `./jobListingFormat` (module does not exist yet).

- [ ] **Step 4: Implement the module**

Create `IECentral/app/jobs/jobListingFormat.ts`:
```ts
export interface StructuredListing {
  summary: string;
  responsibilities: string[];
  requirements: string[];
}

const RESP_HEADING = "What You'll Do";
const REQ_HEADING = "What We're Looking For";
const OFFER_HEADINGS = ["What We Offer", "Benefits"];

// Normalize curly apostrophes to straight and lowercase. This is a 1:1
// character replacement, so indices in the normalized string map exactly
// onto the original string.
const norm = (s: string) => s.replace(/[‘’]/g, "'").toLowerCase();

export function composeDescription(listing: StructuredListing): string {
  const parts: string[] = [];
  const summary = listing.summary.trim();
  if (summary) parts.push(summary);

  const resp = listing.responsibilities.map((r) => r.trim()).filter(Boolean);
  if (resp.length) {
    parts.push([RESP_HEADING, ...resp.map((r) => `- ${r}`)].join("\n"));
  }

  const req = listing.requirements.map((r) => r.trim()).filter(Boolean);
  if (req.length) {
    parts.push([REQ_HEADING, ...req.map((r) => `- ${r}`)].join("\n"));
  }

  return parts.join("\n\n");
}

export function parseLegacyDescription(description: string): StructuredListing {
  const text = description ?? "";
  const hay = norm(text);
  const findIdx = (heading: string) => hay.indexOf(norm(heading));

  const respIdx = findIdx(RESP_HEADING);
  const reqIdx = findIdx(REQ_HEADING);
  const offerIdx =
    OFFER_HEADINGS.map(findIdx)
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0] ?? -1;

  const allHeadings = [respIdx, reqIdx, offerIdx].filter((i) => i >= 0).sort((a, b) => a - b);
  const firstHeading = allHeadings.length ? allHeadings[0] : text.length;
  const summary = text.slice(0, firstHeading).trim();

  const sliceBlock = (start: number, headingLen: number): string => {
    if (start < 0) return "";
    const after = start + headingLen;
    const nextEnds = [respIdx, reqIdx, offerIdx].filter((i) => i > start).sort((a, b) => a - b);
    const end = nextEnds.length ? nextEnds[0] : text.length;
    return text.slice(after, end).trim();
  };

  // Newline-delimited blocks split into one bullet per line; a run-on block
  // (no newlines) becomes a single bullet the staffer breaks up by hand.
  const toBullets = (block: string): string[] => {
    if (!block) return [];
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^[-•]\s*/, ""))
      .filter(Boolean);
    return lines.length ? lines : [block];
  };

  return {
    summary,
    responsibilities: toBullets(sliceBlock(respIdx, RESP_HEADING.length)),
    requirements: toBullets(sliceBlock(reqIdx, REQ_HEADING.length)),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd /Users/andybarrows/IECentral && npm test
```
Expected: PASS — all 7 tests green.

- [ ] **Step 6: Commit**

```bash
cd /Users/andybarrows/IECentral
git add app/jobs/jobListingFormat.ts app/jobs/jobListingFormat.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat(jobs): add structured listing compose/parse module with tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Convex schema + mutation fields (IECentral only)

**Files:**
- Modify: `IECentral/convex/schema.ts:137` (jobs table)
- Modify: `IECentral/convex/jobs.ts:46-60` (`create` args), `IECentral/convex/jobs.ts:76-92` (`update` args)

**Interfaces:**
- Consumes: nothing.
- Produces: `jobs` docs may carry `summary?: string`, `responsibilities?: string[]`, `requirements?: string[]`; `create`/`update` accept them. Handlers already spread args (`create`) and filter-undefined-then-patch (`update`), so no handler-body change is needed.

- [ ] **Step 1: Add the schema fields**

In `IECentral/convex/schema.ts`, in the `jobs` table, immediately after the `description: v.string(),` line (line 137), add:
```ts
    summary: v.optional(v.string()), // "About This Position" intro
    responsibilities: v.optional(v.array(v.string())), // "What You'll Do"
    requirements: v.optional(v.array(v.string())), // "What We're Looking For"
```

- [ ] **Step 2: Add the `create` mutation args**

In `IECentral/convex/jobs.ts`, in `create`'s `args` object, after `description: v.string(),` (line 54), add:
```ts
    summary: v.optional(v.string()),
    responsibilities: v.optional(v.array(v.string())),
    requirements: v.optional(v.array(v.string())),
```
(No handler change — the handler does `ctx.db.insert("jobs", { ...args, ... })`.)

- [ ] **Step 3: Add the `update` mutation args**

In `IECentral/convex/jobs.ts`, in `update`'s `args` object, after `description: v.optional(v.string()),` (line 84), add:
```ts
    summary: v.optional(v.string()),
    responsibilities: v.optional(v.array(v.string())),
    requirements: v.optional(v.array(v.string())),
```
(No handler change — the handler filters undefined then `ctx.db.patch`.)

- [ ] **Step 4: Regenerate Convex types and typecheck**

Run:
```bash
cd /Users/andybarrows/IECentral && npx convex codegen && npx tsc --noEmit
```
Expected: codegen succeeds; `tsc` exits 0 (the new fields now exist on the generated `api` types).

> If `npx convex codegen` requires auth/network and is unavailable in this environment, skip it — the generated types update on the next `convex dev`/deploy. `npx tsc --noEmit` against existing generated types must still pass because the added mutation args are backward-compatible.

- [ ] **Step 5: Commit**

```bash
cd /Users/andybarrows/IECentral
git add convex/schema.ts convex/jobs.ts convex/_generated
git commit -m "feat(jobs): add structured fields to schema and create/update mutations

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Admin form — structured inputs + add/remove-row bullet editors (IECentral)

**Files:**
- Modify: `IECentral/app/jobs/page.tsx` — `Job` interface (33-51), `JobFormData` interface (53-66), `useState` default (119-132), `resetForm` (135-152), `openEditModal` (171-189), `openCopyModal` (191-209), `handleSubmit` (228-294), and the description `<textarea>` block (793-804). Add an import at the top.

**Interfaces:**
- Consumes: `composeDescription`, `parseLegacyDescription`, `StructuredListing` from `./jobListingFormat` (Task 1); the new mutation args from Task 2.
- Produces: an admin form that writes `summary`, `responsibilities[]`, `requirements[]`, and a composed `description`.

- [ ] **Step 1: Import the format module**

At the top of `IECentral/app/jobs/page.tsx`, with the other imports, add:
```ts
import { composeDescription, parseLegacyDescription } from "./jobListingFormat";
```

- [ ] **Step 2: Extend the `Job` interface**

In the `Job` interface, after `description: string;` (line 42), add:
```ts
  summary?: string;
  responsibilities?: string[];
  requirements?: string[];
```

- [ ] **Step 3: Rework the `JobFormData` interface**

Replace `description: string;` (line 60) in `JobFormData` with:
```ts
  summary: string;
  responsibilities: string[];
  requirements: string[];
```

- [ ] **Step 4: Update the `useState` default and `resetForm`**

In BOTH the `useState<JobFormData>({ ... })` initializer (line 119) and `resetForm` (line 135), replace the `description: "",` line with:
```ts
      summary: "",
      responsibilities: [],
      requirements: [],
```

- [ ] **Step 5: Parse legacy data in `openEditModal` and `openCopyModal`**

At the top of `openEditModal` (line 171), before `setFormData(...)`, insert:
```ts
    const hasStructured =
      !!job.summary || !!job.responsibilities?.length || !!job.requirements?.length;
    const structured = hasStructured
      ? {
          summary: job.summary ?? "",
          responsibilities: job.responsibilities ?? [],
          requirements: job.requirements ?? [],
        }
      : parseLegacyDescription(job.description);
```
Then in that `setFormData({ ... })` call, replace `description: job.description,` with:
```ts
      summary: structured.summary,
      responsibilities: structured.responsibilities,
      requirements: structured.requirements,
```
Do the exact same two edits in `openCopyModal` (line 191): add the identical `hasStructured`/`structured` block at the top, and replace `description: job.description,` with the same three lines.

- [ ] **Step 6: Add row-editor helpers**

Immediately after `removeLocation` (ends line 164), add:
```ts
  const addResponsibility = () =>
    setFormData({ ...formData, responsibilities: [...formData.responsibilities, ""] });
  const updateResponsibility = (index: number, value: string) =>
    setFormData({
      ...formData,
      responsibilities: formData.responsibilities.map((r, i) => (i === index ? value : r)),
    });
  const removeResponsibility = (index: number) =>
    setFormData({
      ...formData,
      responsibilities: formData.responsibilities.filter((_, i) => i !== index),
    });

  const addRequirement = () =>
    setFormData({ ...formData, requirements: [...formData.requirements, ""] });
  const updateRequirement = (index: number, value: string) =>
    setFormData({
      ...formData,
      requirements: formData.requirements.map((r, i) => (i === index ? value : r)),
    });
  const removeRequirement = (index: number) =>
    setFormData({
      ...formData,
      requirements: formData.requirements.filter((_, i) => i !== index),
    });
```

- [ ] **Step 7: Update `handleSubmit` to compose the description**

In `handleSubmit`, after the `keywordsArray` block (ends line 244) and before `try {`, add:
```ts
    const summary = formData.summary.trim();
    const responsibilities = formData.responsibilities.map((r) => r.trim()).filter(Boolean);
    const requirements = formData.requirements.map((r) => r.trim()).filter(Boolean);

    if (!summary) {
      alert('Please fill in the "About This Position" summary.');
      return;
    }

    const description = composeDescription({ summary, responsibilities, requirements });
```
Then in BOTH the `updateJob({ ... })` call (line 252) and the `createJob({ ... })` call (line 272), the existing `description: formData.description,` line must become `description,` and gain the three structured fields. Replace `description: formData.description,` in each call with:
```ts
          description,
          summary,
          responsibilities,
          requirements,
```

- [ ] **Step 8: Replace the description textarea with structured inputs**

Replace the entire description `<div>` block (lines 793-804) with:
```tsx
                  <div>
                    <label className="block ui-section-label mb-1">
                      About This Position *
                    </label>
                    <textarea
                      value={formData.summary}
                      onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                      rows={4}
                      className="theme-input w-full px-4 py-2 resize-none"
                      placeholder="Short intro paragraph about the role and company."
                      required
                    />
                  </div>

                  <div>
                    <label className="block ui-section-label mb-1">
                      What You&apos;ll Do
                    </label>
                    <div className="space-y-2">
                      {formData.responsibilities.map((item, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item}
                            onChange={(e) => updateResponsibility(i, e.target.value)}
                            placeholder="e.g. Greet customers, vendors, and visitors"
                            className="theme-input flex-1 px-4 py-2"
                          />
                          <button
                            type="button"
                            onClick={() => removeResponsibility(i)}
                            className="px-3 py-2 text-sm rounded-lg text-red-500 hover:bg-red-500/10"
                            aria-label="Remove responsibility"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addResponsibility}
                        className="text-sm text-[#007AFF] hover:underline"
                      >
                        + Add responsibility
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block ui-section-label mb-1">
                      What We&apos;re Looking For
                    </label>
                    <div className="space-y-2">
                      {formData.requirements.map((item, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item}
                            onChange={(e) => updateRequirement(i, e.target.value)}
                            placeholder="e.g. High school diploma or equivalent"
                            className="theme-input flex-1 px-4 py-2"
                          />
                          <button
                            type="button"
                            onClick={() => removeRequirement(i)}
                            className="px-3 py-2 text-sm rounded-lg text-red-500 hover:bg-red-500/10"
                            aria-label="Remove requirement"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addRequirement}
                        className="text-sm text-[#007AFF] hover:underline"
                      >
                        + Add requirement
                      </button>
                    </div>
                  </div>
```

- [ ] **Step 9: Typecheck**

Run:
```bash
cd /Users/andybarrows/IECentral && npx tsc --noEmit
```
Expected: exit 0, no errors. (If `create`/`update` generated types are stale from Task 2, run `npx convex codegen` first.)

- [ ] **Step 10: Commit**

```bash
cd /Users/andybarrows/IECentral
git add app/jobs/page.tsx
git commit -m "feat(jobs): structured admin form with add-row bullet editors + legacy parse-on-edit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Public renderer — structured sections with legacy fallback (ietireWebsite)

**Files:**
- Modify: `ietireWebsite/src/app/page.tsx:1486-1490` (the "About This Position" description block)

**Interfaces:**
- Consumes: `viewingJob` (typed `any`) with optional `summary`, `responsibilities`, `requirements`, plus existing `description`. No type change needed.
- Produces: rendered structured sections, or a whitespace-preserving fallback for legacy posts.

- [ ] **Step 1: Replace the description block**

Replace the block at lines 1486-1490:
```tsx
                {/* Job Description */}
                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-white mb-3">About This Position</h4>
                  <p className="text-slate-300 leading-relaxed">{viewingJob.description}</p>
                </div>
```
with:
```tsx
                {/* Job Description */}
                {(viewingJob.summary ||
                  viewingJob.responsibilities?.length ||
                  viewingJob.requirements?.length) ? (
                  <>
                    {viewingJob.summary && (
                      <div className="mb-6">
                        <h4 className="text-lg font-semibold text-white mb-3">About This Position</h4>
                        <p className="text-slate-300 leading-relaxed whitespace-pre-line">
                          {viewingJob.summary}
                        </p>
                      </div>
                    )}
                    {viewingJob.responsibilities?.length > 0 && (
                      <div className="mb-6">
                        <h4 className="text-lg font-semibold text-white mb-3">What You&apos;ll Do</h4>
                        <ul className="list-disc pl-5 space-y-1 text-slate-300 leading-relaxed">
                          {viewingJob.responsibilities.map((item: string, i: number) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {viewingJob.requirements?.length > 0 && (
                      <div className="mb-6">
                        <h4 className="text-lg font-semibold text-white mb-3">What We&apos;re Looking For</h4>
                        <ul className="list-disc pl-5 space-y-1 text-slate-300 leading-relaxed">
                          {viewingJob.requirements.map((item: string, i: number) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mb-6">
                    <h4 className="text-lg font-semibold text-white mb-3">About This Position</h4>
                    <p className="text-slate-300 leading-relaxed whitespace-pre-line">
                      {viewingJob.description}
                    </p>
                  </div>
                )}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd /Users/andybarrows/ietireWebsite && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/andybarrows/ietireWebsite
git commit -am "feat(careers): render structured job sections with legacy fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: End-to-end smoke test

**Files:** none (verification only).

- [ ] **Step 1: Run the format unit tests + typecheck both repos**

```bash
cd /Users/andybarrows/IECentral && npm test && npx tsc --noEmit
cd /Users/andybarrows/ietireWebsite && npx tsc --noEmit
```
Expected: tests green, both `tsc` exit 0.

- [ ] **Step 2: Manual browser smoke (dev servers)**

Start IECentral (`npm run dev`) and, in the `/jobs` admin page:
- Create a new posting: fill About, add 2–3 responsibilities, add 2 requirements, add benefits, save. Confirm no error.
- Open an existing legacy posting (e.g. Receptionist) for edit: confirm About/responsibilities/requirements are pre-filled from the old text (a run-on legacy body appears as one bullet per section — expected; break it into rows and save).

Start ietireWebsite (`npm run dev`) and open the careers section:
- Confirm the new/edited posting shows "About This Position", "What You'll Do" (bulleted), "What We're Looking For" (bulleted), and "Benefits" — no wall of text.
- Confirm an un-migrated legacy posting still renders (fallback), now with line breaks preserved.

- [ ] **Step 3: Report results**

Report tsc/test output and the browser observations. Do NOT push or deploy — leave that for the user to approve (pushing IECentral to origin triggers a live Vercel + Convex deploy).
