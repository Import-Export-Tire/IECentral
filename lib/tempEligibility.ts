// Temp-to-hire eligibility helpers. A "temp" is a personnel record with
// employeeType === TEMP_TYPE. Its hireDate doubles as the temp start date.

export const TEMP_TYPE = "temp";

export function isTemp(employeeType?: string | null): boolean {
  return employeeType === TEMP_TYPE;
}

export interface TempEligibilityInput {
  hireDate?: string;                 // YYYY-MM-DD; temp start date while a temp
  tempEligibilityMode?: string;      // "days" | "hours"
  tempEligibilityValue?: number;     // e.g. 90 (days) or 520 (hours)
  tempEligibleDateOverride?: string; // YYYY-MM-DD; manual override wins when set
}

// Compute the projected eligible-for-hire date.
// - override wins when present
// - days mode: start + value calendar days
// - hours mode: start + round(value / 40 * 7) calendar days (40-hr week projection)
export function computeTempEligibleDate(p: TempEligibilityInput): Date | null {
  if (p.tempEligibleDateOverride) {
    const d = new Date(p.tempEligibleDateOverride);
    return isNaN(d.getTime()) ? null : d;
  }
  if (!p.hireDate || !p.tempEligibilityMode || !p.tempEligibilityValue) return null;
  const start = new Date(p.hireDate);
  if (isNaN(start.getTime())) return null;
  const days =
    p.tempEligibilityMode === "hours"
      ? Math.round((p.tempEligibilityValue / 40) * 7)
      : p.tempEligibilityValue;
  const elig = new Date(start);
  elig.setDate(elig.getDate() + days);
  return elig;
}

export function tempEligibilityLabel(p: TempEligibilityInput): string {
  if (!p.tempEligibilityMode || !p.tempEligibilityValue) return "—";
  return p.tempEligibilityMode === "hours"
    ? `${p.tempEligibilityValue} hrs`
    : `${p.tempEligibilityValue} days`;
}
