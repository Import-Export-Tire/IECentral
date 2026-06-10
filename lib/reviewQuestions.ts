// Shared performance-review content + scoring logic. Pure data/functions (no React,
// no Node), so both the client UI and Convex functions can import it.

export type ReviewType = "90_day" | "annual";

export interface ReviewQuestion {
  id: string;       // stable key, stored with the rating
  section: string;  // "Attendance" | "Competence" | "Ability to Do the Job"
  text: string;     // the question Travis rates 1-5
}

export const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  "90_day": "90-Day Review",
  annual: "Annual Review",
};

// Target areas (Andy): Attendance, Competence, Ability to do the job.
const NINETY_DAY: ReviewQuestion[] = [
  { id: "att_ontime", section: "Attendance", text: "Arrives on time and ready to work" },
  { id: "att_dependable", section: "Attendance", text: "Dependable — few or no unexcused absences" },
  { id: "att_notice", section: "Attendance", text: "Gives proper notice when unable to work" },

  { id: "comp_accuracy", section: "Competence", text: "Performs core job tasks correctly and accurately" },
  { id: "comp_pace", section: "Competence", text: "Works at a productive pace and keeps up with the workload" },
  { id: "comp_procedures", section: "Competence", text: "Follows procedures and safety practices" },

  { id: "job_understands", section: "Ability to Do the Job", text: "Understands the role and required skills" },
  { id: "job_feedback", section: "Ability to Do the Job", text: "Responds well to direction and feedback" },
  { id: "job_attitude", section: "Ability to Do the Job", text: "Positive attitude and works well with others" },
  { id: "job_overall", section: "Ability to Do the Job", text: "Overall, capable of performing the job at the expected level" },
];

const ANNUAL: ReviewQuestion[] = [
  { id: "att_punctual", section: "Attendance", text: "Consistent punctuality throughout the year" },
  { id: "att_reliable", section: "Attendance", text: "Reliable attendance — few or no unexcused absences" },
  { id: "att_planning", section: "Attendance", text: "Plans time off responsibly and gives proper notice" },

  { id: "comp_quality", section: "Competence", text: "Consistently accurate, high-quality work" },
  { id: "comp_knowledge", section: "Competence", text: "Strong job knowledge; has grown in the role this year" },
  { id: "comp_efficiency", section: "Competence", text: "Productive and efficient; manages workload well" },
  { id: "comp_procedures", section: "Competence", text: "Follows procedures and maintains safety standards" },

  { id: "job_problem", section: "Ability to Do the Job", text: "Handles problems and unexpected situations well" },
  { id: "job_team", section: "Ability to Do the Job", text: "Works well with the team; good communication and attitude" },
  { id: "job_initiative", section: "Ability to Do the Job", text: "Takes initiative and ownership without close supervision" },
  { id: "job_overall", section: "Ability to Do the Job", text: "Overall performance and contribution this year" },
];

export const REVIEW_QUESTIONS: Record<ReviewType, ReviewQuestion[]> = {
  "90_day": NINETY_DAY,
  annual: ANNUAL,
};

export function reviewSections(type: ReviewType): string[] {
  return [...new Set(REVIEW_QUESTIONS[type].map((q) => q.section))];
}

// Average of the answered 1-5 ratings (ignores unrated/0). Rounded to 2 decimals.
export function computeAverage(ratings: Record<string, number>): number {
  const vals = Object.values(ratings).filter((r) => typeof r === "number" && r >= 1 && r <= 5);
  if (vals.length === 0) return 0;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

// Wage-increase tiers (Andy's table). Bands: <2.5, [2.5,3.5), [3.5,4.5), >=4.5.
export interface RaiseTier {
  band: string;
  ninetyDay: string;
  annual: string;
}
export function raiseTier(avg: number): RaiseTier {
  if (avg < 2.5) return { band: "Below 2.5", ninetyDay: "0% (PIP / extended probation)", annual: "0%" };
  if (avg < 3.5) return { band: "2.5 – 3.4", ninetyDay: "1.0%", annual: "2.0 – 2.5%" };
  if (avg < 4.5) return { band: "3.5 – 4.4", ninetyDay: "2.0 – 2.5%", annual: "3.0 – 3.5%" };
  return { band: "4.5 – 5.0", ninetyDay: "3.0%", annual: "4.0 – 5.0%" };
}

// The recommended increase string for a given average + review type.
export function recommendedIncrease(avg: number, type: ReviewType): string {
  const t = raiseTier(avg);
  return type === "annual" ? t.annual : t.ninetyDay;
}
