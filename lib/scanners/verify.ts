// lib/scanners/verify.ts
// The scanner verification pass: what "correctly set up" means, expressed as a check list.
//
// Pure functions only — every input is already-captured device output. The same check list
// runs from the wizard over ADB and (later) from the agent reporting remotely, so a scanner
// is judged by identical rules either way.
//
// `hard: true` blocks the wizard from reaching Done, but only when a check's status is
// `fail`. `warn` and `unverified` are recorded and surfaced same as any other status, but
// they never block — regardless of the `hard` flag. "Nothing to compare against" (warn) and
// "cannot be checked automatically" (unverified) are not the same claim as "checked and
// wrong" (fail), and only the latter should stop a scanner from being handed out.

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
    // False = this location does not use RT Locator at all. When false, the RT config
    // check and the RT Locator version check are reported as skipped-by-configuration
    // rather than failed — RT Locator was deliberately never installed or configured.
    usesRtLocator: boolean;
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
  const lines = dump.split(/\r\n|\r|\n/);
  const headerIndex = lines.findIndex((l) => /Device Owner:/.test(l));
  if (headerIndex === -1) return false;

  const headerLine = lines[headerIndex];
  const headerIndent = /^[ \t]*/.exec(headerLine)![0].length;

  // Anything on the header line itself, after "Device Owner:", belongs to the section too.
  const trailing = headerLine.slice(headerLine.indexOf("Device Owner:") + "Device Owner:".length);
  const sectionLines: string[] = trailing.trim() ? [trailing] : [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // blank lines don't end the section
    const indent = /^[ \t]*/.exec(line)![0].length;
    if (indent <= headerIndent) break;
    sectionLines.push(line);
  }

  const section = sectionLines.join("\n");
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownerPattern = new RegExp(
    `(?:package=${escaped}\\s*$)|(?:admin=ComponentInfo\\{${escaped}/)`,
    "m",
  );
  return ownerPattern.test(section);
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

/**
 * A "pinned" expected version must be a real dotted version number (e.g. "2.0.1"),
 * never a sentinel. Sources upstream (fetch_apk.py's expo branch, a typed config
 * field, a stale default) can hand back "unknown", "latest", "", or garbage — any of
 * those flowing into `compareVersion` as `expected` produces a confident but false
 * comparison (`compareVersion("latest", "2.0.1")` → "fail" on a hard check), which is
 * worse than having no expectation at all ("warn"). Anything that isn't a plain
 * `\d+(\.\d+)+` string is normalized to null ("not pinned") here, once, so every
 * caller judges the same way.
 */
export function normalizePinnedVersion(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return /^\d+(\.\d+)+$/.test(trimmed) ? trimmed : null;
}

/** Collapse whitespace so a trailing newline from `cat` — or pretty-printing — is not a mismatch. */
function normalizeXml(xml: string): string {
  return xml
    .trim()
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><");
}

export function buildChecks(input: VerifyInput): Check[] {
  const { expected, observed } = input;
  const checks: Check[] = [];

  // --- installed app versions ---
  for (const app of Object.keys(APP_LABELS) as AppKey[]) {
    if (app === "rtLocator" && !expected.usesRtLocator) {
      // This location does not use RT Locator — it was deliberately never installed, so
      // "not installed" is not a failure here. Reported honestly as unverified (skipped by
      // configuration), never as a pass, and never hard.
      checks.push({
        key: `version_${app}`,
        label: `${APP_LABELS[app]} version`,
        expected: "(not used at this location)",
        observed: observed.versions[app] ?? "(not installed)",
        status: "unverified",
        hard: false,
      });
      continue;
    }
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
  // RT Locator is excluded from consideration entirely when this location doesn't use it —
  // there is no APK to have a checksum for, so it must never surface as "missing" here. Same
  // "not applicable, not missing" rule the version and rtConfig checks below already apply.
  const missingChecksums = (Object.keys(APP_LABELS) as AppKey[]).filter(
    (a) => (a !== "rtLocator" || expected.usesRtLocator) && !expected.sha256Present[a],
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
  if (!expected.usesRtLocator) {
    // This location does not use RT Locator at all — the wizard skips both the install
    // and the rtlconfig.xml write, so there is nothing to compare. Recorded as unverified
    // (skipped by configuration), never as a pass — a skipped check must never read as a
    // check that ran and succeeded — and never hard, so it cannot block a W09-style device.
    checks.push({
      key: "rtConfigMatches",
      label: "RT config on device matches intent",
      expected: "(RT Locator not used at this location)",
      observed: "skipped — usesRtLocator is false",
      status: "unverified",
      hard: false,
    });
  } else {
    checks.push({
      key: "rtConfigMatches",
      label: "RT config on device matches intent",
      expected: normalizeXml(expected.rtConfigXml),
      observed:
        observed.rtConfigXml === null
          ? "(file missing)"
          : observed.rtConfigXml === ""
            ? "(file empty)"
            : normalizeXml(observed.rtConfigXml),
      status:
        observed.rtConfigXml && normalizeXml(observed.rtConfigXml) === normalizeXml(expected.rtConfigXml)
          ? "pass"
          : "fail",
      hard: true,
    });
  }

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
  return checks.every((c) => !c.hard || c.status !== "fail");
}
