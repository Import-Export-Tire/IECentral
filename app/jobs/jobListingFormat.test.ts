import { describe, it, expect } from "vitest";
import { composeDescription, parseLegacyDescription } from "./jobListingFormat";

describe("composeDescription", () => {
  it("joins summary, responsibilities, and requirements under headings", () => {
    const result = composeDescription({
      summary: "We are hiring.",
      responsibilities: ["Greet visitors", "Answer phones"],
      requirements: ["HS diploma"],
    });
    expect(result).toBe(
      "We are hiring.\n\nWhat You'll Do\n- Greet visitors\n- Answer phones\n\nWhat We're Looking For\n- HS diploma"
    );
  });

  it("omits empty sections and trims", () => {
    expect(
      composeDescription({ summary: "  Hi  ", responsibilities: [], requirements: ["", "  "] })
    ).toBe("Hi");
  });
});

describe("parseLegacyDescription", () => {
  it("splits a run-on description on known headings", () => {
    const legacy =
      "Import Export Tire Company has been trusted since 1972. We'd love to hear from you. " +
      "What You'll Do Greet customers and vendors. " +
      "What We're Looking For High school diploma or equivalent. " +
      "What We Offer Full benefits package.";
    const r = parseLegacyDescription(legacy);
    expect(r.summary.startsWith("Import Export Tire Company")).toBe(true);
    expect(r.summary.includes("What You'll Do")).toBe(false);
    expect(r.responsibilities).toEqual(["Greet customers and vendors."]);
    expect(r.requirements).toEqual(["High school diploma or equivalent."]);
  });

  it("splits multi-line blocks into separate bullets and strips markers", () => {
    const legacy =
      "Intro paragraph.\nWhat You'll Do\n- Greet\n- Answer\nWhat We're Looking For\n- Diploma";
    const r = parseLegacyDescription(legacy);
    expect(r.summary).toBe("Intro paragraph.");
    expect(r.responsibilities).toEqual(["Greet", "Answer"]);
    expect(r.requirements).toEqual(["Diploma"]);
  });

  it("normalizes curly apostrophes in headings", () => {
    const legacy = "Intro. What You'll Do Do stuff. What We're Looking For A degree.";
    const r = parseLegacyDescription(legacy);
    expect(r.summary).toBe("Intro.");
    expect(r.responsibilities).toEqual(["Do stuff."]);
    expect(r.requirements).toEqual(["A degree."]);
  });

  it("returns everything as summary when no headings are present", () => {
    const r = parseLegacyDescription("Just a short blurb.");
    expect(r.summary).toBe("Just a short blurb.");
    expect(r.responsibilities).toEqual([]);
    expect(r.requirements).toEqual([]);
  });
});
