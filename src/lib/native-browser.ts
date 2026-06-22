// TurfPro — native external-URL routing.
//
// Inside a Capacitor WebView the browser primitives behave differently
// from a normal web tab, so we need two distinct strategies:
//
//   - openExternal(url)      — hand the URL OFF to the device's default
//     app/browser, OUTSIDE the WebView. Used for maps, tel:, mailto:, and
//     other deep external links where we want the OS to pick the right
//     registered handler (and where the user is NOT expected to return to
//     a specific in-app flow). On native this is `@capacitor/app`'s
//     `App.openUrl`, falling back to `@capacitor/browser`'s `Browser.open`.
//
//   - openInAppBrowser(url)  — open the URL in an in-app browser tab that
//     overlays the app, so the user returns to TurfPro when they're done.
//     Used for Stripe Checkout / Connect onboarding / billing portal,
//     where the operator MUST come back to the app afterward. On native
//     this is `@capacitor/browser`'s `Browser.open`.
//
// On web, browser tabs and full-page redirects are the right primitives,
// so each helper degrades to the appropriate `window.*` call.
//
// IMPLEMENTATION NOTE — `@capacitor/app` and `@capacitor/browser` are
// loaded via DYNAMIC imports with VARIABLE specifiers + `@vite-ignore`
// so Rollup does not try to resolve them at build time. The web bundle
// builds cleanly even before `npm install` has pulled the plugins down.
// Pattern matches src/lib/native-init.ts (loadKeyboard) and
// src/lib/stripe.ts (getStripe). The dynamically-loaded modules are
// typed loosely (`any`) to keep their types out of the build graph.

import { Capacitor } from "@capacitor/core";

/**
 * Open a URL in the device's DEFAULT app/browser, OUTSIDE the WebView.
 *
 * For maps, tel:, mailto:, and other deep external links where the OS
 * should pick the registered handler and the user is not expected to
 * return to a specific in-app flow.
 *
 *   - Native: `@capacitor/app`'s `App.openUrl({ url })`. If that throws
 *     (plugin missing, no native impl, unhandled scheme) we fall back to
 *     `@capacitor/browser`'s `Browser.open({ url })` so the button is
 *     never dead.
 *   - Web: `window.open(url, "_blank", "noopener")`.
 */
export async function openExternal(url: string): Promise<void> {
  if (!url) return;

  if (Capacitor.isNativePlatform()) {
    const appSpecifier = "@capacitor/app";
    try {
      const mod: any = await import(/* @vite-ignore */ appSpecifier);
      await mod.App.openUrl({ url });
      return;
    } catch (err) {
      console.warn(
        "[native-browser] App.openUrl failed, falling back to Browser.open:",
        err,
      );
    }

    const browserSpecifier = "@capacitor/browser";
    try {
      const mod: any = await import(/* @vite-ignore */ browserSpecifier);
      await mod.Browser.open({ url });
      return;
    } catch (err) {
      console.warn("[native-browser] Browser.open fallback failed:", err);
      return;
    }
  }

  // Web path.
  try {
    window.open(url, "_blank", "noopener");
  } catch (err) {
    console.warn("[native-browser] window.open failed:", err);
  }
}

/**
 * Open a URL in an in-app browser tab that overlays the app and returns
 * the user to TurfPro afterward.
 *
 * For Stripe Checkout / Connect onboarding / billing portal, where the
 * operator must come back to the app once the hosted flow completes.
 *
 *   - Native: `@capacitor/browser`'s `Browser.open({ url })`.
 *   - Web: `window.location.assign(url)` — a full-page redirect is the
 *     correct behavior on web (the hosted page redirects back to us).
 */
export async function openInAppBrowser(url: string): Promise<void> {
  if (!url) return;

  if (Capacitor.isNativePlatform()) {
    const browserSpecifier = "@capacitor/browser";
    try {
      const mod: any = await import(/* @vite-ignore */ browserSpecifier);
      await mod.Browser.open({ url });
      return;
    } catch (err) {
      console.warn("[native-browser] Browser.open failed:", err);
      return;
    }
  }

  // Web path — full-page redirect to the hosted flow.
  try {
    window.location.assign(url);
  } catch (err) {
    console.warn("[native-browser] window.location.assign failed:", err);
  }
}
