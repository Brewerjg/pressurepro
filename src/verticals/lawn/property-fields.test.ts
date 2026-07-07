import { describe, it, expect } from "vitest";
import { lawnPropertyFields } from "@/verticals/lawn/property-fields";

describe("lawnPropertyFields", () => {
  it("has the 5 Lawn-details fields in order", () => {
    expect(lawnPropertyFields.fields.map((f) => f.key)).toEqual([
      "grass_type", "mow_height_in", "pet_safe_only", "irrigation_present", "bag_clippings",
    ]);
  });
  it("grass_type is a datalist with 9 suggestions", () => {
    const f = lawnPropertyFields.fields.find((x) => x.key === "grass_type");
    expect(f?.type).toBe("datalist");
    expect(f?.type === "datalist" && f.suggestions).toHaveLength(9);
  });
  it("mow_height_in is a number with a step and an inch display suffix", () => {
    const f = lawnPropertyFields.fields.find((x) => x.key === "mow_height_in");
    expect(f?.type).toBe("number");
    expect(f?.type === "number" && f.step).toBe("0.1");
    expect(f?.type === "number" && f.displaySuffix).toBe('"');
    expect(f?.type === "number" && f.readLabel).toBe("Mow height");
  });
  it("the three flags are toggles with the right pill tones", () => {
    const tones = Object.fromEntries(
      lawnPropertyFields.fields
        .filter((f) => f.type === "toggle")
        .map((f) => [f.key, f.type === "toggle" ? f.pillTone : ""]),
    );
    expect(tones).toEqual({ pet_safe_only: "green", irrigation_present: "rain", bag_clippings: "bronze" });
  });
  it("carries the section copy", () => {
    expect(lawnPropertyFields.sectionLabel).toBe("Lawn details");
    expect(lawnPropertyFields.emptyStateHint).toBe(
      "No lawn-care flags set. Edit to record grass type, mow height, irrigation, etc.",
    );
  });
});
