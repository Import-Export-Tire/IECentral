/** Who can check scanners in/out and set the lock PIN. */
export function canAssignScanners(role?: string | null): boolean {
  return (
    role === "super_admin" ||
    role === "admin" ||
    role === "warehouse_director" ||
    role === "warehouse_manager"
  );
}

/**
 * Who sees MDM guts: setup wizard, APK download, lock policy, wipe, OTA.
 * Floor managers assign and set PINs; they do not provision devices.
 */
export function canManageScannerMdm(role?: string | null): boolean {
  return role === "super_admin" || role === "admin";
}
