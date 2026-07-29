// lib/scanners/verify.ts
// The scanner verification pass: what "correctly set up" means, expressed as a check list.
//
// Pure functions only — every input is already-captured device output. The same check list
// runs from the wizard over ADB and (later) from the agent reporting remotely, so a scanner
// is judged by identical rules either way.
//
// `hard: true` blocks the wizard from reaching Done. `warn`/`unverified` never block.

export type CheckStatus = "pass" | "fail" | "warn" | "unverified";

export type Check = {
  key: string;
  label: string;
  expected?: string;
  observed?: string;
  status: CheckStatus;
  hard: boolean;
};

export type AppKey = "tireTrack" | "rtLocator" | "scannerAgent";

export type VerifyInput = {
  expected: {
    versions: Record<AppKey, string | null>;
    rtConfigXml: string;
    screenOffTimeoutMs: number;
    accelerometerRotation: number;
    signerDigests: Record<string, string | null>;
    sha256Present: Record<AppKey, boolean>;
  };
  observed: {
    versions: Record<AppKey, string | null>;
    rtConfigXml: string | null;
    screenOffTimeoutMs: string | null;
    accelerometerRotation: string | null;
    devicePolicyDump: string;
    signerDigests: Record<string, string | null>;
    dataWedgeScanTestConfirmed: boolean;
  };
};

const AGENT_PKG = "com.ietires.scanneragent";

const APP_LABELS: Record<AppKey, string> = {
  tireTrack: "TireTrack",
  rtLocator: "RT Locator",
  scannerAgent: "Scanner Agent",
};

/** True when `pkg` is the active Device Owner, per `dumpsys device_policy`. */
export function parseDeviceOwner(dump: string, pkg: string): boolean {
  const section = dump.match(/Device Owner:[\s\S]*?(?=\n\s*\w[\w ]*:|\n*$)/);
  if (!section) return false;
  return section[0].includes(pkg);
}

/** Restriction names from the `User restrictions:` block. */
export function parseActiveRestrictions(dump: string): string[] {
  const section = dump.match(/User restrictions:\s*\n([\s\S]*?)(?=\n\s*[A-Z][\w ]*:|\n*$)/);
  if (!section) return [];
  return section[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^no_[a-z_]+$/.test(l));
}

/** Whether the current lock password satisfies policy; null when the dump says nothing. */
export function parsePasswordSufficient(dump: string): boolean | null {
  const m = dump.match(/isActivePasswordSufficient=(true|false)/);
  return m ? m[1] === "true" : null;
}

export function compareVersion(
  expected: string | null,
  observed: string | null,
): CheckStatus {
  if (!expected) return "warn"; // nothing pinned — cannot judge
  if (!observed) return "fail"; // package absent
  return expected === observed ? "pass" : "fail";
}

/** Collapse whitespace so a trailing newline from `cat` is not a mismatch. */
function normalizeXml(xml: string): string {
  return xml.replace(/\s+/g, " ").trim();
}

export function buildChecks(input: VerifyInput): Check[] {
  const { expected, observed } = input;
  const checks: Check[] = [];

  // --- installed app versions ---
  for (const app of Object.keys(APP_LABELS) as AppKey[]) {
    checks.push({
      key: `version_${app}`,
      label: `${APP_LABELS[app]} version`,
      expected: expected.versions[app] ?? "(not pinned)",
      observed: observed.versions[app] ?? "(not installed)",
      status: compareVersion(expected.versions[app], observed.versions[app]),
      hard: true,
    });
  }

  // --- signer digests: only judged for apps where an expected digest is known ---
  for (const [pkg, expectedDigest] of Object.entries(expected.signerDigests)) {
    if (!expectedDigest) continue;
    const observedDigest = observed.signerDigests[pkg] ?? null;
    checks.push({
      key: `signer_${pkg}`,
      label: `${pkg} signer`,
      expected: expectedDigest,
      observed: observedDigest ?? "(unknown)",
      status: observedDigest === expectedDigest ? "pass" : "fail",
      hard: true,
    });
  }

  // --- integrity of what we installed ---
  const missingChecksums = (Object.keys(APP_LABELS) as AppKey[]).filter(
    (a) => !expected.sha256Present[a],
  );
  checks.push({
    key: "sha256Verified",
    label: "APK checksums verified",
    expected: "all 3",
    observed: missingChecksums.length
      ? `missing for: ${missingChecksums.map((a) => APP_LABELS[a]).join(", ")}`
      : "all 3",
    // A missing checksum means no integrity check happened. Visible, but not a reason to
    // reject a device that is otherwise correct.
    status: missingChecksums.length ? "warn" : "pass",
    hard: false,
  });

  // --- RT config actually on the device ---
  checks.push({
    key: "rtConfigMatches",
    label: "RT config on device matches intent",
    expected: normalizeXml(expected.rtConfigXml),
    observed: observed.rtConfigXml ? normalizeXml(observed.rtConfigXml) : "(file missing)",
    status:
      observed.rtConfigXml && normalizeXml(observed.rtConfigXml) === normalizeXml(expected.rtConfigXml)
        ? "pass"
        : "fail",
    hard: true,
  });

  // --- device settings ---
  checks.push({
    key: "screenTimeout",
    label: "Screen timeout",
    expected: String(expected.screenOffTimeoutMs),
    observed: observed.screenOffTimeoutMs ?? "(unset)",
    status: observed.screenOffTimeoutMs === String(expected.screenOffTimeoutMs) ? "pass" : "fail",
    hard: true,
  });

  checks.push({
    key: "screenRotation",
    label: "Auto-rotate",
    expected: String(expected.accelerometerRotation),
    observed: observed.accelerometerRotation ?? "(unset)",
    status:
      observed.accelerometerRotation === String(expected.accelerometerRotation) ? "pass" : "fail",
    hard: true,
  });

  // --- management state ---
  checks.push({
    key: "deviceOwner",
    label: "Device Owner",
    expected: AGENT_PKG,
    observed: parseDeviceOwner(observed.devicePolicyDump, AGENT_PKG)
      ? AGENT_PKG
      : "(not device owner)",
    status: parseDeviceOwner(observed.devicePolicyDump, AGENT_PKG) ? "pass" : "fail",
    hard: true,
  });

  // --- the one check that cannot be automated ---
  checks.push({
    key: "dataWedgeScanTest",
    label: "DataWedge scan emits Tab (manual test)",
    expected: "technician confirms a scan advances the field",
    observed: observed.dataWedgeScanTestConfirmed ? "confirmed" : "not yet confirmed",
    // DataWedge's SET_CONFIG result is not readable over ADB and the wizard cannot emit a
    // barcode, so this is recorded honestly as unverified rather than assumed to have worked.
    status: observed.dataWedgeScanTestConfirmed ? "pass" : "unverified",
    hard: false,
  });

  return checks;
}

export function allHardChecksPassed(checks: Check[]): boolean {
  return checks.every((c) => !c.hard || c.status === "pass");
}
