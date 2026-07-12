// Build-time HTML metadata per vertical — title, meta description, and
// theme-color for index.html. Consumed by vite.config.ts's
// transformIndexHtml hook (Node config bundle), so this file must stay
// dependency-free: no React, no lucide, no other vertical modules. Keyed by
// registry slug (VITE_VERTICAL value); html-meta.test.ts enforces coverage.

export const HTML_META: Record<
  string,
  { title: string; description: string; themeColor: string }
> = {
  lawn: {
    title: "TurfPro",
    description:
      "TurfPro — routes, plans, and recurring lawn-care ops for mowing crews.",
    themeColor: "#1a4a2e",
  },
  pressure: {
    title: "PressurePro",
    description:
      "PressurePro — pressure & soft-wash quoting, scheduling, and billing.",
    themeColor: "#11203F",
  },
};
