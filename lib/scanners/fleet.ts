import { pinRejectReason } from "./pin";
import {
  canEditAnywhere,
  canMutateScannerFleet,
  homeSiteForUser,
  lockCopy,
  type MutateResult,
  type ScannerAccessUser,
} from "./access";

export type SiteFilter = string;
export type { MutateResult, ScannerAccessUser };
export {
  SCANNER_FLEET_PERMISSION,
  canEditAnywhere,
  canMutateScannerFleet,
  homeSiteForUser,
  lockCopy,
  scannerFleetGranted,
  scannerFleetRoleDefault,
  scopedLocationIds,
} from "./access";

export type WarehouseSite = {
  locationId: string;
  name: string;
  code: string | null;
  label: string;
};

export function warehouseSiteLabel(args: {
  name: string;
  code?: string | null;
}): string {
  const code = (args.code ?? "").trim();
  if (code) return `${code} · ${args.name}`;
  return args.name;
}

/** Uniontown is a warehouse in Convex but has no scanners on this board. */
export function isScannerFleetSite(args: {
  name: string;
  code?: string | null;
}): boolean {
  const code = (args.code ?? "").trim().toUpperCase();
  if (code === "W07") return false;
  const name = args.name.trim().toLowerCase();
  return name !== "uniontown" && !name.startsWith("uniontown ");
}

export function joinWarehouseSites(
  locations: Array<{ _id: string; name: string }>,
  configs: Array<{ locationId: string; locationCode?: string | null }>,
): WarehouseSite[] {
  const codeByLocation = new Map(
    configs.map((c) => [c.locationId, (c.locationCode ?? "").trim() || null]),
  );
  return locations
    .map((loc) => {
      const code = codeByLocation.get(loc._id) ?? null;
      return {
        locationId: loc._id,
        name: loc.name,
        code,
        label: warehouseSiteLabel({ name: loc.name, code }),
      };
    })
    .filter((site) => isScannerFleetSite(site))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/** Floor-staff departments that may hold a warehouse scanner. Not login users. */
export function isWarehouseAssigneeDepartment(department?: string | null): boolean {
  const d = (department ?? "").trim().toLowerCase();
  if (!d) return false;
  if (/\bretail\b/.test(d) && !/\bwarehouse\b/.test(d)) return false;
  return /\bwarehouse\b/.test(d) || /\bshipping\b/.test(d) || /\breceiving\b/.test(d);
}

export type AssigneeOption = {
  _id: string;
  firstName: string;
  lastName: string;
  department?: string | null;
  locationId?: string | null;
  status?: string | null;
};

export function filterAssignees(
  people: AssigneeOption[],
  args: { locationId: string; query?: string },
): AssigneeOption[] {
  const query = (args.query ?? "").trim().toLowerCase();
  return people.filter((p) => {
    if (p.status && p.status !== "active") return false;
    if (p.locationId !== args.locationId) return false;
    if (!isWarehouseAssigneeDepartment(p.department)) return false;
    if (!query) return true;
    return personnelFullName(p.firstName, p.lastName).toLowerCase().includes(query);
  });
}

export type FleetUser = {
  _id?: string;
  role?: string | null;
};

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

export function buildAddScannerDoc(args: {
  number: string;
  locationId: string;
  now: number;
  pin?: string;
  serialNumber?: string;
}): {
  number: string;
  locationId: string;
  status: "available";
  createdAt: number;
  updatedAt: number;
  pin?: string;
  serialNumber?: string;
} {
  const number = args.number.trim().toUpperCase();
  const serialNumber = args.serialNumber?.trim();
  const doc: {
    number: string;
    locationId: string;
    status: "available";
    createdAt: number;
    updatedAt: number;
    pin?: string;
    serialNumber?: string;
  } = {
    number,
    locationId: args.locationId,
    status: "available",
    createdAt: args.now,
    updatedAt: args.now,
  };
  if (serialNumber) doc.serialNumber = serialNumber;
  // add does not save a pin
  void args.pin;
  return doc;
}

export function addScannerRejectReason(args: {
  number: string;
  serialNumber?: string;
  existingNumbers: string[];
}): string | null {
  const number = args.number.trim().toUpperCase();
  if (!number) return "Enter a WO number.";
  if (args.existingNumbers.some((n) => n.trim().toUpperCase() === number)) {
    return `${number} is already in the fleet.`;
  }
  if (!(args.serialNumber ?? "").trim()) return "Enter a serial number.";
  return null;
}

export function assignRejectReason(args: {
  status?: string | null;
  name?: string | null;
}): string | null {
  if (!canAssignUnit(args.status)) return "Assign only if Unassigned.";
  if (!(args.name ?? "").trim()) return "Enter a name.";
  return null;
}

export function unassignConditionReason(condition?: string | null): string | null {
  if (!(condition ?? "").trim()) return "Enter the condition.";
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