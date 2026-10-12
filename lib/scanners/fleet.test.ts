import { describe, it, expect } from "vitest";
import { pinRejectReason } from "./pin";
import {
  assignRejectReason,
  addScannerRejectReason,
  ageLabel,
  buildAddScannerDoc,
  canAssignUnit,
  canEditAnywhere,
  canMutateScannerFleet,
  fleetStateLabel,
  fleetStatus,
  editorKeyForEmail,
  editorKeyForUserId,
  editorsFromUser,
  homeSiteForUser,
  matchPersonnelByName,
  canRemoteSetPin,
  mdmPinFailureMessage,
  PIN_QUEUED_MESSAGE,
  MDM_PIN_NOT_READY,
  REMOTE_PIN_UNAVAILABLE,
  remotePinBlockReason,
  resolveEditorIds,
  setPinClientReject,
  warehouseFromLocationName,
} from "./fleet";

const TRAVIS = "user_travis";
const MARK = "user_mark";
const BILL = "user_bill";
const ETHAN = "user_ethan";
const ADMIN = "user_admin";
const OTHER = "user_other";

const editors = {
  travis: TRAVIS,
  mark: MARK,
  bill: BILL,
  ethan: ETHAN,
};

describe("resolveEditorIds", () => {
  it("maps login emails to user ids, not display names", () => {
    const ids = resolveEditorIds([
      { _id: TRAVIS, email: "travis@ietires.com" },
      { _id: "imposter", email: "not-travis@example.com" },
      { _id: MARK, email: "Mark@ietires.com" },
      { _id: BILL, email: "Williampriceiii@gmail.com" },
      { _id: ETHAN, email: "ethan@ietires.com" },
    ]);
    expect(ids).toEqual(editors);
    expect(editorKeyForEmail("Travis Erwin")).toBeNull();
    expect(editorKeyForUserId(TRAVIS, ids)).toBe("travis");
    expect(editorKeyForUserId("imposter", ids)).toBeNull();
  });

  it("maps the logged-in user by email, not a display name", () => {
    expect(editorsFromUser({ _id: TRAVIS, email: "travis@ietires.com" })).toEqual({ travis: TRAVIS });
    expect(editorsFromUser({ _id: ETHAN, email: "emon.myers13@gmail.com" })).toEqual({ ethan: ETHAN });
    expect(editorsFromUser({ _id: "imposter", email: "travis.erwin@example.com" })).toEqual({});
    expect(editorsFromUser({ _id: TRAVIS, email: "Travis Erwin" })).toEqual({});
  });
});

describe("matchPersonnelByName", () => {
  it("prefers a person at that warehouse, then any matching name", () => {
    const people = [
      { _id: "p1", firstName: "Chris", lastName: "Hale", locationId: "loc_everson" },
      { _id: "p2", firstName: "Chris", lastName: "Hale", locationId: "loc_latrobe" },
    ];
    expect(matchPersonnelByName(people, "Chris Hale", "loc_latrobe")).toBe("p2");
    expect(matchPersonnelByName(people, "Pat Nguyen", "loc_latrobe")).toBeNull();
  });
});

describe("homeSiteForUser", () => {
  it("sends Travis to Latrobe, Mark/Ethan to Everson, Bill to Chestnut", () => {
    expect(homeSiteForUser(TRAVIS, "warehouse_manager", editors)).toBe("W08");
    expect(homeSiteForUser(MARK, "warehouse_director", editors)).toBe("R10");
    expect(homeSiteForUser(ETHAN, "warehouse_director", editors)).toBe("R10");
    expect(homeSiteForUser(BILL, "warehouse_manager", editors)).toBe("W09");
    expect(homeSiteForUser(ADMIN, "admin", editors)).toBe("all");
    expect(homeSiteForUser(OTHER, "warehouse_manager", editors)).toBe("all");
  });
});

describe("canMutateScannerFleet", () => {
  it("lets Travis, Mark, Chestnut Bill, and admins edit any warehouse", () => {
    for (const site of ["W08", "R10", "W09"] as const) {
      expect(canMutateScannerFleet({ userId: TRAVIS, role: "warehouse_manager", editors, site }).ok).toBe(true);
      expect(canMutateScannerFleet({ userId: MARK, role: "warehouse_director", editors, site }).ok).toBe(true);
      expect(canMutateScannerFleet({ userId: BILL, role: "warehouse_manager", editors, site }).ok).toBe(true);
      expect(canMutateScannerFleet({ userId: ADMIN, role: "admin", editors, site }).ok).toBe(true);
      expect(canMutateScannerFleet({ userId: ADMIN, role: "super_admin", editors, site }).ok).toBe(true);
    }
  });

  it("lets Ethan edit Everson only", () => {
    expect(canMutateScannerFleet({ userId: ETHAN, role: "warehouse_director", editors, site: "R10" }).ok).toBe(true);
    const latrobe = canMutateScannerFleet({ userId: ETHAN, role: "warehouse_director", editors, site: "W08" });
    expect(latrobe.ok).toBe(false);
    const chestnut = canMutateScannerFleet({ userId: ETHAN, role: "warehouse_director", editors, site: "W09" });
    expect(chestnut.ok).toBe(false);
  });

  it("keeps everyone else read-only, including other warehouse managers", () => {
    expect(
      canMutateScannerFleet({ userId: OTHER, role: "warehouse_manager", editors, site: "W08" }).ok,
    ).toBe(false);
    expect(
      canMutateScannerFleet({ userId: OTHER, role: "employee", editors, site: "W08" }).ok,
    ).toBe(false);
    expect(canEditAnywhere(OTHER, "warehouse_manager", editors)).toBe(false);
  });

  it("does not allow mutations on All warehouses", () => {
    expect(canMutateScannerFleet({ userId: TRAVIS, role: "warehouse_manager", editors, site: "all" }).ok).toBe(false);
    expect(canMutateScannerFleet({ userId: ADMIN, role: "admin", editors, site: "all" }).ok).toBe(false);
    expect(canMutateScannerFleet({ userId: ETHAN, role: "warehouse_director", editors, site: "all" }).ok).toBe(false);
  });
});

describe("assign", () => {
  it("allows assign only when Unassigned", () => {
    expect(canAssignUnit("available")).toBe(true);
    expect(canAssignUnit("unassigned")).toBe(true);
    expect(canAssignUnit("maintenance")).toBe(true);
    expect(canAssignUnit("assigned")).toBe(false);
    expect(fleetStatus("maintenance")).toBe("unassigned");
    expect(fleetStateLabel("unassigned")).toBe("Unassigned");
    expect(assignRejectReason({ status: "assigned", name: "Chris Hale" })).toMatch(/Unassigned/);
    expect(assignRejectReason({ status: "available", name: "" })).toMatch(/name/);
    expect(assignRejectReason({ status: "available", name: "Chris Hale" })).toBeNull();
  });
});

describe("add scanner", () => {
  it("creates a row with no PIN, including on an empty fleet", () => {
    expect(addScannerRejectReason({ number: "W08-001", existingNumbers: [] })).toBeNull();
    const doc = buildAddScannerDoc({
      number: "w08-001",
      locationId: "loc_latrobe",
      now: 1,
      pin: "482917",
    });
    expect(doc.number).toBe("W08-001");
    expect(doc.status).toBe("available");
    expect(doc.pin).toBeUndefined();
    expect("pin" in doc && doc.pin).toBeFalsy();
  });

  it("rejects a duplicate WO at that warehouse", () => {
    expect(addScannerRejectReason({ number: "W08-001", existingNumbers: ["W08-001"] })).toMatch(/already/);
    expect(addScannerRejectReason({ number: "", existingNumbers: [] })).toMatch(/WO number/);
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
    expect(remotePinBlockReason({ iotThingName: "", deviceOwner: false })).toMatch(/not enrolled/);
  });

  it("treats a created job as queued, not as the device PIN", () => {
    expect(PIN_QUEUED_MESSAGE).toMatch(/waiting for the scanner/i);
    expect(PIN_QUEUED_MESSAGE).not.toMatch(/updated/i);
  });
});

describe("warehouseFromLocationName", () => {
  it("maps location names, not Convex ids", () => {
    expect(warehouseFromLocationName("Latrobe")).toBe("W08");
    expect(warehouseFromLocationName("Everson")).toBe("R10");
    expect(warehouseFromLocationName("Chestnut Ridge")).toBe("W09");
    expect(warehouseFromLocationName("Chestnut")).toBe("W09");
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
