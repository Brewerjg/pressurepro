import type { CapacitorConfig } from "@capacitor/cli";

// TurfPro — Capacitor bridge config.
//
// `webDir` points at Vite's build output. `npm run cap:sync` (or `npx cap sync`
// after `npm run build`) copies dist/ into the native projects before each
// native build.
//
// `server.cleartext` is intentionally false: Supabase + Stripe are HTTPS-only.
// `server.androidScheme: 'https'` matches Apple's WKWebView default so deep
// links work the same on both platforms.
//
// `appId` uses reverse-DNS. Update to your registered bundle identifier before
// shipping to the App Store / Play Store. The `tech.falcon.*` namespace
// mirrors the PressurePro precedent.

const config: CapacitorConfig = {
  appId: "tech.falcon.turfpro",
  appName: "TurfPro",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  ios: {
    contentInset: "always",
    scheme: "TurfPro",
  },
  android: {
    backgroundColor: "#f5f1e8",
  },
  plugins: {
    Camera: {
      // Operators rarely need the gallery — front-and-center camera is the
      // common path (photo pair before/after, damage doc). Saved to the
      // Photos gallery so they can sanity-check after a long route day.
      saveToGallery: true,
    },
    Geolocation: {
      // Only used for the "where am I" hint on the active route stop. We never
      // request background location — privacy + battery.
    },
    Preferences: {
      // Used for offline cache of today's route. Group keeps TurfPro's storage
      // namespaced separate from any other Capacitor app on device.
      group: "TurfProPrefs",
    },
  },
};

export default config;
