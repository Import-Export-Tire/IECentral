# Aesthetic Polish — Applicant, Interview & Personnel Screens

> Design spec. Created 2026-06-25 (branch `main`). Point-in-time — verify `file:line`
> references against current code before editing; they drift.

## Goal

Tighten up the visual consistency and polish of the applicant screens, the interview
sections, and the personnel screens, while keeping the existing iOS-style admin aesthetic.
This is a **consistency-polish + targeted-cleanup** pass — not a redesign and not a
behavior change.

### Success criteria

- One coherent card / spacing / border / badge / button vocabulary across all three areas.
- The interview area (the messiest section) reads cleanly: a real rating scale, a scannable
  AI-evaluation layout, one round-card style, and a non-fragile scheduling/attendee UI.
- The known readability bugs (light-on-light temp-employee callouts) are fixed and legible
  in **both** light and dark themes.
- No logic, data, or routing changes. No regressions in either theme or on mobile.

### Non-goals

- No restructuring of page information architecture beyond regrouping noted below.
- No new features, no backend/Convex changes.
- Not a full migration of every legacy `slate-*` class to `theme-*` (see Approach).

---

## Background: the real root cause

These screens mix **three styling vocabularies**, which is the source of most of the
"inconsistent borders / spacing / faint tints / unreadable callouts" problems:

1. **`theme-*` classes** (`theme-card`, `theme-text-primary`, `theme-border-primary`,
   `theme-btn-primary`, `theme-input`, …) backed by CSS variables in `app/globals.css`
   (`:root` light defaults + `.dark` overrides). The "blessed" iOS system; used by newer
   code (e.g. `app/personnel/[id]/page.tsx`).
2. **Solid `slate-*` / `text-white` classes** that are **remapped to light** by
   `.light main .bg-slate-800 { … !important }` style rules in `globals.css`
   (≈ lines 107–136). These render acceptably in light mode.
3. **Opacity-variant slate** (`bg-slate-800/50`, `bg-slate-900/50`, `border-slate-700/50`)
   — Tailwind emits these as *different* class names (`bg-slate-800\/50`), which the
   remap selectors in (2) **do not match**. So they render as genuine semi-transparent
   dark over the light background → faint, slightly-off tints and borders.

Plus a handful of **hardcoded light-only colors** (`bg-amber-50 text-gray-800`,
inline `style={{backgroundColor:"#007AFF"}}`) that are the unreadable temp-employee
callouts and a maintenance smell.

Cohesion therefore means **converging on one vocabulary** where we touch code, and
**closing the opacity-variant remap gap** globally for code we don't touch.

### Theme tokens already available (`app/globals.css`)

- iOS palette: `--color-ios-blue #007AFF`, `green #34C759`, `red #FF3B30`,
  `orange #FF9500`, `purple #AF52DE`, grays `--color-ios-gray1..6`.
- Semantic: `--bg-primary/secondary/tertiary/card/hover`, `--text-primary/secondary/tertiary/muted`,
  `--border-primary/secondary`, `--accent-primary/secondary/danger/warning`.
- Radii: `--radius-lg 10px`, `--radius-xl 14px`, `--radius-2xl 20px`.
- Shadows: `--shadow-ios`, `--shadow-ios-lg`.
- Utility classes: `theme-bg-*`, `theme-text-*`, `theme-border-*`, `theme-card`,
  `theme-input`, `theme-btn-primary`, `theme-btn-secondary`, `theme-table-*`.

---

## Approach: hybrid (chosen)

1. **Global CSS wins** (`app/globals.css`) — highest leverage, lowest risk, fixes many
   components at once without per-file edits:
   - Extend the `.light main …` remap to the common opacity variants:
     `bg-slate-800/50`, `bg-slate-900/50`, `bg-slate-800/30`, `border-slate-700/50`,
     `border-slate-700/30`, `border-slate-600/50` (escape the `/` in the selector,
     e.g. `.light main .bg-slate-800\/50`). Match the solid-variant target colors.
   - Make the temp-employee callout pattern theme-aware (see Personnel / Applicant detail).
2. **Shared primitives** (`components/ui/`) — small, focused, theme-correct in both modes:
   `Card`, `SectionHeader`, `StatusBadge`, `ScorePill`, `RatingScale`, `Button`. Applied to
   the worst offenders and the interview area.
3. **Targeted inline normalization** — per screen, normalize spacing/badges/buttons to the
   conventions below and replace ad-hoc markup with the primitives where it pays off.

Rejected: (A) full `theme-*` migration of the two ~2K–4K-line detail pages — too large/risky
for a polish pass; (B) pure inline tweaking — repetitive and drifts back, leaves the remap
gap.

---

## Conventions (the standard vocabulary)

| Token | Value |
|---|---|
| Section card | `theme-card` → white bg, 1px `--border-secondary`, `--radius-xl` (14px), `--shadow-ios`, **20px** padding |
| Nested/inner box | 1px `--border-secondary`, `--radius-lg` (10px), **12–14px** padding |
| Section gap (between cards) | **20px** (`gap-5`) |
| Card content gap | **16px** (`gap-4`) |
| Inner element gap | **12px** (`gap-3`) |
| Primary accent | `#007AFF` (via token, never inline hex) |
| Body text / heading / muted | `--text-primary` / `--text-primary` 650 wt / `--text-tertiary` |
| Border (default) | `--border-secondary`; emphasis `--border-primary` |
| Section header title | 17px, weight 650 |
| Uppercase label | 12px, letter-spacing .06em, `--text-tertiary`, weight 600 |

**Button hierarchy** (resolves the 5-color header overload):
- `primary` — filled `#007AFF`, white text. **One per context** (e.g. Hire).
- `secondary` — `--bg-tertiary` fill, primary text.
- `ghost` — transparent, 1px border, secondary text (Schedule, Send Offer, etc.).
- `danger` — red text, transparent; outline only on hover (Delete).

**Status color map** (`StatusBadge`): new=gray, reviewed=blue, contacted=blue,
scheduled=orange, interviewed=purple, hired=green, rejected=red, dns=red, expired=gray;
personnel: active=green, on_leave=amber, terminated=red. Pill: `px-2.5 py-0.5 rounded-full
text-xs font-semibold`, color at ~12–15% bg + readable text.

**Score color map** (`ScorePill`): ≥75 green, 50–74 amber, <50 red (match existing
thresholds in code — verify). Sizes `sm` (text-sm) / `md` (text-base). Used everywhere a
score appears (list table, kanban, top candidates, detail) for one consistent treatment.

---

## Shared primitives (`components/ui/`)

Each is a thin client component emitting theme-correct classes (work in light + dark; no
`!important`). All purely presentational.

- **`Card`** — `props: { padding?: 'sm'|'md'; tone?: 'default'|'amber'|'accent'; className?; children }`.
  `theme-card` base; `tone='amber'` = theme-aware warning callout (amber border + ~8% amber
  bg + readable text in both themes) — replaces the broken `bg-amber-50` pattern.
- **`SectionHeader`** — `props: { title; label?; actions?: ReactNode }`. Title left, optional
  uppercase `label`, optional `actions` (buttons/badges) right. Consistent bottom margin.
- **`StatusBadge`** — `props: { status; kind?: 'applicant'|'personnel' }`. Pill per status map.
- **`ScorePill`** — `props: { score; size?: 'sm'|'md'; showOutOf?: boolean }`. Color per map.
- **`RatingScale`** — `props: { value: 1|2|3|4|null; onChange?(v); readOnly?; name }`. Segmented
  1–4 control (squares, selected = `#007AFF` fill, per mockup). `role="radiogroup"`,
  arrow-key + number-key support, `aria-label` from `name`. Read-only renders the chosen value
  highlighted. **This replaces the ambiguous toggle-button prelim-eval inputs.**
- **`Button`** — `props: { variant: 'primary'|'secondary'|'ghost'|'danger'; size?; …native }`.
  Maps to the hierarchy above; consistent radius/padding/disabled/hover states.

These are presentational only; existing handlers/state pass straight through.

---

## Area-by-area changes

> Line numbers below are from the 2026-06-25 audit and are approximate — re-locate before editing.

### A. `app/globals.css` (global wins)
- Add `.light main` remaps for the opacity-variant slate classes listed in Approach §1.
- Add (or rely on `Card tone='amber'` for) a theme-aware amber-callout treatment so temp
  callouts are legible in both themes.
- No changes to the existing variable definitions or solid-slate remaps.

### B. Applications list — `app/applications/page.tsx` (~1273 lines)
- **Stat grid** (~349–368): normalize card padding to the inner-box standard; responsive
  `grid-cols-4 lg:grid-cols-8` (avoid tablet overflow). Use `ScorePill` where scores appear.
- **Top Candidates / Recent Interviews** (~370–615): wrap in `Card`; standardize the inner
  candidate cards (consistent padding/border), `StatusBadge`, `ScorePill`.
- **Kanban** (~668–856): unify column-card padding and borders (drop `/50` faintness);
  `ScorePill` for scores; `StatusBadge`/badges consistent. Keep existing dnd behavior.
- **Table** (~858–1112): make the status control consistent with the rest (badge-styled
  control), `ScorePill` for the score column, consistent row/action styling.
- **Modals / Help** (~1116–1261): `Card`/`Button` for consistent chrome.

### C. Applicant detail — `app/applications/[id]/page.tsx` (~2250 lines)
- **Header** (~521–631): consolidate to the button hierarchy — **Hire** = single filled
  primary; Schedule / Send Offer / View Personnel = `ghost`/`secondary`; status as
  `StatusBadge`; **Delete** = `danger` (ghost). Removes the 5-competing-colors problem.
- **Contact + Scores** (~666–740): `Card` + `SectionHeader`; unify the score boxes via
  `ScorePill`; consistent gap primitive (pick `gap-4`, not mixed `space-y`/`gap`).
- **Flags** (~750–812): visually distinguish *type* vs *severity* badges (e.g. type = subtle
  outline pill, severity = filled color); consistent item boxes.
- **Employment history** (~814–852): consistent item card + summary boxes.
- **AI Job Match** (~1355–1419), **Hiring Team Notes** (~1422–1428), **Internal Notes**
  (~2163–2227): wrap in `Card`/`SectionHeader`; keyword/skill pills consistent.
- **Activity timeline** (~1430–1545): replace the absolute-positioned line with a
  flex/grid + left-padding structure so it's mobile-safe; consistent dot/card styling.
- **Modals** (New Interview / Schedule / Hire / Send Offer, ~1278–2161): `Card`/`Button`
  chrome; fix the **temp-employee section** (~1838–1883) to `Card tone='amber'`.

### D. Interview area (within applicant detail, ~854–1276) — all four pain points
- **Round cards** (~889–931): one consistent card style via `Card`/`SectionHeader`; round
  number badge + title + meta + `ScorePill`/AI-score badge in the header; consistent expand/
  collapse affordance.
- **Preliminary evaluation** (~936–1079): replace the toggle-button score inputs with
  `RatingScale` rows (label left, 1–4 scale right), per mockup. Keep the same underlying
  values/save handler.
- **Q & A** (~1081–1135): consistent question blocks (number badge, AI badge, answer/textarea)
  with uniform padding.
- **AI evaluation** (~1157–1248): two-column **Strengths / Concerns** boxes + a
  **Recommendation** card colored by verdict (green/amber/red), then detailed feedback —
  scannable and consistent.
- **Scheduling banner + attendees** (~1547–1694): tidy the banner into the `Card`/`tone`
  system; replace the fragile `absolute … z-10` attendee dropdown with an anchored,
  click-outside-dismiss popover (or inline add/remove list) that is mobile-safe.

### E. Personnel list — `app/personnel/page.tsx` (~527 lines)
- Stat grid, filters, table: align padding/badges/score treatment with the applications list;
  `StatusBadge` for status; consistent action styling. Make the editable Location vs
  read-only Status distinction visually clear.

### F. Personnel detail — `app/personnel/[id]/page.tsx` (~4390 lines)
- **Temp banner** (~1096–1110): `Card tone='amber'` — fixes the light-on-light contrast.
- **Hardcoded `#007AFF`** inline styles (~1057, 1107): replace with `Button variant='primary'`
  / token.
- **Summary bar** (~991–1068): fix awkward mobile wrap (2-row on small screens).
- **Tabs** (~1070–1089) and stat grid (~1112–1128): consistent with the shared vocabulary.
- Apply `Card`/`SectionHeader` to the profile-tab panels; do not rework tab behavior.

---

## Constraints & verification

- **No behavior changes** — only markup/styling. Existing state, handlers, queries, and
  routes are untouched; primitives are presentational and pass props/handlers through.
- **Both themes** — every change must look correct in **light** (default) and **dark**.
  Primitives use `theme-*`/variable-backed styles (no `!important`, no light-only colors).
- **Mobile-safe** — no new horizontal overflow; fixed widths replaced with fluid/wrapping
  layouts; the attendee popover and timeline must behave on phone widths.
- **Verification plan:**
  1. Build the shared primitives first and render them in an isolated harness; screenshot in
     **light and dark** to confirm parity with the mockup.
  2. After each screen, verify in the running app in both themes at desktop + phone widths
     (login required — use a dev session). Where a full app render isn't practical, verify the
     changed components in the harness and review the diff for behavior preservation.
  3. Confirm no `console` CSP/errors and no layout overflow.

---

## Rollout / sequencing

Build order (verify after each, commit per step):
1. Shared primitives (`components/ui/`) + `globals.css` global wins.
2. Applicant detail + interview area (highest impact).
3. Applications list.
4. Personnel list + detail.

Each step is independent at the file level (different files), so screens can be parallelized
during implementation, with the primitives + CSS landing first as the shared foundation.

## Out of scope

- Backend/Convex, data model, routing, feature behavior.
- Special themes beyond verifying we don't break them (pipboy/amber/dracula are excluded from
  the slate remap by selector and should be spot-checked, not redesigned).
- Wholesale migration of untouched legacy slate markup to `theme-*`.
