import { describe, it, expect } from "vitest";
import { isWeakPin, isValidManagedPin, pinRejectReason } from "./pin";

describe("isWeakPin", () => {
  it("rejects repeating digits", () => {
    expect(isWeakPin("111111")).toBe(true);
    expect(isWeakPin("000000")).toBe(true);
  });

  it("rejects sequential runs, including wraparound", () => {
    expect(isWeakPin("123456")).toBe(true);
    expect(isWeakPin("654321")).toBe(true);
    expect(isWeakPin("890123")).toBe(true);
  });

  it("allows ordinary PINs", () => {
    expect(isWeakPin("258019")).toBe(false);
    expect(isWeakPin("482917")).toBe(false);
  });
});

describe("isValidManagedPin", () => {
  it("requires exactly 6 digits and a non-guessable value", () => {
    expect(isValidManagedPin("482917")).toBe(true);
    expect(isValidManagedPin("1234")).toBe(false);
    expect(isValidManagedPin("123456")).toBe(false);
    expect(isValidManagedPin("abcdef")).toBe(false);
  });
});

describe("pinRejectReason", () => {
  it("explains length vs guessable", () => {
    expect(pinRejectReason("12")).toMatch(/6 digits/);
    expect(pinRejectReason("111111")).toMatch(/guess/);
    expect(pinRejectReason("482917")).toBeNull();
  });
});
