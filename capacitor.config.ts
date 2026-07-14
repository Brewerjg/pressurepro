import type { CapacitorConfig } from "@capacitor/cli";

// PressurePro — Capacitor bridge config.
//
// `webDir` points at Vite's build output. `npx cap sync` after `npm run
// build` copies dist/ into the native projects before each native build.
// NOTE: native projects are not generated yet in this repo (the fork removed
// turf's android/ios identities) — run `npx cap add android` / `npx cap add
// ios` when the native effort starts.
//
// `server.androidScheme: 'https'` matches Apple's WKWebView default so deep
// links work the same on both platforms.

const config: CapacitorConfig = {
  appId: "com.pressurepro.app",
  appName: "PressurePro",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  ios: {
    contentInset: "always",
    scheme: "PressurePro",
  },
  android: {
    backgroundColor: "#11203F",
  },
  plugins: {
    Camera: {
      // Front-and-center camera is the common path (before/after photo pair,
      // damage doc). Saved to the Photos gallery so operators can
      // sanity-check after a long day.
      saveToGallery: true,
    },
    Geolocation: {
      // Only used for the "where am I" hint on the active stop. We never
      // request background location — privacy + battery.
    },
    Preferences: {
      // Offline cache namespace — keeps PressurePro's storage separate from
      // any other Capacitor app on device.
      group: "PressureProPrefs",
    },
  },
};

export default config;
