# Exit Interview Executive Report — Design

**Date:** 2026-07-08
**Status:** Approved, ready for implementation plan

## Problem

`/reports/exit-interviews` is an analyst's view: a filter bar, a stat grid, a
category tally, a per-location table, and a row-by-row table of every
interview. Its PDF export mirrors that density. It is accurate and it is not
something a CEO reads.

Two data gaps compound this:

1. `responses.primaryReason` — the 16-option survey answer that actually says
   *why* someone left — is rendered per-row and never aggregated. Only the
   coarse `leavingCategory` is rolled up.
2. Nothing anywhere computes a trend. There is no "is this getting worse."

## Deliverable

A second export button, **"Executive PDF"**, on the existing report page. Two
pages: numbers, then words.

The existing page, its stat grid, its `handlePeriodPdf` export, and the
per-interview PDF are **unchanged**. That page remains the working surface;
this is the artifact handed to leadership.

### Page 1 — the numbers

- Header: title, date range, location scope.
- Three large stat tiles: total departures, early-exit rate (<90 days),
  average satisfaction.
- **Departures by month** — a bar chart drawn with jsPDF rectangles. No chart
  library; nothing new imported.
- **Why people leave** — horizontal bars, top 6 reasons.
- **Where** — top 5 locations, count and share of departures.

### Page 2 — what they said

- AI-written narrative, 2–3 short paragraphs.
- Key themes, as bullets.
- Recommended actions, numbered.
- Footer: `Based on N completed of M departures · Generated <timestamp>`.

## Explicit non-goals

- **No headcount normalization.** A line like "W08 is 2.1× its share of
  headcount" needs an active-headcount-per-location denominator the report does
  not currently load. A wrong denominator on a CEO's page is worse than no
  denominator. The report says `W08 · 16 · 34% of departures`. Adding the ratio
  later is easy once the denominator's source is agreed.
- **No SDK bump.** See "Anthropic call" below.
- **`generateAISummary` is not touched.** It stays as-is for `/engagement`,
  keeping its regex parsing and its missing auth guard. Both are worth fixing;
  both are separate work.

## Frontend changes

### New file: `app/reports/exit-interviews/executivePdf.ts`

The PDF builder moves out of the page. `page.tsx` is 515 lines and
`handlePeriodPdf` is ~90 of them; a second, richer document inline would push
the file past the size where edits stay reliable.

Exports one function that takes the already-computed aggregates plus the brief
result, and returns a jsPDF document. It performs no data fetching and no
network calls — it is a pure function of its inputs, so it can be reasoned
about and tested independently of Convex.

### New memos in `page.tsx`

| Memo | Derivation |
|---|---|
| `byReason` | Bucket `rows` by `responses.primaryReason`, **falling back to `leavingCategory`** when the survey was never filled out. Without the fallback the chart silently under-counts exactly the people who did not respond. |
| `byMonth` | Bucket `rows` by `YYYY-MM` of `terminationDate`. |
| `priorPeriodCount` | Count from `interviewsRaw` over the equal-length window immediately preceding `startDate`. Drives the trend direction. Must read `interviewsRaw`, not `rows` — `rows` is already filtered to the selected range. |

`byLocation` and `stats` are reused unchanged.

### New button

Sits beside the existing "Period summary PDF". Shares the existing `generating`
state. Its label reflects the wait, because the Anthropic call takes seconds:
`Writing summary…`.

## Backend changes — `convex/exitInterviews.ts`

### New action: `generateExecutiveBrief`

```
args: { requestingUserId: Id<"users">, startDate: string, endDate: string }
returns: { ok: true, narrative, themes[], actions[], sentiment }
       | { ok: false, reason: string }
```

**Auth.** Exit-interview responses are among the most confidential data in this
app. `docs/iecentral/SECURITY-FINDINGS.md:86` flags the existing
`generateAISummary` as unguarded. The new action does not repeat that.

Guarding an *action* requires an indirection that the existing call sites do
not: `requireRole` (`convex/authGuards.ts:132`) takes an `AnyCtx` and calls
`ctx.db.get`. **Actions have no `ctx.db`.** Every current `requireRole` caller
(`exitInterviews.ts:291,329,355`, `personnel.ts:1511`, `safetyReports.ts`) is a
query or mutation. So this action gets a companion:

```
internalQuery assertSuperAdmin({ requestingUserId })
  → await requireRole(ctx, requestingUserId, ["super_admin"])
```

called via `ctx.runQuery(internal.exitInterviews.assertSuperAdmin, ...)` as the
action's first statement, before any data is read or any token is spent.

`requestingUserId` comes from `useAuth()`'s `user._id` on the client, matching
the app-wide pattern (`app/announcements/page.tsx:140`). This is the existing
spoofable-argument auth model; see `project_iecentral_auth_architecture`. This
change does not fix that and does not make it worse.

**Anthropic call.** Model `claude-opus-4-8`.

The installed `@anthropic-ai/sdk` is `0.71.2`. In that version `output_config`
is typed **only on the beta namespace** (`client.beta.messages.create`), and
adaptive thinking is not typed at all. Therefore:

- Call `client.beta.messages.create`.
- Pass `output_config: { format: { type: "json_schema", schema } }` so the
  response is validated against the schema at the tool-call layer and the model
  retries on mismatch.
- Omit `thinking`. On Opus 4.8, omitting it means the model runs without
  thinking — correct and cheaper for a summarization/extraction task.

This **replaces the regex scraping** at `exitInterviews.ts:747`, which pulls
themes and actions out of prose with
`fullText.match(/Key Themes[:\s]*\n([\s\S]*?)/i)`. That returns `[]` the moment
the model renames a heading, producing a silently empty bullet list.

Bumping the SDK to get `output_config` on the stable namespace is the
alternative. It would touch four other AI call sites — `aiMatching`,
`aiInterview`, `meetingNoteActions`, `emails` — and is not being done as a side
effect of a reporting change.

### Failure behavior

`{ ok: false, reason }` is returned — never thrown — for: no
`ANTHROPIC_API_KEY`, API error or timeout, and zero completed interviews in
range.

**On `ok: false`, page 2 still prints.** It becomes verbatim excerpts: up to 8
real `whatCouldImprove` quotes with department and tenure, under the plain line
*"AI summary unavailable; showing raw comments."* Page 1 never depended on the
call and is unaffected.

**The PDF always renders.** A CEO report that raises a toast and produces
nothing is worse than one that quotes departing employees directly.

### Unverified precondition

Whether `ANTHROPIC_API_KEY` is set on the production Convex deployment was
**not verified** — reading production environment variables was outside the
scope of this request and was not worked around. `/engagement` already calls
`generateAISummary`, so if the AI summary works there, the key is set. The
design degrades gracefully either way; if page 2 comes out as raw quotes on the
first run, check the key before debugging anything else.

## Files touched

| File | Change |
|---|---|
| `app/reports/exit-interviews/page.tsx` | 3 new memos, 1 new button, call the action |
| `app/reports/exit-interviews/executivePdf.ts` | **New.** Pure PDF builder |
| `convex/exitInterviews.ts` | New `generateExecutiveBrief` action + `assertSuperAdmin` internalQuery |

`tsc` is the gate; there is no eslint (`reference_iecentral_ui_primitives`).
