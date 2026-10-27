/**
 * Scanner Fleet access: Feature Permissions key equipment.scannerFleet
 * (Users → Edit → Feature Permissions) plus Assigned locations on that screen.
 */

export const SCANNER_FLEET_PERMISSION = "equipment.scannerFleet";

export type ScannerAccessUser = {
  role?: string | null;
  managedLocationIds?: readonly string[] | null;
  permissionOverrides?: Record<string, boolean> | null;
};

export type MutateResult = { ok: true } | { ok: false; reason: string };

function roleTier(role?: string | null): number {
  switch (role) {
    case "super_admin":
      return 5;
    case "admin":
      return 4;
    case "warehouse_director":
      return 3;
    case "warehouse_manager":
    case "office_manager":
    case "retail_manager":
    case "retail_store_manager":
      return 2;
    case "department_manager":
    case "shift_lead":
    case "retail_associate":
      return 1;
    default:
      return 0;
  }
}

/** Role default for the Feature Permissions row. Override on the Users screen wins. */
export function scannerFleetRoleDefault(role?: string | null): boolean {
  return roleTier(role) >= 4 || role === "warehouse_manager";
}

export function scannerFleetGranted(user: ScannerAccessUser): boolean {
  const overrides = user.permissionOverrides;
  if (overrides && SCANNER_FLEET_PERMISSION in overrides) {
    return overrides[SCANNER_FLEET_PERMISSION];
  }
  return scannerFleetRoleDefault(user.role);
}

export function scopedLocationIds(user: ScannerAccessUser): string[] {
  return (user.managedLocationIds ?? []).map(String).filter(Boolean);
}

export function homeSiteForUser(
  user: ScannerAccessUser,
  warehouseLocationIds: readonly string[],
): string {
  const warehouses = new Set(warehouseLocationIds.map(String));
  const hit = scopedLocationIds(user).find((id) => warehouses.has(id));
  return hit ?? "all";
}

export function canMutateScannerFleet(args: {
  user: ScannerAccessUser;
  site: string;
}): MutateResult {
  if (args.site === "all") {
    return { ok: false, reason: "Pick a warehouse to make changes." };
  }
  if (!scannerFleetGranted(args.user)) {
    return { ok: false, reason: "You can view this list, not change it." };
  }
  const scoped = scopedLocationIds(args.user);
  if (scoped.length === 0) return { ok: true };
  if (scoped.includes(args.site)) return { ok: true };
  return { ok: false, reason: "You can only change scanners at your warehouses." };
}

export function lockCopy(args: {
  user: ScannerAccessUser;
  site: string;
}): string {
  const result = canMutateScannerFleet(args);
  return result.ok ? "" : result.reason;
}

export function canEditAnywhere(user: ScannerAccessUser): boolean {
  return scannerFleetGranted(user);
}
