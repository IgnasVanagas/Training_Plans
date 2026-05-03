import { describe, expect, it } from "vitest";

import { getBuiltInTemplates, isBuiltInTemplate } from "./workoutTemplates";

describe("workoutTemplates", () => {
  it("returns a non-empty list of templates with negative ids", () => {
    const templates = getBuiltInTemplates();
    expect(templates.length).toBeGreaterThan(10);
    for (const tpl of templates) {
      expect(tpl.id).toBeLessThan(0);
      expect(tpl.title).toBeTruthy();
      expect(tpl.sport_type).toMatch(/Running|Cycling/);
      expect(Array.isArray(tpl.structure)).toBe(true);
      expect(tpl.structure.length).toBeGreaterThan(0);
    }
  });

  it("returns a stable list across calls", () => {
    const a = getBuiltInTemplates();
    const b = getBuiltInTemplates();
    expect(a.length).toBe(b.length);
    expect(a[0].title).toBe(b[0].title);
  });

  it("identifies built-in templates by negative id", () => {
    const [first] = getBuiltInTemplates();
    expect(isBuiltInTemplate(first)).toBe(true);
    expect(isBuiltInTemplate({ ...first, id: 5 })).toBe(false);
  });

  it("includes both running and cycling sports", () => {
    const templates = getBuiltInTemplates();
    const sports = new Set(templates.map((t) => t.sport_type));
    expect(sports.has("Running")).toBe(true);
    expect(sports.has("Cycling")).toBe(true);
  });
});
