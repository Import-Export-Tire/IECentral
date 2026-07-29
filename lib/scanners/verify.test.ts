import { describe, it, expect } from "vitest";
import {
  parseDeviceOwner,
  parseActiveRestrictions,
  parsePasswordSufficient,
  compareVersion,
  buildChecks,
  allHardChecksPassed,
  type Check,
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

// Realistic provisioning failure: ownership never transferred to us — another admin
// is the actual Device Owner, and our package only shows up as an *enrolled admin* in
// the section that follows. Because "Enabled Device Admins (User 0, provisioningState:
// 2):" contains parentheses, the old terminator regex `(?=\n\s*\w[\w ]*:|\n*$)` cannot
// match it, so the "Device Owner:" section over-extends into this block and a bare
// `.includes(pkg)` finds our package where it must not.
const DUMP_OWNER_IS_OTHER = `
Current Device Policy Manager state:
  Device Owner:
    package=com.other.mdm
  Enabled Device Admins (User 0, provisioningState: 2):
    admin=ComponentInfo{com.ietires.scanneragent/com.ietires.scanneragent.DeviceAdminReceiver}
`;

// The owner's package name is a superstring of ours — a loose `.includes` would match
// this even though `com.ietires.scanneragentx` is not `com.ietires.scanneragent`.
const DUMP_OWNER_SUPERSTRING = `
Current Device Policy Manager state:
  Device Owner:
    admin=ComponentInfo{com.ietires.scanneragentx/com.ietires.scanneragentx.DeviceAdminReceiver}
    package=com.ietires.scanneragentx
  Enabled Device Admins (User 0, provisioningState: 2):
    admin=ComponentInfo{com.ietires.scanneragentx/com.ietires.scanneragentx.DeviceAdminReceiver}
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
  it("returns false when another package is the real owner and ours is merely an enrolled admin listed after it (parenthesized header)", () => {
    expect(parseDeviceOwner(DUMP_OWNER_IS_OTHER, "com.ietires.scanneragent")).toBe(false);
  });
  it("returns false when the owner's package name is a superstring of ours", () => {
    expect(parseDeviceOwner(DUMP_OWNER_SUPERSTRING, "com.ietires.scanneragent")).toBe(false);
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

describe("parsePasswordSufficient", () => {
  it("returns true when the dump reports the password as sufficient", () => {
    expect(parsePasswordSufficient("isActivePasswordSufficient=true")).toBe(true);
  });
  it("returns false when the dump reports the password as insufficient", () => {
    expect(parsePasswordSufficient("isActivePasswordSufficient=false")).toBe(false);
  });
  it("returns null when the field is absent from the dump", () => {
    expect(parsePasswordSufficient("some other unrelated dump text")).toBe(null);
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

  it("passes rtConfigMatches when the device file is pretty-printed but content-identical to the compact expected XML", () => {
    const checks = buildChecks({
      ...base,
      expected: { ...base.expected, rtConfigXml: "<RT><DEVICEID>0001</DEVICEID></RT>" },
      observed: {
        ...base.observed,
        rtConfigXml: "<RT>\n  <DEVICEID>0001</DEVICEID>\n</RT>\n",
      },
    });
    expect(checks.find((c) => c.key === "rtConfigMatches")!.status).toBe("pass");
  });

  it("labels an existing-but-empty RT config file distinctly from a missing one", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, rtConfigXml: "" },
    });
    const rt = checks.find((c) => c.key === "rtConfigMatches")!;
    expect(rt.observed).toBe("(file empty)");
    expect(rt.status).toBe("fail");
  });

  it("still labels a genuinely missing RT config file as missing", () => {
    const checks = buildChecks({
      ...base,
      observed: { ...base.observed, rtConfigXml: null },
    });
    const rt = checks.find((c) => c.key === "rtConfigMatches")!;
    expect(rt.observed).toBe("(file missing)");
    expect(rt.status).toBe("fail");
  });

  it("yields allHardChecksPassed === true when a device is correctly configured in every respect except that no app versions were pinned", () => {
    // The exact production scenario: a location's optional "Current Version" fields are blank,
    // so expected.versions are all null and compareVersion returns "warn" for all three
    // hard version checks. Everything else about the device matches intent.
    const checks = buildChecks({
      ...base,
      expected: {
        ...base.expected,
        versions: { tireTrack: null, rtLocator: null, scannerAgent: null },
      },
    });
    const versionChecks = checks.filter((c) => c.key.startsWith("version_"));
    expect(versionChecks).toHaveLength(3);
    for (const c of versionChecks) {
      expect(c.status).toBe("warn");
      expect(c.hard).toBe(true);
    }
    expect(allHardChecksPassed(checks)).toBe(true);
  });
});

describe("allHardChecksPassed", () => {
  it("returns true when a hard check has status warn", () => {
    const checks: Check[] = [
      { key: "a", label: "A", status: "warn", hard: true },
    ];
    expect(allHardChecksPassed(checks)).toBe(true);
  });

  it("returns true when a hard check has status unverified", () => {
    const checks: Check[] = [
      { key: "a", label: "A", status: "unverified", hard: true },
    ];
    expect(allHardChecksPassed(checks)).toBe(true);
  });

  it("returns false when a hard check has status fail", () => {
    const checks: Check[] = [
      { key: "a", label: "A", status: "fail", hard: true },
    ];
    expect(allHardChecksPassed(checks)).toBe(false);
  });

  it("returns true when a non-hard check has status fail", () => {
    const checks: Check[] = [
      { key: "a", label: "A", status: "fail", hard: false },
    ];
    expect(allHardChecksPassed(checks)).toBe(true);
  });
});
