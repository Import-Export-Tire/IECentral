import { describe, it, expect } from "vitest";
import {
  parseDeviceOwner,
  parseActiveRestrictions,
  compareVersion,
  buildChecks,
  allHardChecksPassed,
} from "./verify";

// Captured from a Zebra TC51 (Android 8.1) running agent 1.2.1.
const DUMP_OWNER = `
Current Device Policy Manager state:
  Device Owner:
    admin=ComponentInfo{com.ietires.scanneragent/com.ietires.scanneragent.DeviceAdminReceiver}
    name=
    package=com.ietires.scanneragent
  Enabled Device Admins (User 0, provisioningState: 2):
    admin=ComponentInfo{com.ietires.scanneragent/com.ietires.scanneragent.DeviceAdminReceiver}
    User restrictions:
      no_factory_reset
      no_add_account
`;

const DUMP_NO_OWNER = `
Current Device Policy Manager state:
  Enabled Device Admins (User 0):
    admin=ComponentInfo{com.other.app/com.other.app.Receiver}
`;

describe("parseDeviceOwner", () => {
  it("detects our package as device owner", () => {
    expect(parseDeviceOwner(DUMP_OWNER, "com.ietires.scanneragent")).toBe(true);
  });
  it("returns false when there is no device owner", () => {
    expect(parseDeviceOwner(DUMP_NO_OWNER, "com.ietires.scanneragent")).toBe(false);
  });
  it("does not match a different package that merely appears in the dump", () => {
    expect(parseDeviceOwner(DUMP_NO_OWNER, "com.other.app")).toBe(false);
  });
});

describe("parseActiveRestrictions", () => {
  it("extracts the restriction names", () => {
    expect(parseActiveRestrictions(DUMP_OWNER)).toEqual(["no_factory_reset", "no_add_account"]);
  });
  it("returns an empty array when none are set", () => {
    expect(parseActiveRestrictions(DUMP_NO_OWNER)).toEqual([]);
  });
});

describe("compareVersion", () => {
  it("passes on an exact match", () => {
    expect(compareVersion("2.0.1", "2.0.1")).toBe("pass");
  });
  it("fails on a mismatch", () => {
    expect(compareVersion("2.0.2", "2.0.1")).toBe("fail");
  });
  it("fails when the package is absent", () => {
    expect(compareVersion("2.0.1", null)).toBe("fail");
  });
  it("warns when nothing was pinned to compare against", () => {
    expect(compareVersion(null, "2.0.1")).toBe("warn");
  });
});

describe("buildChecks", () => {
  const base = {
    expected: {
      versions: { tireTrack: "2.0.1", rtLocator: "1.0", scannerAgent: "1.2.1" },
      rtConfigXml: "<RT><DEVICEID>0001</DEVICEID></RT>",
      screenOffTimeoutMs: 1800000,
      accelerometerRotation: 0,
      signerDigests: {} as Record<string, string | null>,
      sha256Present: { tireTrack: true, rtLocator: true, scannerAgent: true },
    },
    observed: {
      versions: { tireTrack: "2.0.1", rtLocator: "1.0", scannerAgent: "1.2.1" },
      rtConfigXml: "<RT><DEVICEID>0001</DEVICEID></RT>",
      screenOffTimeoutMs: "1800000",
      accelerometerRotation: "0",
      devicePolicyDump: DUMP_OWNER,
      signerDigests: {} as Record<string, string | null>,
      dataWedgeScanTestConfirmed: false,
    },
  };

  it("passes every hard check on a correctly configured device", () => {
    const checks = buildChecks(base);
    const failures = checks.filter((c) => c.hard && c.status !== "pass");
    expect(failures).toEqual([]);
    expect(allHardChecksPassed(checks)).toBe(true);
  });

  it("fails hard when the RT config on the device differs from intent", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, rtConfigXml: "<RT><DEVICEID>W08-004</DEVICEID></RT>" },
    });
    const rt = checks.find((c) => c.key === "rtConfigMatches")!;
    expect(rt.status).toBe("fail");
    expect(rt.hard).toBe(true);
    expect(allHardChecksPassed(checks)).toBe(false);
  });

  it("fails hard when the RT config is missing entirely", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, rtConfigXml: null },
    });
    expect(checks.find((c) => c.key === "rtConfigMatches")!.status).toBe("fail");
  });

  it("fails hard when device owner is not our package", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, devicePolicyDump: DUMP_NO_OWNER },
    });
    expect(checks.find((c) => c.key === "deviceOwner")!.status).toBe("fail");
    expect(allHardChecksPassed(checks)).toBe(false);
  });

  it("marks the DataWedge scan test unverified, and does not let it block", () => {
    const checks = buildChecks(base);
    const dw = checks.find((c) => c.key === "dataWedgeScanTest")!;
    expect(dw.status).toBe("unverified");
    expect(dw.hard).toBe(false);
    expect(allHardChecksPassed(checks)).toBe(true);
  });

  it("passes the scan test once a technician confirms it", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, dataWedgeScanTestConfirmed: true },
    });
    expect(checks.find((c) => c.key === "dataWedgeScanTest")!.status).toBe("pass");
  });

  it("warns without blocking when a build had no checksum to verify", () => {
    const checks = buildChecks({
      ...base,
      expected: { ...base.expected, sha256Present: { tireTrack: false, rtLocator: true, scannerAgent: true } },
    });
    const c = checks.find((k) => k.key === "sha256Verified")!;
    expect(c.status).toBe("warn");
    expect(c.hard).toBe(false);
    expect(allHardChecksPassed(checks)).toBe(true);
  });

  it("fails a settings check when the device disagrees with policy", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, screenOffTimeoutMs: "60000" },
    });
    expect(checks.find((c) => c.key === "screenTimeout")!.status).toBe("fail");
  });
});
