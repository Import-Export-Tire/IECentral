# Scanner Fleet board

Warehouse managers use `/equipment/scanners`. Add a scanner, type who has it, send a PIN job, then unassign it.

## Flow

1. **Create** — pick a warehouse, Add Scanner, WO number + serial. Writes a `scanners` row (`status: available`). Site is `locationId`, joined to `scannerMdmConfigs.locationCode` when that row exists. Uniontown is omitted; there are no scanners there.
2. **Assign** — type a floor name. Not a personnel picker and not a signature. Saves to `scannerFloorHolders` and `scanners.assignedName`.
3. **PIN job** — Set PIN creates a `scannerJobs` `update_pin` row. The device applies it. The board’s current PIN updates from device telemetry.
4. **Unassign** — clears the holder and sets the scanner back to available. No condition note.

Assignees are typed names, not IECentral login `users` and not a `personnel` dropdown.

## Who can edit

Settings → Organization → Users → Edit → Feature Permissions → **Scanner Fleet board**, plus **Assigned locations** on that same screen. No second permissions page. Warehouse directors and warehouse managers get the board by default; anyone else needs the checkbox. Opening the board lands on the first assigned warehouse. People with no assigned locations still open on All.
