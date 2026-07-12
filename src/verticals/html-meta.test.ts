import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { VERTICALS } from "@/verticals/registry";
import { HTML_META } from "./html-meta";

// Build-time HTML metadata (title/description/theme-color) — consumed by
// vite.config's transformIndexHtml so the pressure deploy stops showing a
// "TurfPro" browser-tab title (1f follow-up). Keyed by registry slug.

describe("HTML_META", () => {
  it("covers every registered vertical slug", () => {
    for (const slug of Object.keys(VERTICALS)) {
      expect(HTML_META[slug], `missing HTML_META for "${slug}"`).toBeDefined();
      expect(HTML_META[slug].title.length).toBeGreaterThan(0);
      expect(HTML_META[slug].description.length).toBeGreaterThan(0);
      expect(HTML_META[slug].themeColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("lawn keeps the current index.html values (byte-identical build)", () => {
    expect(HTML_META.lawn).toEqual({
      title: "TurfPro",
      description:
        "TurfPro — routes, plans, and recurring lawn-care ops for mowing crews.",
      themeColor: "#1a4a2e",
    });
  });

  it("pressure is PressurePro-branded", () => {
    expect(HTML_META.pressure.title).toBe("PressurePro");
    expect(HTML_META.pressure.themeColor).toBe("#11203F");
  });
});
