# 3 — Hiring & Growth

This section covers everything from posting a job and reviewing applicants through onboarding new
hires, doing performance reviews, taking training, and gathering feedback through surveys. Most of
the hiring tools are for managers and admins; training and surveys are for everyone.

> 🔒 **Manager / Admin only** — most of the **Hiring** screens below (Job Listings, Applications,
> Engagement, Exit Interviews) appear in the sidebar only for managers and admins. If you don't see
> them, that's normal. **Training** and **Surveys** are visible to any employee who has been
> assigned something.

---

## In this section

- [Posting jobs](#posting-jobs)
- [The Applications dashboard](#the-applications-dashboard)
- [Application statuses](#application-statuses)
- [AI résumé scoring — what the score means](#ai-resume-scoring)
- [Reviewing a candidate](#reviewing-a-candidate)
- [Scheduling interviews](#scheduling-interviews)
- [Conducting interviews & the AI helper](#conducting-interviews)
- [Offer letters](#offer-letters)
- [Hiring a candidate](#hiring-a-candidate)
- [Bulk résumé upload](#bulk-resume-upload)
- [Where applications come from (Indeed & the careers page)](#where-applications-come-from)
- [Onboarding documents & e-signatures](#onboarding-documents)
- [Performance reviews](#performance-reviews)
- [Training](#training)
- [Surveys: exit interviews & engagement](#surveys)

---

<a id="posting-jobs"></a>
## Posting jobs

> 🔒 **Manager / Admin only**

Open positions live on the **Job Listings** screen. These postings feed the public careers page,
feed the AI that matches résumés to roles, and connect to your Indeed postings.

**To create a job posting:**

1. Open **Job Listings** from the sidebar (under **Hiring**).
2. Click **Add Job**.
3. Fill in the details:
   - **Title**, **Department**, and **Location(s)**
   - **Job Type** (full-time, part-time)
   - **Position Type** — *Hourly*, *Salaried*, or *Management*. This affects how many interview
     questions the AI generates later, so pick the right one.
   - **Description** and **Benefits**
   - **Keywords** — words and skills the AI looks for when matching résumés to this job. Good
     keywords lead to better match scores.
4. Save the job. Set its **Display Order** to control where it appears on the careers page (a lower
   number shows higher up).

**Job status & badges:**

- A job is **Open** (accepting applications) or **Closed**.
- Add a badge to draw attention: **Urgently Hiring**, **Accepting Applications**, or
  **Open Position**.

---

<a id="the-applications-dashboard"></a>
## The Applications dashboard

> 🔒 **Manager / Admin only**

Open **Applications** from the sidebar. This is the home base for every candidate, no matter how they
applied. What you'll see:

- **Statistics bar** — a row of counts across the top: total applications plus how many are New,
  Reviewed, Contacted, Interviewed, Hired, and Rejected.
- **Top Candidates** — the three highest-scoring active applicants, shown with **gold**, **silver**,
  and **bronze** badges and their scores. Click any card to jump straight to that candidate.
- **Search and filters** — search by name, email, or job title, and filter by status, department,
  or location.
- **Applications table** — every candidate in rows you can sort by **Position**, **Score**, or
  **Applied** date. Each row has a **Status** dropdown you can change right there.

**Two ways to view the pipeline:**

1. **Table view** — the sortable list described above.
2. **Kanban view** — a visual board with a column for each status. Drag a candidate's card from one
   column to the next to move them through the pipeline.

**Tips:**

- Start your day in the **Top Candidates** section, then sort the table by **Score** (highest first)
  to find the strongest applicants quickly.
- Update statuses as you go so the statistics bar and reports stay accurate.

---

<a id="application-statuses"></a>
## Application statuses

Every candidate has a status that shows where they are in the process. Change it from the **Status**
dropdown in the table or on the candidate's page.

| Status | What it means |
|---|---|
| **New** | Just arrived, not yet looked at. |
| **Reviewed** | You've read the application. |
| **Contacted** | You've reached out to the candidate. |
| **Scheduled** | An interview is booked. |
| **Interviewed** | The interview is done; you're deciding. |
| **DNS** | "Did Not Show" — the candidate missed a scheduled interview. |
| **Hired** | Offer accepted; the candidate is now an employee. |
| **Rejected** | Not moving forward. |
| **Expired** | Aged out automatically (see the note below). |

The usual path is **New → Reviewed → Contacted → Scheduled → Interviewed → Hired**, with **Rejected**
or **DNS** as off-ramps. When you send an offer, you'll also see offer states
(**Offer Sent / Accepted / Declined**) — see [Offer letters](#offer-letters).

> **Tip — auto-cleanup:** Applications that sit untouched in **New**, **Reviewed**, **Contacted**, or
> **DNS** for about 45 days are automatically moved to **Expired** so your active list stays clean.
> Candidates who are scheduled, interviewed, hired, or rejected are never auto-expired. Keep statuses
> current so good candidates don't expire by accident.

---

<a id="ai-resume-scoring"></a>
## AI résumé scoring — what the score means

When a résumé comes in, IE Central reads it automatically and gives the candidate an **Overall
Score** from 0 to 100, plus a few sub-scores. **This score is a guide to help you prioritize — it is
not a hiring decision.** Always read the actual résumé and trust your own judgment.

**How the overall score is built:**

| Weight | Factor |
|---|---|
| 35% | **Experience** — how relevant their work history is to the role |
| 35% | **Stability** — how long they've stayed in past jobs |
| 20% | **Skills** — relevant certifications and abilities |
| 10% | **Education** — relevant training or degrees |

**Reading the score at a glance:**

| Score | Color | Read it as |
|---|---|---|
| 80–100 | Green | Excellent fit — worth interviewing soon |
| 60–79 | Amber | Good candidate — worth a closer look |
| Below 60 | Red | May have concerns to dig into |

The system also flags things for you:

- **Green flags** — positives like long job tenure, promotions, or directly relevant experience.
- **Red flags** — concerns like job hopping, unexplained employment gaps, or experience that doesn't
  match the role. Each red flag is rated **Low**, **Medium**, or **High**. Red flags are conversation
  starters for the interview, not automatic disqualifiers.
- **Recommended Action** — a plain-language suggestion such as *Strong Candidate*,
  *Worth Interviewing*, *Review Carefully*, or *Likely Pass*.

> **If you see a score of exactly 50** with a generic or blank name, the automatic résumé reader
> couldn't process that file (often because too many uploaded at once, or the PDF was a scanned
> image rather than real text). It usually re-processes on its own; if it doesn't, re-upload the
> résumé. A scanned-image PDF or a password-protected PDF won't read.

---

<a id="reviewing-a-candidate"></a>
## Reviewing a candidate

> 🔒 **Manager / Admin only**

Click any candidate's name or row to open their full profile. You'll find:

- **Header** — name, the position applied for, the status dropdown, and the main action buttons.
- **Contact information** — email, phone, and the date they applied.
- **Candidate scores** — the overall score plus stability, experience, and total years of
  experience, shown visually.
- **Red & green flags** — the detailed breakdown described above.
- **Employment history** — a timeline of past jobs with how long they stayed at each, plus average
  and longest tenure.
- **AI job match** — how well they fit your other open roles, not just the one they applied for.
- **Hiring team notes** — a short AI-written summary for your team.
- **Submitted résumé** — the original résumé text, and the PDF when one was attached.
- **Internal notes** — a private space to jot your own thoughts. Add notes as you go so teammates
  have context.

---

<a id="scheduling-interviews"></a>
## Scheduling interviews

> 🔒 **Manager / Admin only**

1. Open the candidate's profile.
2. In the **Schedule Interview** section, click **Schedule Interview**.
3. Enter the **Date**, **Time**, and **Location** (In-person, Phone, Video Call, or Other).
4. Confirm.

When you schedule, IE Central automatically:

- Changes the status to **Scheduled**.
- Adds the interview to the **calendar** and invites the attendees.
- Emails the candidate a confirmation.

**Managing a scheduled interview:**

- The scheduled interview shows as an orange banner on the profile. Use **Edit Interview Schedule**
  to change the date or time (the candidate is notified), or clear it to remove it.
- If a candidate doesn't show up, mark them as **DNS** (Did Not Show). The status updates and it's
  recorded in their activity history.

---

<a id="conducting-interviews"></a>
## Conducting interviews & the AI helper

> 🔒 **Manager / Admin only**

IE Central supports up to **three interview rounds** (initial screening, a deeper interview, and a
final round if needed). Each round has three parts.

**Start a round:**

1. On the candidate's profile, find the interview-rounds section and click
   **Start Interview Round** (it shows the round number).
2. Enter the **Interviewer Name**.
3. Click to generate questions.

**Part 1 — Preliminary evaluation (small talk).** As you greet the candidate, rate your first
impression on a **1–4 scale** in the amber box:

| Score | Meaning |
|---|---|
| 1 | Poor |
| 2 | Below average |
| 3 | Good |
| 4 | Excellent |

You rate **Appearance**, **Manner**, **Conversation**, **Intelligence**, **Sociability**, and a
general **Health/energy** impression, then click **Save Preliminary Evaluation**. The average feeds
into the AI's overall read of the interview.

**Part 2 — Interview questions (the AI helper).** The system writes a tailored set of questions for
you, based on the candidate's résumé, the role, and any flags worth exploring — and it avoids
repeating questions from earlier rounds. For each one, read it aloud and type the candidate's answer.
You can add follow-up questions of your own and use the **Interview Notes** area (**Save Notes**) for
anything else. *You're jotting shorthand notes — short answers are fine; the AI knows these are
notes, not transcripts, and won't penalize brevity.*

**Part 3 — Evaluation.** When you've recorded the answers, have the system generate an AI evaluation.
It returns:

- An **overall score** (0–100)
- **Strengths** the candidate showed
- **Concerns** to weigh
- A **recommendation** — *Strong Yes*, *Yes*, *Maybe*, or *No*
- A longer written **feedback** summary

Then complete the round. A thank-you email goes to the candidate and the status moves to
**Interviewed**.

> **Tips:** Review the AI analysis *before* the interview so you can probe red flags directly. Fill
> in the evaluation right after the interview while it's fresh. Treat both the AI questions and the
> AI recommendation as a strong starting point — your judgment makes the call.

---

<a id="offer-letters"></a>
## Offer letters

> 🔒 **Manager / Admin only**

When you're ready to make an offer, create one from the candidate's profile.

1. Open the profile of a candidate in **Interviewed** status.
2. Start a new offer letter and fill in:
   - **Position** — job title, department, location, and who they report to
   - **Start Date**
   - **Compensation** — Hourly or Salary, the amount, and pay frequency
   - **Schedule & benefits** — work schedule, benefits dates, PTO accrual
   - **Additional terms** — any special conditions
3. Review the preview, then click **Send Offer Letter**. The candidate gets an email with a link to
   view, accept, or decline.

**The offer moves through these states** (you can watch them on the candidate's profile, and totals
appear on the **Engagement** screen's **Offer Letters** tab):

| State | Meaning |
|---|---|
| **Draft** | Being prepared; still editable. |
| **Sent** | Emailed to the candidate. |
| **Viewed** | The candidate opened it. |
| **Accepted** | The candidate accepted. |
| **Declined** | The candidate declined. |
| **Expired** | Passed its deadline (7 days by default). |
| **Withdrawn** | The company pulled the offer. |

**Notes:**

- The offer is automatically marked **contingent on a background check and proof of work
  eligibility**.
- You can **withdraw** a sent offer any time before it's accepted; the candidate is notified.
- Double-check compensation before sending, and follow up if an offer is **Sent** but not yet
  **Viewed**.

---

<a id="hiring-a-candidate"></a>
## Hiring a candidate

> 🔒 **Manager / Admin only**

Once a candidate accepts (or you're otherwise ready to hire):

1. Open their profile and click the green **Hire Applicant** button.
2. Fill in the new employee's details:
   - **Position** (pre-filled from the application)
   - **Department**
   - **Employee Type** (Full Time, Part Time, Contract, Seasonal)
   - **Hire Date**
   - **Hourly Rate** or **Annual Salary**
3. Create the personnel record.

What happens automatically:

- The application status becomes **Hired** and the application is filed away (archived).
- A new **personnel record** is created and you're taken to the new employee's page.
- The new hire is set up to be assigned onboarding documents and any training.

If a personnel record already exists for that candidate, the **Hire Applicant** button is replaced by
a link to **view the personnel record** instead.

> **Note:** Anyone with access to Applications can review, schedule, interview, and hire. **Deleting**
> an application permanently is limited to **Admin / Super-Admin** — and it can't be undone, so prefer
> moving a candidate to **Rejected** over deleting.

---

<a id="bulk-resume-upload"></a>
## Bulk résumé upload

> 🔒 **Manager / Admin only**

Use this when you have a stack of résumés to add at once — a job fair, a batch from Indeed, or email
attachments.

1. From the **Applications** screen, click **Bulk Upload**.
2. On the **Bulk Resume Upload** screen, drag your PDF files into the drop zone (or browse for them).
3. Click **Process All** — the count of files appears on the button.

As each résumé processes you'll see its progress, then a result:

- A **green check** means success, with the candidate's name, the matched job, and the score.
- A **red X** means that file failed, with the reason. Use **Retry** to try the failed ones again.
- If a résumé matches someone already in the system, it's handled smartly — for an existing applicant
  who came in without a PDF, the upload just **attaches the PDF** to their record instead of creating
  a duplicate. The results summary tells you how many PDFs were attached this way.

All new candidates land in the pipeline as **New**, fully scored and ready to review.

> **Tip:** Résumés must be real text PDFs. A scanned image or a password-protected PDF won't read.

---

<a id="where-applications-come-from"></a>
## Where applications come from

You don't have to enter most candidates by hand. Applications arrive four ways:

1. **The careers page** — candidates apply directly on the public IE Central careers site.
2. **Indeed** — when someone applies to one of your Indeed postings, the application flows in
   automatically, gets scored, and appears in the pipeline as **New**, marked with an Indeed source.
   Admins can connect Indeed job IDs to internal jobs and view incoming activity in the Indeed
   settings.
3. **Manual entry** — add a candidate by hand when needed.
4. **Bulk upload** — see [above](#bulk-resume-upload).

However they arrive, every application is read and scored the same way and shows up in one place.

---

<a id="onboarding-documents"></a>
## Onboarding documents & e-signatures

New hires sign company documents — the handbook, policies, agreements, and forms — electronically,
right in IE Central.

**For new employees (signing your documents):**

1. After you're hired, any documents that need your signature appear in your portal.
2. Open a document and read or scroll through it.
3. Sign electronically (some documents also ask you to initial specific sections).
4. Your signature is saved with a date and time stamp.

**For managers/admins (managing documents):**

> 🔒 **Manager / Admin only**

- Upload a document (PDF), give it a **Title** and **Description**, choose its **Type** —
  **Handbook**, **Policy**, **Agreement**, or **Form** — set a **version** and **effective date**,
  and choose whether it **requires a signature** and whether it's **required** for everyone.
- For each document you can see how many employees have signed, how many are pending, and exactly
  **who hasn't signed yet**.
- When you upload a **new version** of a document, people who signed the old version are asked to
  sign again, so signatures always match the current text.

---

<a id="performance-reviews"></a>
## Performance reviews

> 🔒 **Manager / Admin only**

IE Central runs two kinds of reviews — a **90-day review** for new hires and an **annual review** for
established employees. Everything happens on the **Review Tracker** (open **Personnel**, then
**Reviews**).

**Who's eligible:**

- **90-day:** an active, non-temporary employee roughly 75–200 days after their hire date who hasn't
  had a decided 90-day review yet.
- **Annual:** an active, non-temporary employee at least about 330 days since hire (or since their
  last annual review).
- **Temporary employees** aren't included in review eligibility.

**How a review works:**

1. From the Review Tracker, **generate** a blank review for an eligible employee (or generate a batch
   for several at once). This produces a printable evaluation form pre-filled with the employee's
   name.
2. The reviewer rates each item on paper, **1 to 5**, across three areas: **Attendance**,
   **Competence**, and **Ability to Do the Job**.
3. Back in the app, open the review and enter each **1–5** score. As you do, IE Central shows the
   **average score** and a **recommended raise tier**.
4. Add **general comments**, then record the decision: **Approve** or **Deny**, and enter the
   approved increase.

**How scores relate to raises** (the system recommends a tier; the final number is the approver's
call):

| Average score | 90-day review | Annual review |
|---|---|---|
| Below 2.5 | 0% (improvement plan / extended probation) | 0% |
| 2.5 – 3.4 | 1.0% | 2.0–2.5% |
| 3.5 – 4.4 | 2.0–2.5% | 3.0–3.5% |
| 4.5 and up | 3.0% | 4.0–5.0% |

Approving a review also adds a note to the employee's profile timeline so the history is in one place.

---

<a id="training"></a>
## Training

IE Central has a **training library** of videos grouped into segments. How you use it depends on your
role.

**For employees (your assigned training):**

1. When training is assigned to you, **Training** appears in your sidebar. Open it to see
   **My Training**.
2. Videos are grouped by topic. Each shows whether it's **Completed** (a check) or **Not yet
   watched**.
3. Click a video to play it. When it finishes, it's automatically marked **Completed**.

**For managers/presenters:**

> 🔒 **Manager / Admin only**

- The **Training** screen opens the full library, where you manage segments and videos, assign videos
  (or whole segments) to employees, and review the **completion roster** per segment.
- Use **Log training session** to record an in-person session — pick the **Date**, the **Videos
  covered**, and the **attendees** (you can also add **guests not in the system** by name). Logging a
  session automatically marks all of those videos complete for everyone who attended.
- **Presenter mode** plays a segment's videos in order for a group session.

---

<a id="surveys"></a>
## Surveys: exit interviews & engagement

IE Central gathers feedback two ways — short **engagement surveys** sent to current employees, and
**exit interview surveys** for employees who are leaving.

> **Your privacy:** When a survey is marked **anonymous**, IE Central **does not store your name with
> your answers** — your responses can't be traced back to you. The survey screen tells you up front
> when it's anonymous: *"This survey is anonymous. Your responses will not be linked to your name."*
> Only combined results (by team or location) are ever shown. Please answer honestly.

### Taking an engagement survey (all employees)

1. When a survey is assigned to you, open **Surveys** from the sidebar.
2. Answer the questions — these can be a 1–10 rating, a recommend-us score, multiple choice, or a
   free-text box. Required questions are marked with a star.
3. Submit. A typical pulse survey asks how happy you are, whether you feel valued, how likely you are
   to recommend working here, and how your workload feels, plus space for open comments.

> Surveys expire after about a week, so complete yours when you get it.

### Exit interview survey (for departing employees)

When an employee is leaving, they receive an emailed link to an **Exit Interview Survey** — no login
needed. It asks for:

- The **primary reason for leaving** (a dropdown of common reasons).
- Ratings from **1 (Poor) to 5 (Excellent)** on overall satisfaction, management/supervision,
  work-life balance, compensation and benefits, and growth opportunities.
- Whether you'd **consider returning** and whether you'd **recommend** the company (Yes / Maybe / No).
- Open-ended questions: what you liked most, what we could improve, and any other comments.

The form states clearly: *"All responses are confidential and will only be used to improve our
workplace."* Click **Submit Feedback** when you're done.

### Engagement dashboard (managers/admins)

> 🔒 **Manager / Admin only**

Open **Engagement** from the sidebar. It has four tabs:

- **Overview** — average satisfaction, an **eNPS** score, response rate, and trends over time.
- **Surveys** — your survey campaigns; each shows its frequency (once, weekly, monthly, quarterly)
  and whether it's **Anonymous** or **Named**. You can send a campaign to employees or, if you have
  none yet, create a default **Weekly Pulse Check**.
- **Exit Interviews** — exit-survey results and analytics (also reachable from the **Exit
  Interviews** sidebar screen, where you can schedule and send exit surveys).
- **Offer Letters** — the running tally of offers by state (Draft, Sent, Viewed, Accepted, etc.).

> **A note on anonymity from the admin side:** even on the dashboard, anonymous responses show as
> "Anonymous" and are never tied to an individual — only department- or location-level summaries are
> available.

---

*Looking for the day-to-day employee basics — logging in, your profile, time off, pay? See
[Getting Started](01-getting-started.md) and [Time & Pay](02-time-and-pay.md). For the calendar that
interviews land on, see [Communication](05-communication.md).*
