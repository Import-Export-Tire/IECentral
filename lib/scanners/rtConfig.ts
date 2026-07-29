// lib/scanners/rtConfig.ts
// Single source of truth for RT Locator config (rtlconfig.xml).
//
// Why this module exists: rtlconfig.xml used to be generated in four places with three
// different DEVICEID semantics, and it is written twice per setup run — once by the wizard
// over ADB, once by the agent at claim time. Whichever wrote last won, so the DEVICEID that
// landed on a device depended on whether a location template happened to exist.
//
// DEVICEID is CONSTANT PER LOCATION, never per scanner. Every scanner at a store must carry
// the same value. Templates are never trusted for DEVICEID or RTLMOBILEURL — those are always
// substituted from the location config — so all writers produce identical bytes.
//
// Pure: no React, no Convex, no I/O. Safe to import from the browser, Convex, and Node.

export type RtConfigInput = {
  locationCode: string;
  rtLocatorUrl: string;
  rtDeviceId: string;
  /** Optional per-location template from scannerMdmConfigs.rtConfigXml. */
  template?: string;
};

export type RtConfigValues = {
  orientation: string;
  deviceId: string;
  scaleFactor: string;
  rtLocatorUrl: string;
};

export type RtConfigResult = {
  xml: string;
  values: RtConfigValues;
  /** Non-empty means DO NOT WRITE THIS CONFIG. Callers must treat it as a hard failure. */
  problems: string[];
};

const REQUIRED_TAGS = ["ORIENTATION", "DEVICEID", "SCALEFACTOR", "RTLMOBILEURL"] as const;

const DEFAULT_ORIENTATION = "PORTRAIT";
const DEFAULT_SCALE_FACTOR = "3.5";

/**
 * Escape text for use inside an XML text node. Order matters: `&` must be escaped first,
 * or the `&` produced by escaping `<`/`>` would itself get re-escaped into `&amp;lt;` etc.
 */
function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The canonical default shape, with location-owned values already escaped and trimmed. */
function buildDefaultXml(deviceId: string, rtLocatorUrl: string): string {
  return `<RT>
    <ORIENTATION>${DEFAULT_ORIENTATION}</ORIENTATION>
    <DEVICEID>${escapeXml(deviceId)}</DEVICEID>
    <SCALEFACTOR>${DEFAULT_SCALE_FACTOR}</SCALEFACTOR>
    <RTLMOBILEURL>${escapeXml(rtLocatorUrl)}</RTLMOBILEURL>
</RT>`;
}

/** Read a single tag's text. Returns null when the tag is absent. */
function readTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : null;
}

/** How many times a tag opens in the document. Used to detect duplicates. */
function countTag(xml: string, tag: string): number {
  const m = xml.match(new RegExp(`<${tag}>`, "g"));
  return m ? m.length : 0;
}

/**
 * Replace every occurrence of a tag's text, or append the tag before </RT> when it is
 * absent. Global (`g` flag): a template with a duplicate required tag is rejected via
 * `problems` (see the duplicate-tag check in buildRtConfig), but we still substitute every
 * occurrence here as defense in depth, so a stale conflicting copy of a location-owned
 * field (DEVICEID, RTLMOBILEURL) can never reach the output even if a caller ignored
 * `problems`.
 */
function writeTag(xml: string, tag: string, value: string): string {
  const re = new RegExp(`<${tag}>[^<]*</${tag}>`, "g");
  if (re.test(xml)) return xml.replace(re, `<${tag}>${value}</${tag}>`);
  return xml.replace("</RT>", `    <${tag}>${value}</${tag}>\n</RT>`);
}

/**
 * A deliberately narrow well-formedness check: every <TAG> has a matching </TAG>, the
 * document is wrapped in <RT>…</RT>, and there is exactly one root. A real XML parser is
 * unavailable in every runtime this module targets, and RT configs are a fixed flat shape,
 * so this is sufficient and honest about what it checks.
 */
function isWellFormed(xml: string): boolean {
  if (!/^\s*<RT>[\s\S]*<\/RT>\s*$/.test(xml)) return false;
  // Real XML permits exactly one root element. Two concatenated <RT>…</RT> blocks would
  // otherwise sail through the stack check below (each block balances on its own), and the
  // whole second block — with its own stale DEVICEID/RTLMOBILEURL — would survive into the
  // output. That is precisely the "which value wins" ambiguity this module exists to kill,
  // so reject multi-root templates here rather than relying on the generic tag matcher.
  if (countTag(xml, "RT") !== 1 || countTag(xml, "/RT") !== 1) return false;
  // Match tags by proper nesting (a stack), not by flat position — an outer tag's
  // opening comes first but its closing comes last, so index-aligned comparison of
  // "all opens" vs "all closes" is wrong for any nested shape (which <RT>…</RT> always is).
  const tagPattern = /<(\/?)([A-Z]+)>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) !== null) {
    const [, isClosing, tag] = match;
    if (isClosing) {
      if (stack.pop() !== tag) return false;
    } else {
      stack.push(tag);
    }
  }
  return stack.length === 0;
}

export function buildRtConfig(input: RtConfigInput): RtConfigResult {
  const problems: string[] = [];
  const { locationCode, rtLocatorUrl, rtDeviceId, template } = input;

  // --- validate the inputs the location config owns ---
  if (!rtLocatorUrl.trim()) {
    problems.push(`rtLocatorUrl is empty — set it in Scanner Settings for ${locationCode}`);
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(rtLocatorUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      problems.push(`rtLocatorUrl "${rtLocatorUrl}" is not a valid http(s) URL`);
    }
  }

  if (!rtDeviceId.trim()) {
    problems.push(`rtDeviceId is empty — set it in Scanner Settings for ${locationCode}`);
  } else if (/^[A-Z]\d{2}-\d+$/.test(rtDeviceId.trim())) {
    // Guards the historical bug: convex/scannerMdm.ts used to write scanner.number here.
    problems.push(
      `rtDeviceId "${rtDeviceId}" looks like a scanner number — DEVICEID is constant per location, not per scanner`,
    );
  }

  // Substitution always uses the trimmed, location-owned values — never the raw input.
  // Validation above checks `.trim()`ed values too, so a config that validates clean must
  // also *emit* clean: trimming only at validation time (and splicing the raw string into
  // the XML) is how two writers that trim differently would produce different bytes for
  // the same location.
  const deviceId = rtDeviceId.trim();
  const locatorUrl = rtLocatorUrl.trim();

  // --- start from the template when present, else the canonical default ---
  let xml = template && template.trim() ? template.trim() : buildDefaultXml(deviceId, locatorUrl);

  if (!isWellFormed(xml)) {
    problems.push(`rtConfigXml for ${locationCode} is not well-formed XML`);
    // Fall back to the default shape so callers always get a usable `values` object.
    xml = buildDefaultXml(deviceId, locatorUrl);
  } else if (template && template.trim()) {
    for (const tag of REQUIRED_TAGS) {
      const count = countTag(xml, tag);
      if (count === 0) {
        problems.push(`rtConfigXml for ${locationCode} is missing required tag <${tag}>`);
      } else if (count > 1) {
        // A duplicate required tag is exactly the "which value wins" ambiguity this module
        // exists to eliminate — reject it. writeTag below still substitutes every
        // occurrence of DEVICEID/RTLMOBILEURL as defense in depth, so even if a caller
        // ignores `problems`, no stale conflicting copy of those two fields can reach the
        // output.
        problems.push(
          `rtConfigXml for ${locationCode} has ${count} <${tag}> tags — each required tag must appear exactly once`,
        );
      }
    }
  }

  // --- always substitute the location-owned fields; never trust the template's copies ---
  xml = writeTag(xml, "DEVICEID", escapeXml(deviceId));
  xml = writeTag(xml, "RTLMOBILEURL", escapeXml(locatorUrl));
  if (readTag(xml, "ORIENTATION") === null) xml = writeTag(xml, "ORIENTATION", DEFAULT_ORIENTATION);
  if (readTag(xml, "SCALEFACTOR") === null) xml = writeTag(xml, "SCALEFACTOR", DEFAULT_SCALE_FACTOR);

  return {
    xml,
    values: {
      orientation: readTag(xml, "ORIENTATION") ?? DEFAULT_ORIENTATION,
      deviceId,
      scaleFactor: readTag(xml, "SCALEFACTOR") ?? DEFAULT_SCALE_FACTOR,
      rtLocatorUrl: locatorUrl,
    },
    problems,
  };
}
