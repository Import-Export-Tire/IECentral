import { describe, it, expect } from "vitest";
import { canAssignScanners, canManageScannerMdm } from "./roles";

describe("canAssignScanners", () => {
  it("allows floor managers and IT", () => {
    expect(canAssignScanners("warehouse_manager")).toBe(true);
    expect(canAssignScanners("warehouse_director")).toBe(true);
    expect(canAssignScanners("admin")).toBe(true);
    expect(canAssignScanners("super_admin")).toBe(true);
  });

  it("denies workers and unrelated roles", () => {
    expect(canAssignScanners("member")).toBe(false);
    expect(canAssignScanners("employee")).toBe(false);
    expect(canAssignScanners("shift_lead")).toBe(false);
    expect(canAssignScanners(undefined)).toBe(false);
  });
});

describe("canManageScannerMdm", () => {
  it("is IT-only", () => {
    expect(canManageScannerMdm("admin")).toBe(true);
    expect(canManageScannerMdm("super_admin")).toBe(true);
    expect(canManageScannerMdm("warehouse_manager")).toBe(false);
    expect(canManageScannerMdm("warehouse_director")).toBe(false);
  });
});
