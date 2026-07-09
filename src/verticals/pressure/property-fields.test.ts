import { describe, it, expect } from "vitest";
import { pressurePropertyFields } from "./property-fields";

describe("pressurePropertyFields", () => {
  it("exposes a single surface_notes textarea field", () => {
    expect(pressurePropertyFields.fields).toHaveLength(1);
    const f = pressurePropertyFields.fields[0];
    expect(f.key).toBe("surface_notes");
    expect(f.type).toBe("textarea");
  });
  it("labels the Site details section", () => {
    expect(pressurePropertyFields.sectionLabel).toBe("Site details");
    expect(pressurePropertyFields.emptyStateHint.length).toBeGreaterThan(0);
  });
});
