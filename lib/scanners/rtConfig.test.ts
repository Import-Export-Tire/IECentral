import { describe, it, expect } from "vitest";
import { buildRtConfig } from "./rtConfig";

const OK = {
  locationCode: "W08",
  rtLocatorUrl: "https://rtl.example.com/mobile",
  rtDeviceId: "0001",
};

describe("buildRtConfig", () => {
  it("builds a valid config from the default template", () => {
    const r = buildRtConfig(OK);
    expect(r.problems).toEqual([]);
    expect(r.values.deviceId).toBe("0001");
    expect(r.values.rtLocatorUrl).toBe("https://rtl.example.com/mobile");
    expect(r.xml).toContain("<DEVICEID>0001</DEVICEID>");
    expect(r.xml).toContain("<RTLMOBILEURL>https://rtl.example.com/mobile</RTLMOBILEURL>");
  });

  it("substitutes into a supplied template instead of trusting its values", () => {
    const template = `<RT>
    <ORIENTATION>LANDSCAPE</ORIENTATION>
    <DEVICEID>W08-004</DEVICEID>
    <SCALEFACTOR>2.0</SCALEFACTOR>
    <RTLMOBILEURL>https://stale.example.com/old</RTLMOBILEURL>
</RT>`;
    const r = buildRtConfig({ ...OK, template });
    expect(r.problems).toEqual([]);
    // The template's DEVICEID and URL must be overwritten, not passed through.
    expect(r.values.deviceId).toBe("0001");
    expect(r.values.rtLocatorUrl).toBe("https://rtl.example.com/mobile");
    expect(r.xml).not.toContain("W08-004");
    expect(r.xml).not.toContain("stale.example.com");
    // Template-owned fields survive.
    expect(r.values.orientation).toBe("LANDSCAPE");
    expect(r.values.scaleFactor).toBe("2.0");
  });

  it("is deterministic — same input produces identical bytes", () => {
    expect(buildRtConfig(OK).xml).toBe(buildRtConfig(OK).xml);
  });

  it("reports a problem for an empty RT Locator URL", () => {
    const r = buildRtConfig({ ...OK, rtLocatorUrl: "" });
    expect(r.problems).toContain("rtLocatorUrl is empty — set it in Scanner Settings for W08");
  });

  it("reports a problem for a non-http URL", () => {
    const r = buildRtConfig({ ...OK, rtLocatorUrl: "not a url" });
    expect(r.problems.some((p) => p.includes("not a valid http(s) URL"))).toBe(true);
  });

  it("reports a problem for an empty device id", () => {
    const r = buildRtConfig({ ...OK, rtDeviceId: "" });
    expect(r.problems).toContain("rtDeviceId is empty — set it in Scanner Settings for W08");
  });

  it("rejects a per-scanner style device id, which is always a misconfiguration", () => {
    const r = buildRtConfig({ ...OK, rtDeviceId: "W08-004" });
    expect(r.problems.some((p) => p.includes("looks like a scanner number"))).toBe(true);
  });

  it("reports a problem for a malformed template", () => {
    const r = buildRtConfig({ ...OK, template: "<RT><DEVICEID>1</DEVICEID>" });
    expect(r.problems.some((p) => p.includes("not well-formed"))).toBe(true);
  });

  it("reports a problem when the template lacks required tags", () => {
    const r = buildRtConfig({ ...OK, template: "<RT><FOO>bar</FOO></RT>" });
    expect(r.problems.some((p) => p.includes("missing required tag"))).toBe(true);
  });
});
