// TurfPro — native Maps hand-off helper.
//
// On web, `window.open(url, '_blank')` opens a new tab and is fine.
//
// Inside a Capacitor WebView, `_blank` opens an in-app browser — which is
// the wrong UX for *navigation* URLs. Operators want the actual Maps app
// (Apple Maps on iOS, Google Maps / default nav app on Android) so they
// can use voice directions, CarPlay/Android Auto, lane guidance, etc.
//
// Calling `App.openUrl({ url })` on native asks the OS to hand the URL
// off via its normal URL-handler resolution. iOS will route a
// `https://www.google.com/maps/...` link to Google Maps (if installed)
// or Safari, and `maps.apple.com` to Apple Maps. Android routes
// `geo:` / Google Maps URLs to the user's default nav app.
//
// IMPLEMENTATION NOTE — `@capacitor/app` is loaded via a dynamic import
// with a variable specifier so Rollup does not try to resolve the
// dependency statically at build time. The web bundle therefore builds
// cleanly even before `npm install` has pulled the plugin down.

import { Capacitor } from "@capacitor/core";

/**
 * Open a URL using the most native-feeling handoff:
 *
 *   - On native (iOS/Android): defer to the OS via `@capacitor/app`'s
 *     `App.openUrl`, which lets the platform pick the right registered
 *     handler (Maps, browser, etc.).
 *   - On web: `window.open(url, '_blank', 'noopener,noreferrer')`.
 *
 * If the dynamic `@capacitor/app` import fails on native for any reason
 * (plugin not installed, missing native impl), we fall back to
 * `window.open` so the user is never left with a dead button.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;

  if (Capacitor.isNativePlatform()) {
    // Variable specifier + @vite-ignore: Rollup will not try to resolve
    // this at build time. See lib/stripe.ts for the same pattern.
    const moduleSpecifier = "@capacitor/app";
    try {
      const mod: any = await import(/* @vite-ignore */ moduleSpecifier);
      await mod.App.openUrl({ url });
      return;
    } catch (err) {
      console.warn(
        "[native-maps] App.openUrl failed, falling back to window.open:",
        err,
      );
    }
  }

  // Web path (and native fallback).
  window.open(url, "_blank", "noopener,noreferrer");
}
