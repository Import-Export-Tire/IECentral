import { pinRejectReason } from "./pin";

/** Warehouse codes used on Scanner Fleet. Location rows are matched by name, not Convex id. */
export type WarehouseCode = "W08" | "R10" | "W09";
export type SiteFilter = WarehouseCode | "all";
export type EditorKey = "travis" | "mark" | "bill" | "ethan";

export const WAREHOUSES = [
  {
    code: "W08" as const,
    label: "W08 · Latrobe",
    name: "Latrobe",
    aliases: ["latrobe"],
  },
  {
    code: "R10" as const,
    label: "R10 · Everson",
    name: "Everson",
    aliases: ["everson"],
  },
  {
    code: "W09" as const,
    label: "W09 · Chestnut",
    name: "Chestnut",
    aliases: ["chestnut", "chestnut ridge"],
  },
] as const;

export const SITE_LABEL: Record<WarehouseCode, string> = {
  W08: "W08 · Latrobe",
  R10: "R10 · Everson",
  W09: "W09 · Chestnut",
};

/**
 * Login emails that resolve to the named managers. Lookups are by email
 * (then user._id). Never match the word "Travis" / "Mark" / "Bill" / "Ethan"
 * on a display name.
 */
export const EDITOR_EMAILS: Record<EditorKey, readonly string[]> = {
  travis: ["travis@ietires.com", "traviserwin062308@yahoo.com"],
  mark: ["mark@ietires.com"],
  bill: ["bill@ietires.com", "williampriceiii@gmail.com"],
  ethan: ["ethan@ietires.com", "emon.myers13@gmail.com"],
};

export const EDITOR_HOMES: Record<EditorKey, WarehouseCode> = {
  travis: "W08",
  mark: "R10",
  bill: "W09",
  ethan: "R10",
};

export type EditorIds = {
  travis?: string;
  mark?: string;
  bill?: string;
  ethan?: string;
};

export type FleetUser = {
  _id?: string;
  role?: string | null;
};

export type MutateResult = { ok: true } | { ok: false; reason: string };

export function normalizeEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

export function editorKeyForEmail(email?: string | null): EditorKey | null {
  const needle = normalizeEmail(email);
  if (!needle) return null;
  for (const key of Object.keys(EDITOR_EMAILS) as EditorKey[]) {
    if (EDITOR_EMAILS[key].some((e) => e.toLowerCase() === needle)) return key;
  }
  return null;
}

export function resolveEditorIds(
  people: Array<{ _id: string; email?: string | null }>,
): EditorIds {
  const ids: EditorIds = {};
  for (const person of people) {
    const key = editorKeyForEmail(person.email);
    if (key && !ids[key]) ids[key] = person._id;
  }
  return ids;
}

/** Logged-in user only. Does not need a Convex editors query. */
export function editorsFromUser(
  user?: { _id?: string; email?: string | null } | null,
): EditorIds {
  if (!user?._id) return {};
  const key = editorKeyForEmail(user.email);
  if (!key) return {};
  return { [key]: user._id };
}

export function matchPersonnelByName(
  people: Array<{
    _id: string;
    firstName: string;
    lastName: string;
    locationId?: string | null;
  }>,
  name: string,
  locationId?: string,
): string | null {
  const matches = people.filter((p) =>
    namesEqual(personnelFullName(p.firstName, p.lastName), name),
  );
  if (!matches.length) return null;
  if (locationId) {
    const here = matches.find((p) => p.locationId === locationId);
    if (here) return here._id;
  }
  return matches[0]._id;
}

export function editorKeyForUserId(
  userId: string | undefined,
  editors: EditorIds,
): EditorKey | null {
  if (!userId) return null;
  for (const key of Object.keys(editors) as EditorKey[]) {
    if (editors[key] === userId) return key;
  }
  return null;
}

export function isAdminRole(role?: string | null): boolean {
  return role === "admin" || role === "super_admin";
}

export function warehouseFromLocationName(name?: string | null): WarehouseCode | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  for (const site of WAREHOUSES) {
    if (site.aliases.some((alias) => alias === n) || site.name.toLowerCase() === n) return site.code;
  }
  return null;
}

export type FleetState = "assigned" | "unassigned";

export function fleetStatus(status?: string | null): FleetState {
  return status === "assigned" ? "assigned" : "unassigned";
}

export function fleetStateLabel(state: FleetState): string {
  return state === "assigned" ? "Assigned" : "Unassigned";
}

export function canAssignUnit(status?: string | null): boolean {
  return fleetStatus(status) === "unassigned";
}

export function homeSiteForUser(
  userId: string | undefined,
  role: string | null | undefined,
  editors: EditorIds,
): SiteFilter {
  const key = editorKeyForUserId(userId, editors);
  if (key) return EDITOR_HOMES[key];
  if (isAdminRole(role)) return "all";
  return "all";
}

export function canMutateScannerFleet(args: {
  userId?: string;
  role?: string | null;
  editors: EditorIds;
  site: SiteFilter;
}): MutateResult {
  if (args.site === "all") {
    return { ok: false, reason: "Pick a warehouse to make changes." };
  }
  if (isAdminRole(args.role)) return { ok: true };
  const key = editorKeyForUserId(args.userId, args.editors);
  if (key === "travis" || key === "mark" || key === "bill") return { ok: true };
  if (key === "ethan") {
    if (args.site === "R10") return { ok: true };
    return { ok: false, reason: `You can only change scanners at ${SITE_LABEL.R10}.` };
  }
  return { ok: false, reason: "You can view this list, not change it." };
}

export function lockCopy(args: {
  userId?: string;
  role?: string | null;
  editors: EditorIds;
  site: SiteFilter;
}): string {
  const result = canMutateScannerFleet(args);
  return result.ok ? "" : result.reason;
}

export function canEditAnywhere(
  userId: string | undefined,
  role: string | null | undefined,
  editors: EditorIds,
): boolean {
  if (isAdminRole(role)) return true;
  const key = editorKeyForUserId(userId, editors);
  return key === "travis" || key === "mark" || key === "bill" || key === "ethan";
}

export function buildAddScannerDoc(args: {
  number: string;
  locationId: string;
  now: number;
  pin?: string;
}): {
  number: string;
  locationId: string;
  status: "available";
  createdAt: number;
  updatedAt: number;
  pin?: string;
} {
  const number = args.number.trim().toUpperCase();
  const doc: {
    number: string;
    locationId: string;
    status: "available";
    createdAt: number;
    updatedAt: number;
    pin?: string;
  } = {
    number,
    locationId: args.locationId,
    status: "available",
    createdAt: args.now,
    updatedAt: args.now,
  };
  // add does not save a pin
  void args.pin;
  return doc;
}

export function addScannerRejectReason(args: {
  number: string;
  existingNumbers: string[];
}): string | null {
  const number = args.number.trim().toUpperCase();
  if (!number) return "Enter a WO number.";
  if (args.existingNumbers.some((n) => n.trim().toUpperCase() === number)) {
    return `${number} is already in the fleet.`;
  }
  return null;
}

export function assignRejectReason(args: {
  status?: string | null;
  name: string;
}): string | null {
  if (!canAssignUnit(args.status)) return "Assign only if Unassigned.";
  if (!args.name.trim()) return "Enter a name.";
  return null;
}

export const MDM_PIN_NOT_READY =
  "PIN did not apply. MDM is not working yet — do not treat this as set.";

export const PIN_QUEUED_MESSAGE =
  "PIN sent — waiting for the scanner. Current PIN updates when the device reports it.";

export const REMOTE_PIN_UNAVAILABLE =
  "This PIN cannot be changed from the website. The number above is what the scanner uses.";

/** Device Owner only. Enrolled + Device Admin is not enough to change the lock PIN. */
export function canRemoteSetPin(scanner: {
  iotThingName?: string | null;
  deviceOwner?: boolean | null;
}): boolean {
  return Boolean(scanner.iotThingName) && scanner.deviceOwner === true;
}

export function remotePinBlockReason(scanner: {
  iotThingName?: string | null;
  deviceOwner?: boolean | null;
}): string | null {
  if (canRemoteSetPin(scanner)) return null;
  return REMOTE_PIN_UNAVAILABLE;
}

export function mdmPinFailureMessage(args: {
  enrolled: boolean;
  error?: string | null;
}): string {
  const reason = args.error?.trim();
  if (!args.enrolled) {
    return "PIN did not apply. This scanner is not enrolled in MDM yet.";
  }
  if (reason) return reason;
  return MDM_PIN_NOT_READY;
}

export function setPinClientReject(pin: string, again: string): string | null {
  if (pin !== again) return "Those two PINs do not match.";
  return pinRejectReason(pin);
}

export function ageLabel(fromMs: number, toMs = Date.now()): string {
  const from = new Date(fromMs);
  const end = new Date(toMs);
  if (Number.isNaN(from.getTime()) || Number.isNaN(end.getTime())) return "";
  let months =
    (end.getFullYear() - from.getFullYear()) * 12 + (end.getMonth() - from.getMonth());
  if (end.getDate() < from.getDate()) months -= 1;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years && rem) return `${years} yr ${rem} mo`;
  if (years) return years === 1 ? "1 yr" : `${years} yr`;
  if (rem) return rem === 1 ? "1 mo" : `${rem} mo`;
  return "new";
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtWhen(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const date = fmtDate(ms);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

export function personnelFullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export function namesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
