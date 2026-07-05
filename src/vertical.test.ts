import { describe, it, expect } from "vitest";
import { vertical } from "@/vertical";
import { VERTICALS } from "@/verticals/registry";

describe("vertical selection", () => {
  it("defaults to the lawn vertical (id turfpro) when VITE_VERTICAL is unset", () => {
    expect(vertical.id).toBe("turfpro");
  });
  it("every registered vertical has a valid id and brand", () => {
    for (const [slug, v] of Object.entries(VERTICALS)) {
      expect(typeof slug).toBe("string");
      expect(["turfpro", "pressurepro"]).toContain(v.id);
      expect(v.brand.name.length).toBeGreaterThan(0);
      expect(v.brand.bundleId.length).toBeGreaterThan(0);
    }
  });
});
