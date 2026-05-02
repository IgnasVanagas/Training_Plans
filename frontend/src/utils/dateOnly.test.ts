import { describe, expect, it } from "vitest";

import { parseDateOnly, toDateOnlyString } from "./dateOnly";

describe("dateOnly", () => {
  it("returns null for empty values", () => {
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(undefined)).toBeNull();
    expect(parseDateOnly("   ")).toBeNull();
    expect(toDateOnlyString("   ")).toBeNull();
  });

  it("normalizes Date inputs to the local calendar day", () => {
    const result = parseDateOnly(new Date(2026, 4, 9, 15, 30, 0));

    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(4);
    expect(result?.getDate()).toBe(9);
    expect(result?.getHours()).toBe(0);
  });

  it("parses YYYY-MM-DD strings", () => {
    const result = parseDateOnly("2026-05-09");

    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(4);
    expect(result?.getDate()).toBe(9);
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    expect(parseDateOnly("2024-02-31")).toBeNull();
    expect(parseDateOnly("2024-13-01")).toBeNull();
  });

  it("formats supported inputs as date-only strings", () => {
    expect(toDateOnlyString(new Date(2026, 0, 2, 18, 45, 0))).toBe("2026-01-02");
    expect(toDateOnlyString("2026-05-09T15:30:00")).toBe("2026-05-09");
  });
});