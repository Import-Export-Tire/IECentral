# IECentral — Recruiting / Onboarding / Reviews / Training

Internal HR platform cluster for **Import Export Tire Co** (a.k.a. "IE Tire"). Stack: **Next.js 15 (App Router)** front end, **Convex** reactive backend (`convex/*.ts`, schema in `convex/schema.ts`), and **AWS** for video storage (S3) and the public Indeed webhook. AI features use the **Anthropic SDK** (`@anthropic-ai/sdk`, model `claude-sonnet-4-20250514`) with graceful regex/heuristic fallbacks when `ANTHROPIC_API_KEY` is unset.

This document covers the end-to-end hiring funnel and the post-hire people-ops modules:

```
Jobs board → Application (web / Indeed / bulk / manual) → AI scoring → Pipeline
→ Interview rounds (AI Q&A + eval) → Offer letter → Hire (Personnel) → Onboarding docs
→ Surveys / Performance reviews / Training → Exit interview
```

---

## 1. Applicant Tracking System (ATS)

### Purpose
Manage the full hiring pipeline: ingest applications from multiple sources, AI-score candidates, run multi-round interviews with AI-generated questions and evaluations, and hand off hires to the Personnel module.

### App routes
| Route | File | Purpose |
|-------|------|---------|
| `/applications` | `app/applications/page.tsx` (1272 lines) | Pipeline dashboard — table + kanban views, stats bar, top-candidates, filters, status dropdowns |
| `/applications/[id]` | `app/applications/[id]/page.tsx` (2251 lines) | Candidate detail — scores, flags, employment history, interview rounds, scheduling, offer, hire |
| `/applications/bulk-upload` | `app/applications/bulk-upload/page.tsx` (619 lines) | Drag-drop multi-PDF upload; extract text → AI analyze → create applications |

### Backend
- **`convex/applications.ts`** (1891 lines) — ~50 queries/mutations. Key exports:
  - Reads: `getAll`, `getArchived`, `getByStatus`, `getByStatusGrouped` (kanban), `getById`, `getStats`, `getHiringAnalytics`, `getScoreHistory`, `getUpcomingInterviews`, `getActivityTimeline`, `checkForDuplicate`.
  - Writes: `submitApplication` (public intake), `create` (manual), `updateStatus` / `updateStatusWithActivity`, `updateAIAnalysis`, `remove`, `archive` / `unarchive` / `archiveRejected` / `archiveHired`.
  - Interviews: `startInterviewRound`, `updateInterviewAnswer`, `savePreliminaryEvaluation`, `updateInterviewNotes`, `saveInterviewEvaluation`, `completeInterviewRound`, `deleteInterviewRound`, `markDidNotShow`.
  - Scheduling: `scheduleInterview`, `rescheduleInterview`, `clearScheduledInterview`, `addInterviewAttendees` / `getInterviewAttendees` / `removeInterviewAttendee`.
  - Resume files: `generateUploadUrl`, `getResumeUrl`, `updateResumeFile`.
  - Maintenance: `rescoreAllApplications`, `updateCandidateScore`, `restoreOriginalDates`, `autoExpireOldApplications` (cron internalMutation).

### Data tables
- **`applications`** (schema L150–273) — applicant contact + `resumeText` + `resumeFileId` (`_storage`), `appliedJobId`/`appliedJobTitle`/`appliedLocation`, plus two nested AI blobs:
  - `aiAnalysis`: suggested job, `matchScore`, `allScores[]` (per-job score/keywords/reasoning), `extractedSkills`, `summary`.
  - `candidateAnalysis`: `overallScore`/`stabilityScore`/`experienceScore`, `graduationYear`/`yearsSinceGraduation`, `employmentHistory[]`, `redFlags[]` (type/severity/description), `greenFlags[]`, tenure stats, `recommendedAction`, `hiringTeamNotes`.
  - `status` (see below), `source` (`indeed`/`manual`/`bulk-upload`/`website`), `isArchived`, scheduled-interview fields, and `interviewRounds[]` (up to 3): each round holds `preliminaryEvaluation` (six 1–4 small-talk scores), `questions[]` (with `aiGenerated`), `interviewNotes`, and `aiEvaluation` (score/strengths/concerns/recommendation/feedback). Indexes: `by_email`, `by_status`, `by_job`, `by_created`.
- **`applicationActivity`** (schema L276–288) — timeline: `type`, `description`, `previousValue`/`newValue`, `performedBy`/`performedByName`, `metadata`. Indexes `by_application`, `by_created`. Written by `logActivity` and inline on status changes.

### Statuses
`new → reviewed → contacted → scheduled → interviewed → hired` with branches `dns` (did-not-show), `rejected`, `expired`, and offer states (`offer_sent`/`offer_accepted`/`offer_declined` set by `offerLetters`).

### Key workflows & notable logic
- **Scheduling (`scheduleInterview`)** also creates a linked `events` calendar record + `eventInvites` (auto-accepted), and emails the candidate via `internal.emails.sendInterviewScheduledEmail`. **Gotcha:** the timestamp is computed on the *frontend* (`startTimestamp`) to preserve local timezone; the mutation trusts it (`args.startTimestamp!`). **Hardcoded:** Nick Quinn (`Mrquinn1985@gmail.com`) is auto-added as an attendee on every interview. Default duration 1 hour. Job title/email/phone are baked into the event description.
- **Auto-expire (`autoExpireOldApplications`)** — cron internalMutation archives apps in stagnant statuses (`new`/`reviewed`/`contacted`/`dns`) older than 45 days, sets `status: "expired"`, and logs a system activity. Active statuses (hired/rejected/scheduled/interviewed) are skipped.
- **Hire** creates a Personnel record (form per `APPLICATIONS_USER_GUIDE.md`) and archives the application.
- **Permissions** (per `APPLICATIONS_USER_GUIDE.md`): all authenticated users can view/change-status/interview/hire/bulk-upload; **delete is Admin / Super-Admin only.**

### User guides
- **`docs/ATS-USER-GUIDE.md`** — full lifecycle reference: 7 application statuses, four intake channels, pipeline table/kanban, candidate profile tabs (Overview/Resume/Interview/Activity), 3-phase interviews, offer-letter status flow (`draft→sent→viewed→accepted/declined/expired/withdrawn`), hire→personnel, onboarding docs, job postings, bulk upload, Indeed mapping. (v2.0, "Last Updated January 2026").
- **`docs/APPLICATIONS_USER_GUIDE.md`** — operator-focused: dashboard layout (stats bar, gold/silver/bronze Top Candidates), AI scoring weights (**35% experience / 35% stability / 20% skills / 10% education**), score color bands (≥80 green, 60–79 amber, <60 red), preliminary-eval 1–4 criteria, interview round mechanics, hire form fields, troubleshooting (score=50 means AI failed), permissions table.

### AI features (Anthropic)
| File | Export(s) | What it does |
|------|-----------|--------------|
| `convex/aiMatching.ts` (594) | `analyzeResume` (action), `reanalyzeApplication`, `reanalyzeAllApplications` | Single Claude call scores resume against **all** active jobs (by index), extracts contact info + skills + employment history + red/green flags + tenure stats + `recommendedAction`. `temperature:0`, `max_tokens:3000`, **3-retry exponential backoff** on 429/overloaded; `fallbackAnalysis()` does regex name/email/phone extraction + flat score 25 when AI unavailable. Prompt is heavily domain-tuned: tire-tech bonus rules, owner/founder is *not* a red-flag, career-stage (years-since-graduation) bonus for physical roles. |
| `convex/aiInterview.ts` (465) | `generateInterviewQuestions`, `evaluateInterview` (actions) | Generates round-specific question sets (5–8 by round/positionType), avoids repeating prior-round questions, addresses red flags. `evaluateInterview` scores Q&A 0–100 with strengths/concerns/recommendation; **explicitly told answers are interviewer shorthand notes — do not penalize brevity**, and folds in the preliminary 1–4 small-talk average. Both have hardcoded fallback question banks / heuristic eval. |
| `convex/aiTasks.ts` (211) | `generateTasks` (action) | **Not recruiting** — breaks a *project* description into tasks for the Projects module. Listed here only because it shares the Anthropic-SDK pattern. |

---

## 2. Indeed Integration

### Purpose
Auto-ingest applications submitted through Indeed Apply, dedupe them, AI-analyze, map to internal jobs, and create `applications` records without manual entry.

### Route / backend
| File | Role |
|------|------|
| `app/api/indeed-webhook/route.ts` (257) | Public Next.js route handler. `POST` verifies an **HMAC-SHA1** signature (`X-Indeed-Signature`, secret `INDEED_API_SECRET` — skipped if no secret set), parses the Indeed payload, decodes base64 resume PDF (`unpdf.extractText`) or falls back to Indeed resume text, uploads the PDF to Convex storage, then calls `indeedActions.processIndeedApplication`. **Always returns HTTP 200** so Indeed doesn't retry on our internal errors. `maxDuration = 60`. `GET` is a liveness/info endpoint. |
| `convex/indeedActions.ts` (237) | `processIndeedApplication` (action, "use node"). Dedupe by `indeedApplyId` (webhook log) **and** by email/name (`applications.checkForDuplicate`); resolve target job via `indeedJobMappings` (score 100) → AI best match → first active job (score 25); merge Indeed-provided vs AI-extracted contact info; call `applications.submitApplication` with `source:"indeed"`; write a webhook log row. |
| `convex/indeedIntegration.ts` (159) | Plain queries/mutations: `createWebhookLog`, `logWebhookError`, `getWebhookLogByApplyId`, job-mapping CRUD (`getJobMappingByIndeedId`, `getAllJobMappings`, `upsertJobMapping`, `deleteJobMapping`), `getRecentWebhookLogs`, `getWebhookStats`. |

### Data tables
- **`indeedWebhookLogs`** (schema L2420–2438) — `indeedApplyId` (64-char), applicant name/email, indeed job id/title, `status` (`success`/`duplicate`/`error`), linked `applicationId`, `errorMessage`, truncated `rawPayload`. Indexes `by_indeed_apply_id`, `by_status`, `by_received`.
- **`indeedJobMappings`** (schema L2441–2449) — `indeedJobId` ↔ `internalJobId`(`jobs`) + titles + location + `isActive`. Index `by_indeed_job`.

### Notable
Every inbound application — even duplicates and errors — is logged for monitoring. `rawPayload` is truncated to 10k chars before storage. Mapped jobs get a perfect (100) match score, bypassing AI ambiguity.

---

## 3. Offer Letters & Onboarding

### Purpose
Generate/send/track employment offers tied to an application, then collect e-signatures on company onboarding documents (handbook, policies, agreements, forms) with versioning.

### Backend & tables

**Offer letters — `convex/offerLetters.ts` (603)**
- Queries: `list`, `getById` (joins application), `getByApplication`, `getStats` (counts + acceptance rate), `generateOfferHtml` (full inline HTML template / PDF source).
- Mutations: `create` (draft), `update` (draft only), `createAndSend` (one-shot), `send`, `markViewed`, `accept` (captures `signatureData` + IP, checks expiry), `decline`, `withdraw`, `remove` (draft only).
- Internal: `sendOfferEmail` action → `internal.emails.sendOfferLetterEmail`.
- **Table `offerLetters`** (schema L2349–2397): copied candidate info, position/comp (`compensationType` hourly|salary, `compensationAmount`, `payFrequency`), schedule, benefits, `status` (`draft|sent|viewed|accepted|declined|expired|withdrawn`), timestamps, signature, optional `pdfStorageId`, `additionalTerms`/`internalNotes`. Indexes `by_application`, `by_status`, `by_candidate_email`.
- **Logic/gotchas:** default expiry **7 days**; only one *active* offer per application (withdrawn/declined/expired don't block a new one); `accept`/`send`/`decline` push status changes back onto the parent `applications` record (`offer_sent`/`offer_accepted`/`offer_declined`); HTML template hardcodes logo `https://iecentral.com/logo.gif` and company "Import Export Tire Co", and states the offer is contingent on background check + work eligibility.

**Onboarding documents — `convex/onboardingDocuments.ts` (355)**
- Queries: `listActive`, `listAll` (with signature counts), `getById`, `getDocumentUrl`, `getForEmployee` (per-employee signed/needs-resign status), `getPendingForEmployee` (required+unsigned), `getSignaturesForDocument`, `getUnsignedEmployees`.
- Mutations: `generateUploadUrl`, `create`, `update`, `uploadNewVersion`, `signDocument`, `deleteDocument` (cascades signatures).
- **Table `onboardingDocuments`** (schema L2154–2175): PDF in `_storage`, `documentType` (`handbook|policy|agreement|form`), `requiresSignature`, `isRequired`, `isActive`, `version`, `effectiveDate`. Indexes `by_type`, `by_active`.
- **Table `documentSignatures`** (schema L2178–2202): `documentId`+`personnelId`(+optional `userId`), `signedAt`, `signatureData` (base64), IP/device, `acknowledgmentText`, `documentVersion`, optional per-disclosure `initialsData[]` (initials images for sections like at-will/confidentiality). Indexes `by_document`, `by_personnel`, `by_document_personnel`.
- **Versioning logic:** a signature is keyed to a document *version*; bumping the version (`uploadNewVersion`) makes prior signers show `needsResign` and re-enter the pending list. Re-signing the same version is blocked.

> ⚠️ **Naming gotcha:** `convex/documentSignatures.ts` (115 lines) is **NOT** the onboarding signature backend. It serves the **Doc Hub** module (tables `documents` / `docHubSignatures`). Onboarding signatures are written by `onboardingDocuments.signDocument` into the `documentSignatures` table. The file name and the table name collide but belong to different features.

---

## 4. Exit Interviews & Surveys

### Exit interviews
**Purpose:** capture structured feedback from departing employees, support a sign-off + 7-day reversible-termination window, and produce AI analytics.

- **Routes:** `app/exit-interviews/page.tsx` (544) — admin list/conduct/analytics; `app/exit-survey/[id]/page.tsx` (415) — public self-service survey form opened from an emailed link (no auth).
- **Backend `convex/exitInterviews.ts` (786):** `list`, `getById`, `getByPersonnel`, `getPending`, `getAnalytics` (avg ratings, would-return/recommend, top reasons, by-department); mutations `create` (auto on termination), `schedule`, `complete` (**super-admin only**), `signOff`, `reverse`, `decline`, `remove`, `resetToPending`/`resetAllToPending`, `submitSelfService` (no-auth survey submit), `getReasonOptions`; actions `sendBulkExitInterviewEmails`, `generateAISummary` (Claude HR-analytics summary → exec summary/themes/sentiment/action items). Internal helpers for bulk email + completed-interview fetch.
- **Table `exitInterviews`** (schema L2288–2346): personnel snapshot, hire/termination dates, `status` (`pending|pending_signoff|scheduled|completed|declined|reversed`), scheduling + linked `calendarEventId`, **sign-off / reversal fields** (`signedOffByUserId`, `reversibleUntil`, `reversedAt`/`reversedReason`), `leavingCategory` (voluntary_quit/involuntary/layoff/performance/attendance/no_call_no_show/other), HR-handoff (`rehireEligible`, `severancePaid`, `finalPaycheckDate`, `hrNotes`), and a `responses` object (primary reason, would-return/recommend, five 1–10 ratings, free-text). Indexes `by_personnel`, `by_status`, `by_date`.
- **Notable:** `reverse` enforces the `reversibleUntil` deadline, flips the personnel record back to `active`, clears termination fields, and cancels the calendar event — past the window it tells you to use the Rehire flow instead. `complete`/`signOff`/`reverse` are gated by `requireRole(..., ["super_admin"])`. Self-service submit and `decline` are intentionally not role-gated (terminated employees have no auth).

### Engagement surveys
**Purpose:** recurring pulse/engagement surveys to employees with happiness + NPS scoring and a dashboard.

- **Backend `convex/surveys.ts` (668):** campaign CRUD (`listCampaigns`, `getCampaign`, `createCampaign`, `updateCampaign`, `deleteCampaign` cascades, `deactivateAllCampaigns`, `createDefaultPulseSurvey`), `sendSurvey` (creates per-employee assignments + schedules staggered emails), `submitResponse`, `getMyPendingSurveys`, dashboard `getEngagementMetrics` (avg happiness, avg NPS, response rate, 6-month trend, by-department) and `getRecentResponses`, plus `resendSurveyEmails` action.
- **Tables** (schema L2206–2285):
  - `surveyCampaigns` — `questions[]` (types `scale|nps|text|multiple_choice` with min/max labels), `isAnonymous`, `frequency` (`once|weekly|monthly|quarterly`), targeting (`targetDepartments`, `targetLocationIds`), schedule (`nextSendAt` for cron), stats. Indexes `by_active`, `by_next_send`.
  - `surveyAssignments` — per-employee send; `status` (`pending|completed|expired`), `expiresAt` (7 days). Indexes `by_campaign`, `by_personnel`, `by_status`, `by_campaign_personnel`.
  - `surveyResponses` — `answers[]`, computed `overallScore` (avg of numeric answers) and `npsScore`; `personnelId` is **omitted when the campaign is anonymous**, but `department`/`locationId` are still stored for aggregation. Indexes `by_campaign`, `by_personnel`, `by_submitted`, `by_department`.
- **Notable:** anonymity is enforced at write-time (no `personnelId` stored) and again at read-time (`getRecentResponses` shows "Anonymous"). Sending dedupes on existing pending assignments; resend skips terminated/non-active employees. Default "Weekly Pulse Check" template = happiness + valued + NPS + workload + free-text.

---

## 5. Performance Reviews

### Purpose
90-day and annual reviews. Travis (or any reviewer) rates each item **1–5 on paper**; scores entered in-app compute an average and a **recommended raise tier**; Andy/Terry approve or deny and record the approved increase. All driven from the **Review Tracker** report.

### Backend & tables
- **`convex/employeeReviews.ts` (250):** `listEligible` (eligibility windows), `get`, `listForPersonnel`, `list` (management view incl. money), and mutations `generate` / `generateBatch` (pre-print a blank review), `saveScores` (computes avg + recommended increase), `setDecision` (approve/deny + mirrors a note onto the personnel profile's `ninetyDayReview`/`annualReviews` timeline), `remove`. All gated by `requireManagePersonnel`.
- **Table `employeeReviews`** (schema L776–804): `reviewType` (`90_day|annual`), employee snapshot, `ratings[]` (questionId/section/1–5), `averageScore`, `recommendedIncrease`, `decision` (`pending|approved|denied`), `approvedIncrease` (free text), `status` (`generated|scored|decided`), reviewer/decider names. Indexes `by_personnel`, `by_type_status`, `by_status`.
- **Legacy table `performanceReviews`** (schema L746–771) — older category/goals/acknowledgment model; superseded by `employeeReviews` but still in schema.

### Shared logic — `lib/reviewQuestions.ts` (82)
Pure data/functions importable by both client and Convex. Question banks per type, grouped into three sections: **Attendance / Competence / Ability to Do the Job** (10 questions for 90-day, 11 for annual). `computeAverage`, `raiseTier`, `recommendedIncrease`. **Raise tiers** (avg bands):
| Avg band | 90-day | Annual |
|----------|--------|--------|
| < 2.5 | 0% (PIP / extended probation) | 0% |
| 2.5–3.4 | 1.0% | 2.0–2.5% |
| 3.5–4.4 | 2.0–2.5% | 3.0–3.5% |
| ≥ 4.5 | 3.0% | 4.0–5.0% |

> The scoring helpers are **duplicated inline** inside `employeeReviews.ts` (so the Convex bundler needn't resolve the shared module) — the comment warns to keep the bands in sync with `lib/reviewQuestions.ts`.

### Eligibility — `convex/employeeReviews.ts:listEligible`
- **90-day:** active, non-temp, ~75–200 days since hire, no decided review on file (open reviews still surface).
- **annual:** active, non-temp, ≥330 days since hire, no annual review created in the last ~330 days.

### Temp-to-hire — `lib/tempEligibility.ts` (43)
Temps (`employeeType === "temp"`) are excluded from review eligibility. Computes a projected "eligible-for-hire" date from `hireDate` + a days- or hours-based threshold (hours → `value/40*7` calendar days), with a manual override (`tempEligibleDateOverride`) winning.

### Print components (inline styles for browser Save-as-PDF)
| Component | Role |
|-----------|------|
| `components/ReviewPrintForm.tsx` (93) | Pre-filled blank evaluation form (one per employee, page-break each). Signature lines hardcode **Reviewer / Andy Barrows / Terry**. |
| `components/ReviewScorePanel.tsx` (139) | Client modal for score entry: 1–5 buttons per question, live average + recommended tier, then Approve/Deny + approved-increase. Calls `saveScores` then `setDecision`. |
| `components/ReviewSummaryPrint.tsx` (54) | Batch summary table (Terry's view): employee, avg, recommended, decision, approved — with a Terry approval signature line. |

---

## 6. Training

### Purpose
Internal training library of S3-hosted videos grouped into segments. Managers run in-person sessions (logging attendees → completions), assign videos to employees, and track per-employee / per-segment completion. Employees get a self-serve "My Training" view.

### App routes & components
| Route / Component | Role |
|-------------------|------|
| `app/training/page.tsx` (44) | Hub. Managers (perm `menu.training`) see `TrainingLibrary`; non-managers with assigned videos see `EmployeeTraining`. |
| `app/training/present/[segmentId]/page.tsx` (51) | Presenter mode — plays a segment's videos in order via signed URLs. |
| `components/training/TrainingLibrary.tsx` (120) | Admin: manage segments/videos, sessions. |
| `components/training/EmployeeTraining.tsx` (40) | Employee self-serve assigned videos. |
| `components/training/LogSessionModal.tsx` (90) | Record an in-person session (date, videos shown, attendees). |
| `components/training/VideoPlayerModal.tsx` (30) | Plays a video via signed URL. |

### API routes (S3, presigned URLs)
| Route | Role |
|-------|------|
| `app/api/training/upload-url/route.ts` | `POST` — verifies `training.hasTrainingAccess`, returns a presigned **PUT** URL under key `training/videos/...` (15-min expiry). |
| `app/api/training/video-url/route.ts` | `GET` — verifies `training.canViewVideo` (manager OR video assigned to caller), returns a presigned **GET** URL (4-hour expiry). |

Bucket = `TRAINING_S3_BUCKET` (defaults to shared `ietires-dunlop-jmk-uploads` with a `training/videos/` prefix; switch to a dedicated bucket via the env var only). Region `us-east-1`.

### Backend `convex/training.ts` (344)
Access gating via `userHasTrainingAccess` (super-admin or `permissionOverrides["menu.training"]`) and `requireTrainingAccess`. Exports: segment CRUD (`listSegments`/`createSegment`/`updateSegment`/`deleteSegment` cascades videos), video CRUD (`listVideos`/`addVideo`/`updateVideo`/`deleteVideo`), `listSessions`/`logSession`, `personnelTrainingProgress`, `segmentRoster`, `assignVideos`/`assignSegment`/`unassign`, `myAssignedTraining`, `canViewVideo`, `hasTrainingAccess`, `markVideoComplete` (employee self-serve). Shared `upsertCompletion` inserts a completion only if one doesn't already exist for that (personnel, video).

### Tables (schema L3578–3635)
| Table | Notes |
|-------|-------|
| `trainingSegments` | ordered, `isActive`. Index `by_order`. |
| `trainingVideos` | `segmentId`, `s3Key`, `order`, `durationSec`. Index `by_segment`. |
| `trainingSessions` | in-person session: date, presenter, `personnelAttendees[]`, `guestAttendees[]` (free-text), `videoIds[]`. Index `by_date`. |
| `trainingCompletions` | `source` (`session`|`self`), optional `certifiedBy`/`sessionId`. Indexes `by_personnel`/`by_video`/`by_segment`. |
| `trainingAssignments` | manager-assigned videos. Same three indexes. |

### Notable
Logging a session **back-fills completions** for every attendee × every video shown (source `session`, certified by presenter). Self-serve `markVideoComplete` requires the video to be *assigned* to the caller. Video access is doubly enforced (Convex `canViewVideo` query is re-checked inside the signed-URL API route).

---

## 7. Jobs Board

### Purpose
Source of truth for open positions — drives the public careers page, AI resume matching (keywords), and Indeed mapping.

- **Route:** `app/jobs/page.tsx` (901) — admin job management (create/edit, badges, display order).
- **Backend `convex/jobs.ts` (438):** `getActiveJobs` (used by `aiMatching`/`indeedActions`), `getAll`, `getById`, `getByDepartment`, `create`, `update`, `toggleUrgentHiring`, `remove`, and `seedJobs`/`reseedJobs` (8 hardcoded Bensenville, IL roles — Warehouse Manager, Supervisors, Ecommerce Manager, Inventory Specialist, Delivery Driver, Order Picker, Customer Service).
- **Table `jobs`** (schema L128–148): `title`, `location` (+ optional multi `locations[]`), `type`, `positionType` (`hourly|salaried|management` — drives interview question counts), `department`, `status`, `description`, `benefits[]`, **`keywords[]`** (fed to AI matching), `badgeType` (`urgently_hiring|accepting_applications|open_position`), `displayOrder`, `isActive`. Indexes `by_department`, `by_status`, `by_active`.
- **Recruiting relevance:** `keywords` are the matching signal in `aiMatching.analyzeResume`; `positionType` selects interview question banks/counts in `aiInterview`; `indeedJobMappings.internalJobId` points here.

---

## Cross-module integration map
- **Application → Offer → Personnel:** offer accept/decline writes status back to `applications`; hiring creates a Personnel record and archives the application.
- **Personnel** is the hub for post-hire modules: onboarding signatures, surveys, reviews, training, and exit interviews all key off `personnelId`.
- **Calendar (`events`/`eventInvites`):** interview scheduling and exit-interview scheduling create/cancel calendar events.
- **Email (`convex/emails.ts`):** interview confirmations, offer letters, exit-interview links, survey invites are all scheduled via `ctx.scheduler.runAfter(...)`.
- **Anthropic (`claude-sonnet-4-20250514`)** powers resume scoring, interview Q&A/eval, and exit-interview analytics — every call has a non-AI fallback.

## Env vars referenced
`ANTHROPIC_API_KEY`, `NEXT_PUBLIC_CONVEX_URL`, `INDEED_API_SECRET`, `TRAINING_S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
