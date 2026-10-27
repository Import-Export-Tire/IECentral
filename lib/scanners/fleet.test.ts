import { describe, it, expect } from "vitest";
import { pinRejectReason } from "./pin";
import {
  SCANNER_FLEET_PERMISSION,
  assignRejectReason,
  addScannerRejectReason,
  ageLabel,
  buildAddScannerDoc,
  canAssignUnit,
  canEditAnywhere,
  canMutateScannerFleet,
  filterAssignees,
  fleetStateLabel,
  fleetStatus,
  homeSiteForUser,
  isWarehouseAssigneeDepartment,
  joinWarehouseSites,
  canRemoteSetPin,
  mdmPinFailureMessage,
  PIN_QUEUED_MESSAGE,
  MDM_PIN_NOT_READY,
  REMOTE_PIN_UNAVAILABLE,
  remotePinBlockReason,
  scannerFleetGranted,
  setPinClientReject,
  unassignConditionReason,
  warehouseSiteLabel,
  type ScannerAccessUser,
} from "./fleet";

const LOC_LATROBE = "loc_latrobe";
const LOC_EVERSON = "loc_everson";
const LOC_CHESTNUT = "loc_chestnut";
const LOC_UNIONTOWN = "loc_uniontown";

const twoSiteManager: ScannerAccessUser = {
  role: "warehouse_manager",
  managedLocationIds: [LOC_LATROBE, LOC_CHESTNUT],
};
const eversonAdmin: ScannerAccessUser = {
  role: "admin",
  managedLocationIds: [LOC_EVERSON],
};
const uniontownManager: ScannerAccessUser = {
  role: "warehouse_manager",
  managedLocationIds: [LOC_UNIONTOWN],
};
const latrobeManager: ScannerAccessUser = {
  role: "warehouse_manager",
  managedLocationIds: [LOC_LATROBE],
};
const adminNoSites: ScannerAccessUser = { role: "admin" };
const superAdmin: ScannerAccessUser = { role: "super_admin" };
const director: ScannerAccessUser = { role: "warehouse_director" };
const managerNoSites: ScannerAccessUser = {
  role: "warehouse_manager",
  managedLocationIds: [],
};
const employee: ScannerAccessUser = { role: "employee" };
const grantedEmployee: ScannerAccessUser = {
  role: "employee",
  permissionOverrides: { [SCANNER_FLEET_PERMISSION]: true },
  managedLocationIds: [LOC_LATROBE],
};
const deniedManager: ScannerAccessUser = {
  role: "warehouse_manager",
  permissionOverrides: { [SCANNER_FLEET_PERMISSION]: false },
  managedLocationIds: [LOC_LATROBE],
};

describe("joinWarehouseSites", () => {
  it("joins Convex locations to MDM codes by location id, not name", () => {
    const sites = joinWarehouseSites(
      [
        { _id: LOC_UNIONTOWN, name: "Uniontown" },
        { _id: LOC_LATROBE, name: "Latrobe" },
        { _id: LOC_EVERSON, name: "Everson" },
        { _id: LOC_CHESTNUT, name: "Chestnut" },
      ],
      [
        { locationId: LOC_LATROBE, locationCode: "W08" },
        { locationId: LOC_EVERSON, locationCode: "R10" },
        { locationId: LOC_CHESTNUT, locationCode: "W09" },
      ],
    );
    expect(sites.find((s) => s.locationId === LOC_LATROBE)).toEqual({
      locationId: LOC_LATROBE,
      name: "Latrobe",
      code: "W08",
      label: "W08 · Latrobe",
    });
    expect(sites.find((s) => s.locationId === LOC_CHESTNUT)).toEqual({
      locationId: LOC_CHESTNUT,
      name: "Chestnut",
      code: "W09",
      label: "W09 · Chestnut",
    });
    expect(sites.map((s) => s.locationId)).not.toContain(LOC_UNIONTOWN);
  });

  it("does not invent a site code when MDM has no row", () => {
    expect(warehouseSiteLabel({ name: "Uniontown" })).toBe("Uniontown");
    expect(warehouseSiteLabel({ name: "Uniontown", code: "  " })).toBe("Uniontown");
  });
});

describe("isWarehouseAssigneeDepartment", () => {
  it("keeps warehouse floor departments and drops retail", () => {
    expect(isWarehouseAssigneeDepartment("Warehouse/Shipping")).toBe(true);
    expect(isWarehouseAssigneeDepartment("Warehouse Associate")).toBe(true);
    expect(isWarehouseAssigneeDepartment("Shipping")).toBe(true);
    expect(isWarehouseAssigneeDepartment("Receiving")).toBe(true);
    expect(isWarehouseAssigneeDepartment("Retail Tire Tech")).toBe(false);
    expect(isWarehouseAssigneeDepartment("Management")).toBe(false);
  });
});

describe("filterAssignees", () => {
  it("keeps active warehouse people at that location", () => {
    const people = [
      {
        _id: "p1",
        firstName: "Chris",
        lastName: "Hale",
        department: "Warehouse/Shipping",
        locationId: LOC_LATROBE,
        status: "active",
      },
      {
        _id: "p2",
        firstName: "Pat",
        lastName: "Nguyen",
        department: "Warehouse Associate",
        locationId: LOC_CHESTNUT,
        status: "active",
      },
      {
        _id: "p3",
        firstName: "Riley",
        lastName: "Stone",
        department: "Retail Tire Tech",
        locationId: LOC_LATROBE,
        status: "active",
      },
    ];
    expect(filterAssignees(people, { locationId: LOC_LATROBE }).map((p) => p._id)).toEqual(["p1"]);
    expect(filterAssignees(people, { locationId: LOC_LATROBE, query: "hale" }).map((p) => p._id)).toEqual(["p1"]);
    expect(filterAssignees(people, { locationId: LOC_LATROBE, query: "pat" })).toEqual([]);
  });
});

describe("homeSiteForUser", () => {
  it("picks the first assigned warehouse from Convex", () => {
    const warehouses = [LOC_LATROBE, LOC_EVERSON, LOC_CHESTNUT, LOC_UNIONTOWN];
    expect(homeSiteForUser(twoSiteManager, warehouses)).toBe(LOC_LATROBE);
    expect(homeSiteForUser(eversonAdmin, warehouses)).toBe(LOC_EVERSON);
    expect(homeSiteForUser(uniontownManager, warehouses)).toBe(LOC_UNIONTOWN);
    expect(homeSiteForUser(latrobeManager, warehouses)).toBe(LOC_LATROBE);
    expect(homeSiteForUser(adminNoSites, warehouses)).toBe("all");
  });

  it("stays on All until the assigned warehouse is in the board list", () => {
    expect(homeSiteForUser(eversonAdmin, [])).toBe("all");
    expect(homeSiteForUser(eversonAdmin, [LOC_LATROBE])).toBe("all");
    expect(homeSiteForUser(eversonAdmin, [LOC_LATROBE, LOC_EVERSON])).toBe(LOC_EVERSON);
  });
});

describe("canMutateScannerFleet", () => {
  it("lets a granted manager edit only assigned locations", () => {
    expect(canMutateScannerFleet({ user: twoSiteManager, site: LOC_LATROBE }).ok).toBe(true);
    expect(canMutateScannerFleet({ user: twoSiteManager, site: LOC_CHESTNUT }).ok).toBe(true);
    expect(canMutateScannerFleet({ user: twoSiteManager, site: LOC_EVERSON }).ok).toBe(false);
    expect(canMutateScannerFleet({ user: uniontownManager, site: LOC_UNIONTOWN }).ok).toBe(true);
    expect(canMutateScannerFleet({ user: uniontownManager, site: LOC_LATROBE }).ok).toBe(false);
  });

  it("scopes an admin to Assigned locations, not every warehouse", () => {
    expect(canMutateScannerFleet({ user: eversonAdmin, site: LOC_EVERSON }).ok).toBe(true);
    expect(canMutateScannerFleet({ user: eversonAdmin, site: LOC_LATROBE }).ok).toBe(false);
  });

  it("lets a granted user edit a picked warehouse when no locations are checked", () => {
    expect(scannerFleetGranted(adminNoSites)).toBe(true);
    expect(canMutateScannerFleet({ user: adminNoSites, site: LOC_LATROBE }).ok).toBe(true);
    expect(canMutateScannerFleet({ user: superAdmin, site: LOC_UNIONTOWN }).ok).toBe(true);
    expect(canEditAnywhere(adminNoSites)).toBe(true);
    expect(canMutateScannerFleet({ user: managerNoSites, site: LOC_LATROBE }).ok).toBe(true);
    expect(canMutateScannerFleet({ user: director, site: LOC_LATROBE }).ok).toBe(true);
    expect(canEditAnywhere(director)).toBe(true);
  });

  it("follows the Feature Permissions checkbox, not a name list", () => {
    expect(canMutateScannerFleet({ user: employee, site: LOC_LATROBE }).ok).toBe(false);
    expect(canMutateScannerFleet({ user: grantedEmployee, site: LOC_LATROBE }).ok).toBe(true);
    expect(canMutateScannerFleet({ user: grantedEmployee, site: LOC_EVERSON }).ok).toBe(false);
    expect(canMutateScannerFleet({ user: deniedManager, site: LOC_LATROBE }).ok).toBe(false);
  });

  it("does not allow mutations on All warehouses", () => {
    expect(canMutateScannerFleet({ user: twoSiteManager, site: "all" }).ok).toBe(false);
    expect(canMutateScannerFleet({ user: eversonAdmin, site: "all" }).ok).toBe(false);
    expect(canMutateScannerFleet({ user: superAdmin, site: "all" }).reason).toMatch(/Pick a warehouse/);
  });
});

describe("assign", () => {
  it("allows assign only when Unassigned and a name is typed", () => {
    expect(canAssignUnit("available")).toBe(true);
    expect(canAssignUnit("unassigned")).toBe(true);
    expect(canAssignUnit("maintenance")).toBe(true);
    expect(canAssignUnit("assigned")).toBe(false);
    expect(fleetStatus("maintenance")).toBe("unassigned");
    expect(fleetStateLabel("unassigned")).toBe("Unassigned");
    expect(assignRejectReason({ status: "assigned", name: "George" })).toMatch(/Unassigned/);
    expect(assignRejectReason({ status: "available", name: "" })).toMatch(/name/);
    expect(assignRejectReason({ status: "available", name: "George" })).toBeNull();
  });

  it("requires condition text on return", () => {
    expect(unassignConditionReason("")).toMatch(/condition/);
    expect(unassignConditionReason("good")).toBeNull();
  });
});

describe("add scanner", () => {
  it("creates a row with no PIN, including on an empty fleet", () => {
    expect(addScannerRejectReason({
      number: "W08-001",
      serialNumber: "17039522500218",
      existingNumbers: [],
    })).toBeNull();
    const doc = buildAddScannerDoc({
      number: "w08-001",
      locationId: LOC_LATROBE,
      now: 1,
      pin: "482917",
      serialNumber: " 17039522500218 ",
    });
    expect(doc.number).toBe("W08-001");
    expect(doc.status).toBe("available");
    expect(doc.pin).toBeUndefined();
    expect("pin" in doc && doc.pin).toBeFalsy();
    expect(doc.serialNumber).toBe("17039522500218");
  });

  it("rejects a duplicate WO at that warehouse", () => {
    expect(addScannerRejectReason({
      number: "W08-001",
      serialNumber: "17039522500218",
      existingNumbers: ["W08-001"],
    })).toMatch(/already/);
    expect(addScannerRejectReason({ number: "", existingNumbers: [] })).toMatch(/WO number/);
  });

  it("requires a serial number", () => {
    expect(addScannerRejectReason({ number: "W08-001", serialNumber: "", existingNumbers: [] })).toMatch(/serial/);
    expect(addScannerRejectReason({ number: "W08-001", existingNumbers: [] })).toMatch(/serial/);
  });
});

describe("PIN", () => {
  it("rejects weak six-digit PINs", () => {
    expect(pinRejectReason("111111")).toMatch(/guess/);
    expect(pinRejectReason("123456")).toMatch(/guess/);
    expect(setPinClientReject("482917", "482917")).toBeNull();
    expect(setPinClientReject("482917", "482918")).toMatch(/match/);
  });

  it("does not treat a queued job as the pin being set", () => {
    expect(mdmPinFailureMessage({ enrolled: false })).toMatch(/not enrolled/);
    expect(mdmPinFailureMessage({ enrolled: true })).toBe(MDM_PIN_NOT_READY);
    expect(mdmPinFailureMessage({ enrolled: true, error: "gateway down" })).toBe("gateway down");
  });

  it("only offers remote Set PIN on Device Owner scanners", () => {
    expect(canRemoteSetPin({ iotThingName: "scanner-W08-906", deviceOwner: true })).toBe(true);
    expect(canRemoteSetPin({ iotThingName: "scanner-W08-002", deviceOwner: false })).toBe(false);
    expect(canRemoteSetPin({ iotThingName: "scanner-W08-002", deviceOwner: undefined })).toBe(false);
    expect(canRemoteSetPin({ iotThingName: "", deviceOwner: true })).toBe(false);
    expect(remotePinBlockReason({ iotThingName: "scanner-W08-002", deviceOwner: false })).toBe(
      REMOTE_PIN_UNAVAILABLE,
    );
    expect(remotePinBlockReason({ iotThingName: "scanner-W08-906", deviceOwner: true })).toBeNull();
    expect(remotePinBlockReason({ iotThingName: "", deviceOwner: false })).toBe(REMOTE_PIN_UNAVAILABLE);
  });

  it("treats a created job as queued, not as the device PIN", () => {
    expect(PIN_QUEUED_MESSAGE).toMatch(/waiting for the scanner/i);
    expect(PIN_QUEUED_MESSAGE).not.toMatch(/updated/i);
  });
});

describe("ageLabel", () => {
  it("speaks in years, not days", () => {
    const start = Date.UTC(2024, 0, 1);
    const twoYears = Date.UTC(2026, 0, 1);
    expect(ageLabel(start, twoYears)).toBe("2 yr");
    expect(ageLabel(start, twoYears)).not.toMatch(/day/);
  });
});
