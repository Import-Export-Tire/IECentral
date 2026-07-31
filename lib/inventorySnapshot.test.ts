import { describe, it, expect } from "vitest";
import { isCountableTire, NON_TIRE_PRODUCT_TYPES } from "./inventorySnapshot";

// Real W09 rows, copied from the live cache on 2026-07-31.
const tire = (productType: string, itemId: string, qtyOnHand: number) => ({
  productType,
  itemId,
  qtyOnHand,
});

describe("isCountableTire", () => {
  it("excludes productType 'T' — every such row is a placeholder, not a tire", () => {
    // These five hold 4,968,000 of W09's 5,001,320 "units".
    expect(isCountableTire(tire("T", "TIRE", 990000))).toBe(false);
    expect(isCountableTire(tire("T", "TIRE/U", 999000))).toBe(false);
    expect(isCountableTire(tire("T", "LTADJ", 990000))).toBe(false);
    expect(isCountableTire(tire("T", "STH", 999000))).toBe(false);
    expect(isCountableTire(tire("T", "NGT", 990000))).toBe(false);
    expect(isCountableTire(tire("T", "TED", 0))).toBe(false);
    expect(isCountableTire(tire("T", "TEST23", 0))).toBe(false);
  });

  it("excludes productType 'T *' — studding parts and labour", () => {
    expect(isCountableTire(tire("T *", "STUD12", 0))).toBe(false);
    expect(isCountableTire(tire("T *", "STUD15", 3))).toBe(false);
  });

  it("keeps passenger, light-truck, medium-truck and trailer tires", () => {
    expect(isCountableTire(tire("TP", "AYAEP044.", 990))).toBe(true); // 185/65R14
    expect(isCountableTire(tire("TL", "LXST2031660020", 78))).toBe(true); // LT225/75R16
    expect(isCountableTire(tire("TM", "RBP1063481256", 82))).toBe(true); // 11R22.5
    expect(isCountableTire(tire("TST", "ST17580R13", 11))).toBe(true); // ST175/80R13
  });

  it("keeps starred tire classes", () => {
    expect(isCountableTire(tire("TP*", "DU266016616[", 1872))).toBe(true);
    expect(isCountableTire(tire("TL*", "SOMEWINTER", 4))).toBe(true);
  });

  it("keeps an unknown-but-tire-looking class rather than dropping inventory", () => {
    // Blocklist, not allowlist: a new JMK tire class must not silently vanish.
    expect(isCountableTire(tire("TB", "SOMEBUSTIRE", 12))).toBe(true);
  });

  it("is case- and whitespace-insensitive on productType", () => {
    expect(isCountableTire(tire("  t  ", "TIRE", 990000))).toBe(false);
    expect(isCountableTire(tire(" tp ", "AYAEP044.", 12))).toBe(true);
  });

  it("excludes anything at or above the qty threshold as a backstop", () => {
    // Catches a placeholder that arrives under a new productType.
    expect(isCountableTire(tire("TP", "NEWPLACEHOLDER", 100000))).toBe(false);
  });

  it("excludes the known placeholder itemIds even under a tire productType", () => {
    // Third layer, in case JMK reclassifies a placeholder.
    expect(isCountableTire(tire("TP", "STH", 5))).toBe(false);
    expect(isCountableTire(tire("TP", "TEST'TS'ITEM-", 5))).toBe(false);
  });

  it("does not treat a substring as a placeholder itemId", () => {
    // 'TIRE' is a placeholder id; 'TIREX123' is a real part number.
    expect(isCountableTire(tire("TP", "TIREX123", 40))).toBe(true);
  });

  it("excludes a row with no productType at all rather than guessing", () => {
    expect(isCountableTire({ itemId: "MYSTERY", qtyOnHand: 5 })).toBe(false);
  });

  it("lists exactly the two non-tire codes", () => {
    expect([...NON_TIRE_PRODUCT_TYPES].sort()).toEqual(["T", "T *"]);
  });
});
