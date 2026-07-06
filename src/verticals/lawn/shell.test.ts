import { describe, it, expect } from "vitest";
import { lawnRoutes, lawnNavEntries, lawnHomeActions } from "@/verticals/lawn/shell";

describe("lawn shell config", () => {
  it("registers the four lawn routes with the correct guards", () => {
    const byPath = Object.fromEntries(lawnRoutes.map((r) => [r.path, r.guard]));
    expect(byPath).toEqual({
      "/routes": "paid",
      "/routes/run/:routeId": "fullBleed",
      "/calc": "protected",
      "/chem-log": "protected",
    });
    for (const r of lawnRoutes) expect(r.element).toBeTruthy();
  });
  it("has the 5 lawn tab entries, Home first", () => {
    expect(lawnNavEntries).toHaveLength(5);
    expect(lawnNavEntries[0]).toMatchObject({ to: "/", label: "Home", end: true });
    expect(lawnNavEntries.map((n) => n.to)).toEqual([
      "/", "/customers", "/routes", "/plans", "/settings",
    ]);
  });
  it("exposes the calc + chem-log home tiles", () => {
    expect(lawnHomeActions.map((a) => a.to)).toEqual(["/calc", "/chem-log"]);
    for (const a of lawnHomeActions) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.icon).toBeTruthy();
    }
  });
});
