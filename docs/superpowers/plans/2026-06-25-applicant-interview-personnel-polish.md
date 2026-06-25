# Applicant / Interview / Personnel Aesthetic Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the applications list, applicant detail (incl. interview sections), and personnel screens visually consistent and polished using a small shared UI vocabulary — no behavior changes.

**Architecture:** Hybrid. (1) Global CSS wins in `app/globals.css` — close the light-mode remap gap on opacity-variant slate classes and add theme-aware utility classes for badges/pills/segments/callouts. (2) A small set of presentational primitives in `components/ui/` (`Card`, `SectionHeader`, `Button`, `StatusBadge`, `ScorePill`, `RatingScale`) that emit those classes and work in light **and** dark. (3) Apply them across the three screen areas, normalizing spacing/badges/buttons inline.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind v4, TypeScript ^5. Theme = CSS variables in `app/globals.css` with `light`/`dark` class on `<html>` (light default). No test runner is configured; verification is `npx tsc --noEmit`, `npm run lint`, and headless-Chrome screenshots in both themes.

**Spec:** `docs/superpowers/specs/2026-06-25-applicant-interview-personnel-polish-design.md`

## Global Constraints

- **No behavior/logic changes.** Only markup + styling. Preserve every existing handler, state value, Convex query/mutation, prop, and route. Primitives are presentational; pass props/handlers straight through.
- **Both themes.** Every change must render correctly in **light** (default) and **dark**. Use `theme-*` classes and CSS-variable-backed `.ui-*` classes only — **no `!important`, no light-only colors** (`bg-amber-50`, `text-gray-800`, etc.).
- **No inline hex.** Use the `#007AFF` primary via token/class, never `style={{backgroundColor:"#007AFF"}}`.
- **Mobile-safe.** No new horizontal overflow; replace fixed widths with fluid/wrapping layouts.
- **Verify before editing line anchors** — line numbers are from the 2026-06-25 audit and drift.
- **Primary accent** `#007AFF`; **radii** `--radius-lg 10px` / `--radius-xl 14px` / `--radius-2xl 20px`; **section gap** 20px / **card gap** 16px / **inner gap** 12px.

---

### Task 1: Global CSS foundation (`app/globals.css`)

Adds the remap-gap fixes + new theme-aware utility classes that every primitive consumes. Must land first.

**Files:**
- Modify: `app/globals.css` (append a new block; do not alter existing rules)

**Interfaces:**
- Produces (CSS classes consumed by later tasks): `.ui-badge` + `.ui-badge-{blue,green,amber,red,purple,gray}`; `.ui-segment` + `.ui-segment-on`; `.ui-callout-amber`; `.ui-section-label`; `.ui-btn-ghost`; `.ui-btn-danger`; plus light-mode remaps for opacity-variant slate.

- [ ] **Step 1: Inspect the existing remap + theme-card rules** so new rules match.

Run: `grep -nE "\.light main \.bg-slate|\.theme-card|\.theme-btn-primary|\.theme-btn-secondary" app/globals.css`
Expected: see the solid-slate remaps (~107–136) and `.theme-card` / `.theme-btn-*` definitions. Note `.theme-card`'s bg/border/radius/shadow so `Card` can rely on it.

- [ ] **Step 2: Append the foundation block** at the end of `app/globals.css`:

```css
/* ===== UI polish foundation (2026-06-25) ===== */

/* Close the light-mode remap gap: opacity-variant slate was not matched by
   the solid-class selectors, so these rendered as faint dark tints. */
.light main .bg-slate-800\/50,
.light main .bg-slate-800\/30 { background-color: #ffffff !important; }
.light main .bg-slate-900\/50,
.light main .bg-slate-900\/30 { background-color: #f2f2f7 !important; }
.light main .bg-slate-700\/50,
.light main .bg-slate-700\/30 { background-color: #e5e5ea !important; }
.light main .border-slate-700\/50,
.light main .border-slate-700\/30 { border-color: #d1d1d6 !important; }
.light main .border-slate-600\/50 { border-color: #d1d1d6 !important; }

/* Uppercase section label */
.ui-section-label {
  font-size: 12px; font-weight: 600; letter-spacing: .06em;
  text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 6px;
}

/* Badges / pills — readable in both themes */
.ui-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 600; line-height: 1.2;
  padding: 3px 9px; border-radius: 999px; white-space: nowrap;
}
.ui-badge-blue   { background: rgba(0,122,255,.12); color: #0062cc; }
.ui-badge-green  { background: rgba(52,199,89,.15); color: #1f8f3d; }
.ui-badge-amber  { background: rgba(255,149,0,.16); color: #b25e00; }
.ui-badge-red    { background: rgba(255,59,48,.13);  color: #c4271d; }
.ui-badge-purple { background: rgba(175,82,222,.14); color: #7e3bb0; }
.ui-badge-gray   { background: rgba(120,120,128,.14); color: #5b5b60; }
.dark .ui-badge-blue   { background: rgba(0,122,255,.20);  color: #6db3ff; }
.dark .ui-badge-green  { background: rgba(52,199,89,.22);  color: #5fe08a; }
.dark .ui-badge-amber  { background: rgba(255,149,0,.22);  color: #ffc266; }
.dark .ui-badge-red    { background: rgba(255,59,48,.22);   color: #ff8a82; }
.dark .ui-badge-purple { background: rgba(175,82,222,.24); color: #d59cf0; }
.dark .ui-badge-gray   { background: rgba(174,174,178,.20); color: #c7c7cc; }

/* Rating-scale segment (1–4) */
.ui-segment {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1px solid var(--border-primary); background: var(--bg-card);
  color: var(--text-tertiary); font-size: 13px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background-color .12s, border-color .12s, color .12s;
}
.ui-segment:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 1px; }
.ui-segment-on { background: var(--accent-primary); border-color: var(--accent-primary); color: #ffffff; }

/* Theme-aware amber callout (replaces light-only bg-amber-50/text-gray-800) */
.ui-callout-amber {
  background: rgba(255,149,0,.08);
  border: 1px solid rgba(255,149,0,.32);
  color: var(--text-primary);
}
.dark .ui-callout-amber { background: rgba(255,149,0,.12); border-color: rgba(255,149,0,.38); }

/* Button variants not already covered by theme-btn-primary/secondary */
.ui-btn-ghost {
  background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border-primary);
}
.ui-btn-ghost:hover { background: var(--bg-hover); }
.ui-btn-danger { background: transparent; color: var(--accent-danger); border: 1px solid transparent; }
.ui-btn-danger:hover { border-color: var(--accent-danger); }
```

- [ ] **Step 3: Typecheck + lint** (CSS won't typecheck, but confirm nothing else broke).

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "style(ui): globals foundation — remap-gap fix + badge/segment/callout utilities"
```

---

### Task 2: Preview harness + `Card` + `SectionHeader`

A throwaway dev page to screenshot primitives in both themes, plus the two layout primitives.

**Files:**
- Create: `components/ui/Card.tsx`
- Create: `components/ui/SectionHeader.tsx`
- Create: `app/ui-preview/page.tsx` (temporary; removed in Task 11)

**Interfaces:**
- Produces: `Card({ children, padding?: "sm"|"md", tone?: "default"|"amber"|"accent", className? })`;
  `SectionHeader({ title: string, label?: string, actions?: ReactNode, className? })`.

- [ ] **Step 1: Create `components/ui/Card.tsx`**

```tsx
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  padding?: "sm" | "md";
  tone?: "default" | "amber" | "accent";
  className?: string;
};

const PAD = { sm: "p-4", md: "p-5" };

/** Standard iOS section card. `theme-card` provides bg/border/radius/shadow. */
export default function Card({ children, padding = "md", tone = "default", className = "" }: Props) {
  const toneClass =
    tone === "amber" ? "ui-callout-amber rounded-2xl"
    : tone === "accent" ? "theme-card" // accent reserved; falls back to default chrome
    : "theme-card";
  return <div className={`${toneClass} ${PAD[padding]} ${className}`}>{children}</div>;
}
```

- [ ] **Step 2: Create `components/ui/SectionHeader.tsx`**

```tsx
import { ReactNode } from "react";

type Props = { title: string; label?: string; actions?: ReactNode; className?: string };

export default function SectionHeader({ title, label, actions, className = "" }: Props) {
  return (
    <div className={`flex items-start justify-between gap-3 mb-4 ${className}`}>
      <div className="min-w-0">
        {label && <div className="ui-section-label">{label}</div>}
        <h2 className="text-[17px] font-semibold theme-text-primary leading-tight truncate">{title}</h2>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Create the preview page `app/ui-preview/page.tsx`** (renders inside `<main>` so theme remaps apply):

```tsx
"use client";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

export default function UiPreview() {
  return (
    <main className="theme-bg-primary min-h-screen p-8">
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        <Card>
          <SectionHeader title="Standard card" label="Section" actions={<span className="ui-badge ui-badge-blue">Badge</span>} />
          <p className="theme-text-secondary text-sm">Body text inside a standard card.</p>
        </Card>
        <Card tone="amber">
          <SectionHeader title="Amber callout" actions={<span className="ui-badge ui-badge-amber">Temp</span>} />
          <p className="theme-text-secondary text-sm">Readable in light and dark.</p>
        </Card>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Visual check in both themes**

Run the dev server in the background and screenshot `/ui-preview` in light and dark:
```bash
npm run dev &  # wait until "Ready"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --screenshot=/tmp/ui-light.png --window-size=900,800 "http://localhost:3000/ui-preview"
"$CHROME" --headless=new --disable-gpu --screenshot=/tmp/ui-dark.png --window-size=900,800 \
  "http://localhost:3000/ui-preview" --user-data-dir=/tmp/cdtheme  # then toggle via devtools, OR add ?theme override (see note)
```
Note: the page defaults to light. To verify dark, temporarily add `document.documentElement.classList.add("dark")` at the top of the preview `useEffect`, screenshot, then revert. Expected: card chrome, badge colors, and amber callout all legible in both themes.

- [ ] **Step 6: Commit**

```bash
git add components/ui/Card.tsx components/ui/SectionHeader.tsx app/ui-preview/page.tsx
git commit -m "feat(ui): Card + SectionHeader primitives + preview harness"
```

---

### Task 3: `Button` + `StatusBadge`

**Files:**
- Create: `components/ui/Button.tsx`
- Create: `components/ui/StatusBadge.tsx`
- Modify: `app/ui-preview/page.tsx` (add a row showing both)

**Interfaces:**
- Produces: `Button({ variant?: "primary"|"secondary"|"ghost"|"danger", size?: "sm"|"md", ...buttonProps })`;
  `StatusBadge({ status: string, kind?: "applicant"|"personnel" })`.

- [ ] **Step 1: Create `components/ui/Button.tsx`**

```tsx
import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: "sm" | "md"; children: ReactNode;
};

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors " +
  "disabled:opacity-50 disabled:cursor-not-allowed";
const SIZE = { sm: "px-3 py-1.5 text-[13px]", md: "px-3.5 py-2 text-[13.5px]" };
const VARIANT: Record<Variant, string> = {
  primary: "theme-btn-primary",
  secondary: "theme-btn-secondary",
  ghost: "ui-btn-ghost",
  danger: "ui-btn-danger",
};

export default function Button({ variant = "secondary", size = "md", className = "", children, ...rest }: Props) {
  return (
    <button className={`${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Create `components/ui/StatusBadge.tsx`**

```tsx
type Kind = "applicant" | "personnel";

const COLOR: Record<string, string> = {
  new: "gray", reviewed: "blue", contacted: "blue", scheduled: "amber",
  interviewed: "purple", hired: "green", rejected: "red", dns: "red", expired: "gray",
  active: "green", on_leave: "amber", terminated: "red",
};

export default function StatusBadge({ status, kind }: { status: string; kind?: Kind }) {
  void kind; // reserved for future kind-specific maps
  const key = (status ?? "").toLowerCase();
  const color = COLOR[key] ?? "gray";
  const label = status ? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
  return <span className={`ui-badge ui-badge-${color}`}>{label}</span>;
}
```

- [ ] **Step 3: Add a preview row** to `app/ui-preview/page.tsx` (inside the column):

```tsx
        <Card>
          <SectionHeader title="Buttons & status" />
          <div className="flex flex-wrap gap-2 items-center">
            <Button variant="primary">Hire</Button>
            <Button variant="secondary">Add note</Button>
            <Button variant="ghost">Schedule</Button>
            <Button variant="danger">Delete</Button>
            <StatusBadge status="interviewed" />
            <StatusBadge status="hired" />
            <StatusBadge status="rejected" />
          </div>
        </Card>
```
(Add `import Button from "@/components/ui/Button";` and `import StatusBadge from "@/components/ui/StatusBadge";`.)

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Visual check** `/ui-preview` in light + dark (per Task 2 Step 5). Expected: 4 visually-distinct button variants; status badges colored per map; all legible in both themes.

- [ ] **Step 6: Commit**

```bash
git add components/ui/Button.tsx components/ui/StatusBadge.tsx app/ui-preview/page.tsx
git commit -m "feat(ui): Button variants + StatusBadge primitives"
```

---

### Task 4: `ScorePill` (verify thresholds against code)

**Files:**
- Create: `components/ui/ScorePill.tsx`
- Modify: `app/ui-preview/page.tsx`

**Interfaces:**
- Produces: `ScorePill({ score: number|null|undefined, size?: "sm"|"md", showOutOf?: boolean })`.

- [ ] **Step 1: Find the existing score-color thresholds** so the pill matches current behavior.

Run: `grep -nE "score >=|score >|>= 75|>= 70|text-green|text-amber|text-red" app/applications/page.tsx app/applications/\[id\]/page.tsx | head -20`
Expected: identify the green/amber/red cutoffs actually used (commonly 75/50). Use those exact cutoffs in Step 2 — adjust the constants if they differ.

- [ ] **Step 2: Create `components/ui/ScorePill.tsx`** (using the verified cutoffs; defaults 75/50):

```tsx
const GREEN_MIN = 75; // adjust to match Step 1 findings
const AMBER_MIN = 50;

export default function ScorePill({
  score, size = "md", showOutOf = false,
}: { score: number | null | undefined; size?: "sm" | "md"; showOutOf?: boolean }) {
  if (score == null || Number.isNaN(score)) return <span className="ui-badge ui-badge-gray">—</span>;
  const color = score >= GREEN_MIN ? "green" : score >= AMBER_MIN ? "amber" : "red";
  const sz = size === "sm" ? "text-sm" : "text-base";
  return (
    <span className={`ui-badge ui-badge-${color} ${sz} font-bold`}>
      {Math.round(score)}{showOutOf ? "/100" : ""}
    </span>
  );
}
```

- [ ] **Step 3: Add a preview row** to `app/ui-preview/page.tsx`:

```tsx
        <Card>
          <SectionHeader title="Score pills" />
          <div className="flex flex-wrap gap-2 items-center">
            <ScorePill score={88} /> <ScorePill score={64} /> <ScorePill score={32} />
            <ScorePill score={88} size="sm" showOutOf /> <ScorePill score={null} />
          </div>
        </Card>
```
(Add `import ScorePill from "@/components/ui/ScorePill";`.)

- [ ] **Step 4: Typecheck + lint** — `npx tsc --noEmit && npm run lint` → no errors.

- [ ] **Step 5: Visual check** `/ui-preview` light + dark. Expected: 88 green, 64 amber, 32 red, null = gray dash.

- [ ] **Step 6: Commit**

```bash
git add components/ui/ScorePill.tsx app/ui-preview/page.tsx
git commit -m "feat(ui): ScorePill primitive"
```

---

### Task 5: `RatingScale` (the interview prelim-eval fix)

**Files:**
- Create: `components/ui/RatingScale.tsx`
- Modify: `app/ui-preview/page.tsx`

**Interfaces:**
- Produces: `RatingScale({ value: number|null, onChange?: (v:number)=>void, readOnly?: boolean, name: string })`.

- [ ] **Step 1: Create `components/ui/RatingScale.tsx`** (accessible 1–4 segmented control with keyboard support):

```tsx
"use client";
import { KeyboardEvent } from "react";

type Props = {
  value: number | null;
  onChange?: (v: number) => void;
  readOnly?: boolean;
  name: string;
};

const OPTS = [1, 2, 3, 4];

export default function RatingScale({ value, onChange, readOnly = false, name }: Props) {
  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (readOnly || !onChange) return;
    const cur = value ?? 0;
    if (e.key >= "1" && e.key <= "4") { onChange(Number(e.key)); e.preventDefault(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") { onChange(Math.min(4, cur + 1) || 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { onChange(Math.max(1, cur - 1) || 1); e.preventDefault(); }
  }
  return (
    <div role="radiogroup" aria-label={name} onKeyDown={handleKey} className="flex gap-1.5">
      {OPTS.map((n) => {
        const selected = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${name}: ${n} of 4`}
            tabIndex={selected || (!value && n === 1) ? 0 : -1}
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(n)}
            className={`ui-segment ${selected ? "ui-segment-on" : ""} ${readOnly ? "cursor-default" : "cursor-pointer"}`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add a preview row** to `app/ui-preview/page.tsx` with a stateful example:

```tsx
        <Card>
          <SectionHeader title="Rating scale" label="Preliminary evaluation" />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between"><span className="theme-text-secondary text-sm">Communication</span><RatingScale name="Communication" value={ratingDemo} onChange={setRatingDemo} /></div>
            <div className="flex items-center justify-between"><span className="theme-text-secondary text-sm">Reliability (read-only =3)</span><RatingScale name="Reliability" value={3} readOnly /></div>
          </div>
        </Card>
```
Add at the top of the component: `import { useState } from "react";` and `const [ratingDemo, setRatingDemo] = useState<number | null>(2);` and `import RatingScale from "@/components/ui/RatingScale";`.

- [ ] **Step 3: Typecheck + lint** — `npx tsc --noEmit && npm run lint` → no errors.

- [ ] **Step 4: Visual + interaction check** `/ui-preview` light + dark: clicking a square selects it (blue fill); arrow/number keys move selection on the focused group; read-only row shows 3 highlighted and is not clickable.

- [ ] **Step 5: Commit**

```bash
git add components/ui/RatingScale.tsx app/ui-preview/page.tsx
git commit -m "feat(ui): RatingScale primitive (1-4 segmented control)"
```

---

### Task 6: Applicant detail — header + non-interview panels

**Files:**
- Modify: `app/applications/[id]/page.tsx` (header ~521–631; contact/scores ~666–740; flags ~750–812; employment ~814–852; AI job match ~1355–1419; notes ~1422–1428, ~2163–2227; timeline ~1430–1545)

**Interfaces:**
- Consumes: `Card`, `SectionHeader`, `Button`, `StatusBadge`, `ScorePill` from `components/ui/`.

- [ ] **Step 1: Add imports** at the top of the file:

```tsx
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";
import ScorePill from "@/components/ui/ScorePill";
```

- [ ] **Step 2: Consolidate the header action buttons** (~541–629). Replace the ad-hoc colored buttons with the hierarchy. **Pattern** (keep each button's existing `onClick`/conditions verbatim — only the className/wrapper changes):

```tsx
// BEFORE: <button onClick={openHire} className="px-4 py-2 bg-green-600 ...">Hire Applicant</button>
// AFTER:
<Button variant="primary" onClick={openHire}>Hire Applicant</Button>
// Schedule / Send Offer / View Personnel Record -> variant="ghost"
// Status -> render current status via <StatusBadge status={application.status} /> (keep the existing
//   status-change control if interactive, but restyle its trigger to ghost)
// Delete (admin) -> <Button variant="danger" onClick={confirmDelete}>Delete</Button>
```
Result: exactly one filled primary (Hire); the rest ghost/secondary; status as a badge; delete as ghost-danger.

- [ ] **Step 3: Wrap each content panel** (contact, scores, cover message, flags, employment, AI job match, hiring-team notes, internal notes) in `Card` + `SectionHeader`. **Pattern:**

```tsx
// BEFORE: <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6"> <h2 ...>Contact Information</h2> ... </div>
// AFTER:
<Card>
  <SectionHeader title="Contact Information" />
  {/* ...existing inner content unchanged... */}
</Card>
```
For the scores boxes, render each numeric score with `<ScorePill score={...} />` (use `size="md"`). For flags, give the *type* badge `ui-badge ui-badge-gray` (outline-ish) and the *severity* badge a semantic color (`ui-badge-red`/`amber`) so they're visually distinct. Standardize all inner grids to `gap-4`.

- [ ] **Step 4: Fix the activity timeline** (~1430–1545). Replace the absolute-positioned vertical line with a left-border/padding structure so it can't overlap on mobile. **Pattern:**

```tsx
// Container: <ol className="relative flex flex-col gap-4 border-l border-slate-700 pl-6">
//   each item: <li className="relative">  <span className="absolute -left-[31px] top-1 w-3 h-3 rounded-full ..."/>  <Card padding="sm">...</Card> </li>
```
Keep the existing per-activity icon/color logic; only the layout wrapper changes.

- [ ] **Step 5: Typecheck + lint** — `npx tsc --noEmit && npm run lint` → no errors.

- [ ] **Step 6: Visual + behavior check.** Start `npm run dev`, log in, open a real applicant detail page. Verify in **light and dark** at desktop (≥1280) and phone (390) widths: header has one primary action, panels are uniform cards, scores are pills, timeline doesn't overlap. Confirm Hire/Schedule/Offer/Delete/status-change still work (behavior unchanged).

- [ ] **Step 7: Commit**

```bash
git add "app/applications/[id]/page.tsx"
git commit -m "style(applicant): unify header buttons + panels with ui primitives"
```

---

### Task 7: Applicant detail — interview area (all four pain points)

**Files:**
- Modify: `app/applications/[id]/page.tsx` (interview rounds ~854–1276; scheduling banner + attendees ~1547–1694; interview modals ~1278–1353, ~1696–1789)

**Interfaces:**
- Consumes: `Card`, `SectionHeader`, `Button`, `RatingScale`, `ScorePill`, `StatusBadge`.

- [ ] **Step 1: Round cards** (~889–931) — one consistent card per round via `Card` + `SectionHeader`. **Pattern:**

```tsx
<Card>
  <SectionHeader
    title={`Round ${round.number} · ${round.title ?? "Interview"}`}
    label={round.interviewer ? `${round.interviewer} · ${formatDate(round.date)}` : undefined}
    actions={round.aiScore != null ? <span className="ui-badge ui-badge-blue">AI {round.aiScore} / 4</span> : undefined}
  />
  {/* keep existing expand/collapse + inner content */}
</Card>
```
Keep the round-number badge (use `ui-badge`/`roundnum` style) and the collapse toggle behavior.

- [ ] **Step 2: Preliminary evaluation** (~936–1079) — replace the toggle-button score inputs with `RatingScale` rows. **Pattern** (preserve the existing state + save handler):

```tsx
// BEFORE: a flex row of 4 <button> per metric toggling prelimScores[metric]
// AFTER, per metric:
<div className="flex items-center justify-between py-2.5 border-b border-slate-700/50 last:border-b-0">
  <span className="theme-text-secondary text-sm">{metricLabel}</span>
  <RatingScale
    name={metricLabel}
    value={prelimScores[metricKey] ?? null}
    onChange={(v) => setPrelimScores((s) => ({ ...s, [metricKey]: v }))}
    readOnly={savedPrelim /* or whatever read flag exists */}
  />
</div>
```
Keep the notes textarea (`theme-input`) and the Save button (`<Button variant="primary">`).

- [ ] **Step 3: AI evaluation** (~1157–1248) — two-column Strengths/Concerns + recommendation card. **Pattern:**

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
  <Card padding="sm"><SectionHeader title="" actions={<span className="ui-badge ui-badge-green">Strengths</span>} />
    <ul className="list-disc pl-4 text-sm theme-text-secondary space-y-1">{strengths.map(...)}</ul></Card>
  <Card padding="sm"><SectionHeader title="" actions={<span className="ui-badge ui-badge-amber">Concerns</span>} />
    <ul className="list-disc pl-4 text-sm theme-text-secondary space-y-1">{concerns.map(...)}</ul></Card>
</div>
{/* recommendation: color by verdict */}
<Card tone={verdictTone /* derive: yes->default/green wrapper */} padding="sm" className="mt-3">
  <span className="font-semibold theme-text-primary">Recommendation: </span>
  <span className="theme-text-secondary">{recommendation}</span>
</Card>
```
Keep the existing AI-generate button/loading state (`<Button variant="primary" disabled={loading}>`). Keep the detailed-feedback block, wrapped in a `Card padding="sm"`.

- [ ] **Step 4: Q & A blocks** (~1081–1135) — uniform question containers (`Card padding="sm"` or a consistent inner box), number badge + AI badge (`ui-badge ui-badge-purple`), answer text / textarea (`theme-input`), Save via `<Button>`. Keep handlers.

- [ ] **Step 5: Scheduling banner + attendees** (~1547–1694) — wrap the banner in `Card tone="amber"` (or default Card). Replace the manually-positioned attendee dropdown (`absolute right-0 mt-2 w-64 ... z-10`) with a click-outside-dismiss popover. **Pattern:**

```tsx
// Use a relative wrapper + a state-driven panel that closes on outside click:
const ref = useRef<HTMLDivElement>(null);
useEffect(() => {
  if (!attendeeOpen) return;
  const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAttendeeOpen(false); };
  document.addEventListener("mousedown", onDoc);
  return () => document.removeEventListener("mousedown", onDoc);
}, [attendeeOpen]);
// <div ref={ref} className="relative"> <Button variant="ghost" onClick={()=>setAttendeeOpen(o=>!o)}>Add attendee</Button>
//   {attendeeOpen && <div className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] theme-card p-2 z-20 shadow-lg">...</div>} </div>
```
Keep the add/remove attendee handlers verbatim. Render attendee chips with `ui-badge ui-badge-gray` + a remove button.

- [ ] **Step 6: Interview modals** (~1278–1353, ~1696–1789) — wrap modal bodies in `Card`, inputs as `theme-input`, footer buttons as `Button` (`ghost` cancel + `primary` confirm). Keep all form state/handlers.

- [ ] **Step 7: Typecheck + lint** — `npx tsc --noEmit && npm run lint` → no errors.

- [ ] **Step 8: Visual + behavior check.** Logged-in, on an applicant with ≥1 interview round, in **light and dark** at desktop + phone: round cards uniform; prelim eval is a clear 1–4 scale that saves; AI eval is two-column + recommendation; attendee popover opens/closes on outside click and doesn't run off-screen on mobile. Confirm saving a prelim score, an answer, and adding/removing an attendee all still work.

- [ ] **Step 9: Commit**

```bash
git add "app/applications/[id]/page.tsx"
git commit -m "style(interview): rating scale, AI-eval layout, round cards, attendee popover"
```

---

### Task 8: Applications list

**Files:**
- Modify: `app/applications/page.tsx` (stats ~349–368; top candidates ~370–502; recent interviews ~504–615; kanban ~668–856; table ~858–1112; modals ~1116–1261)

**Interfaces:**
- Consumes: `Card`, `SectionHeader`, `Button`, `StatusBadge`, `ScorePill`.

- [ ] **Step 1: Add imports** (same five as Task 6 Step 1).

- [ ] **Step 2: Stat grid** (~349–368) — normalize each stat to the inner-box padding and fix the responsive grid. **Pattern:**

```tsx
// container: className="mt-4 grid grid-cols-4 lg:grid-cols-8 gap-3"   (was sm:grid-cols-8 -> tablet overflow)
// each stat card: theme-card p-4 text-center (consistent), number + ui-section-label
```

- [ ] **Step 3: Top Candidates + Recent Interviews** (~370–615) — wrap each block in `Card` + `SectionHeader`; inner candidate cards uniform (`theme-card`/inner box, `gap-4`); replace status with `<StatusBadge status={...} />` and scores with `<ScorePill score={...} size="sm" />`.

- [ ] **Step 4: Kanban** (~668–856) — unify column-card padding (`p-3`→consistent) and borders (drop `/50` faintness by using the now-remapped classes or `theme-card`); scores via `ScorePill`; keep all dnd-kit drag/drop behavior and handlers unchanged.

- [ ] **Step 5: Table** (~858–1112) — score column via `ScorePill`; make the status control consistent (badge-styled trigger via `StatusBadge` for display; keep the existing change mechanism); consistent action button styling (`Button variant="ghost" size="sm"` or links restyled). Keep sort handlers.

- [ ] **Step 6: Modals** (~1116–1261) — `Card`/`Button` chrome; keep handlers.

- [ ] **Step 7: Typecheck + lint** — `npx tsc --noEmit && npm run lint` → no errors.

- [ ] **Step 8: Visual + behavior check.** Logged-in on `/applications`, **light and dark**, desktop + tablet (768) + phone: stats don't overflow on tablet; table/kanban/top-candidates share one score + badge treatment. Confirm view toggle, sorting, status change, archive, and kanban drag still work.

- [ ] **Step 9: Commit**

```bash
git add app/applications/page.tsx
git commit -m "style(applications): unify stats, kanban, table, candidate cards"
```

---

### Task 9: Personnel list

**Files:**
- Modify: `app/personnel/page.tsx` (~151–512)

**Interfaces:**
- Consumes: `Card`, `SectionHeader`, `Button`, `StatusBadge`.

- [ ] **Step 1: Add imports** (`Card`, `SectionHeader`, `Button`, `StatusBadge`).

- [ ] **Step 2: Header + stats + filters** — header buttons via `Button` (Add Employee = `primary`, Reviews/Import = `secondary`/`ghost`); stat cards consistent padding (`theme-card p-4`); align with the applications-list treatment.

- [ ] **Step 3: Table** (~264–406) — status column via `<StatusBadge status={p.status} kind="personnel" />`; keep the editable Location `<select>` but visually mark it as interactive (e.g., a subtle chevron / `theme-input` styling) to distinguish from the read-only status badge; keep clock indicator + handlers.

- [ ] **Step 4: Terminated section** (~409–512) — use a lighter background/border rather than opacity to keep text readable; consistent badges.

- [ ] **Step 5: Typecheck + lint** — `npx tsc --noEmit && npm run lint` → no errors.

- [ ] **Step 6: Visual + behavior check.** `/personnel`, light + dark, desktop + phone: status badges consistent; location select still changes location; terminated section readable. Behavior unchanged.

- [ ] **Step 7: Commit**

```bash
git add app/personnel/page.tsx
git commit -m "style(personnel): unify list stats, status badges, terminated section"
```

---

### Task 10: Personnel detail

**Files:**
- Modify: `app/personnel/[id]/page.tsx` (temp banner ~1096–1110; hex buttons ~1057,1107; summary bar ~991–1068; tabs ~1070–1089; stat grid ~1112–1128; profile panels)

**Interfaces:**
- Consumes: `Card`, `SectionHeader`, `Button`, `StatusBadge`.

- [ ] **Step 1: Add imports.**

- [ ] **Step 2: Temp banner** (~1096–1110) — replace the light-only `bg-amber-50/text-gray-800` block with `<Card tone="amber">` (legible in both themes). Keep the eligibility text + "Convert to hire" action.

- [ ] **Step 3: Replace inline hex** (~1057, 1107) — swap `style={{ backgroundColor: "#007AFF" }}` buttons for `<Button variant="primary">`. Grep to be sure none remain: `grep -n "#007AFF" "app/personnel/[id]/page.tsx"` → expected: none after.

- [ ] **Step 4: Summary bar** (~991–1068) — fix mobile wrap: stack to two rows on small screens (`flex-col sm:flex-row` with sensible gaps); contact buttons via `Button size="sm" variant="ghost"`; Edit Personnel via `Button variant="primary"`.

- [ ] **Step 5: Tabs + stat grid + profile panels** — consistent tab active/hover styling using theme classes; stat grid `theme-card p-4`; wrap profile-tab panels in `Card`/`SectionHeader`. Do not change tab switching behavior.

- [ ] **Step 6: Typecheck + lint** — `npx tsc --noEmit && npm run lint` → no errors.

- [ ] **Step 7: Visual + behavior check.** A personnel record (ideally a temp employee to see the banner), light + dark, desktop + phone: temp banner legible; no inline hex; summary bar wraps cleanly on mobile; tabs switch correctly. Behavior unchanged.

- [ ] **Step 8: Commit**

```bash
git add "app/personnel/[id]/page.tsx"
git commit -m "style(personnel-detail): theme-aware temp banner, token buttons, mobile summary bar"
```

---

### Task 11: Remove preview harness + final pass

**Files:**
- Delete: `app/ui-preview/page.tsx`

- [ ] **Step 1: Delete the temporary preview page.**

```bash
git rm app/ui-preview/page.tsx
```

- [ ] **Step 2: Full typecheck + lint + build.**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass (build confirms no SSR/type breakage across the edited routes).

- [ ] **Step 3: Final both-theme spot check** of all five screens (applications list, applicant detail, interview area, personnel list, personnel detail) at desktop + phone widths. Confirm no leftover faint slate tints, no light-on-light text, consistent cards/badges/buttons.

- [ ] **Step 4: Commit + push.**

```bash
git add -A
git commit -m "chore(ui): remove preview harness; final polish pass"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- Global CSS wins (remap gap + amber callout) → Task 1. ✓
- Shared primitives (Card, SectionHeader, StatusBadge, ScorePill, RatingScale, Button) → Tasks 2–5. ✓
- Conventions (card/spacing/border/badge/score/button hierarchy) → encoded in Task 1 CSS + primitives, applied Tasks 6–10. ✓
- Applicant detail (header consolidation, panels, flags, timeline, attendee popover, temp-section) → Tasks 6–7. ✓
- Interview (rating scale, AI eval, round cards, Q&A, scheduling/attendees) → Task 7. ✓
- Applications list (stats, top candidates, kanban, table, modals) → Task 8. ✓
- Personnel list + detail (temp banner, hex, summary bar, tabs) → Tasks 9–10. ✓
- Constraints (no behavior change, both themes, mobile, no inline hex) → Global Constraints + each task's check step. ✓
- Verification model (typecheck/lint + both-theme screenshots; no invented test runner) → every task. ✓

**Placeholder scan:** No "TBD/TODO". ScorePill thresholds are explicitly "verify in Step 1 and adjust" (a real instruction, not a placeholder). Screen tasks show concrete before/after transformation patterns rather than full file rewrites — appropriate for 1–4K-line existing files; each names exact locations, imports, and patterns.

**Type consistency:** Primitive prop names/signatures defined in Tasks 2–5 are used consistently in Tasks 6–10 (`Card` `tone`/`padding`; `Button` `variant`; `StatusBadge` `status`/`kind`; `ScorePill` `score`/`size`/`showOutOf`; `RatingScale` `value`/`onChange`/`readOnly`/`name`).

## Notes for the implementer

- These screens require login; for visual checks, run `npm run dev`, sign in once, and navigate to a real record. Use existing data (an applicant with an interview round; a temp personnel record).
- To screenshot dark mode, toggle `document.documentElement.classList.add("dark")` in the console (or via the app's theme switcher) before capturing.
- **Behavior is sacred:** if a transformation would change what a control does, stop and keep the original behavior — only the styling/markup changes.
