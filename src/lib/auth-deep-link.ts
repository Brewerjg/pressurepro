// TurfPro — auth deep-link bridge.
//
// When email-based auth (sign-up confirm, password reset, magic link) is
// triggered from inside the Capacitor app, we pass `emailRedirectTo:
// "turfpro://auth-callback"` to Supabase. The user taps the email link
// on their phone; the OS recognizes the `turfpro://` scheme and hands
// the URL back to the app, foregrounding it.
//
// This module registers a one-time listener for that incoming URL so we
// can react when it arrives. For the basic sign-up confirm flow we
// don't actually need to *do* anything here — Supabase confirms the
// account server-side and the `onAuthStateChange` listener in
// AuthContext already picks up the new session on next refresh. The
// listener exists so:
//
//   1. The app is guaranteed to foreground (Capacitor App plugin does
//      this implicitly when the URL is delivered).
//   2. We have a hook to extend later for flows that *do* carry a
//      payload — magic-link tokens, OAuth `?code=` exchanges, etc.
//      Those would parse the URL hash/query and call
//      `supabase.auth.exchangeCodeForSession` or similar.
//
// ANDROID NOTE — Android does NOT route custom URL schemes the same
// way iOS does. To make `turfpro://auth-callback` actually open the
// app on Android, the Capacitor Android project's `AndroidManifest.xml`
// must declare an `<intent-filter>` on the main activity with
// `<data android:scheme="turfpro" />` and `BROWSABLE`/`DEFAULT`
// categories. Capacitor 6 scaffolds a default activity that does not
// include this filter — it has to be added by hand (or via
// `cap-android-deep-links`-style tooling) before the Android build
// will pick up the deep link.
//
// TODO(native-android-deeplink): add the `<intent-filter>` block to
// android/app/src/main/AndroidManifest.xml. App Links (HTTPS-scoped,
// verified via `assetlinks.json`) would be a more robust long-term
// answer for both platforms, but require hosting the verification
// file under a known domain — out of scope for this pass.
//
// IMPLEMENTATION NOTE — like native-init / native-maps, we load
// `@capacitor/app` via a dynamic variable-specifier import so the
// web build does not require the plugin to be installed.

import { Capacitor } from "@capacitor/core";

let installed = false;

export async function installAuthDeepLinkListener(): Promise<void> {
  if (installed) return;
  if (!Capacitor.isNativePlatform()) return;
  installed = true;

  const moduleSpecifier = "@capacitor/app";
  try {
    const mod: any = await import(/* @vite-ignore */ moduleSpecifier);
    await mod.App.addListener("appUrlOpen", (event: { url: string }) => {
      // Defensive: only react to our own scheme.
      if (!event?.url) return;

      const isAuthCallback =
        event.url.startsWith("turfpro://auth-callback") ||
        // Some OS/email-client combos lowercase the scheme; be lenient.
        event.url.toLowerCase().startsWith("turfpro://auth-callback");

      if (!isAuthCallback) return;

      // No client-side work needed for the basic sign-up confirmation
      // flow — Supabase already updated the user record server-side,
      // and `onAuthStateChange` in AuthContext picks up the session
      // on the next refresh. The OS has already brought us back to
      // the foreground by the time this listener fires.
      //
      // TODO: if we add magic-link or OAuth-code callback flows, parse
      // `event.url` (hash + query) here and call
      // `supabase.auth.exchangeCodeForSession(...)` or
      // `supabase.auth.setSession(...)` as appropriate.
    });
  } catch (err) {
    console.warn(
      "[auth-deep-link] Could not register appUrlOpen listener — @capacitor/app is not available:",
      err,
    );
  }
}
