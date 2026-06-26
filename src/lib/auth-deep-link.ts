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
import { supabase } from "@/integrations/supabase/client";

let installed = false;

// Pull an OAuth `?code=...` (PKCE) out of the callback URL, if present.
function extractCode(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("code");
  } catch {
    return null;
  }
}

// Pull access/refresh tokens out of the URL hash (implicit/recovery flows
// deliver them as `#access_token=...&refresh_token=...`).
function extractHashTokens(
  url: string,
): { access_token: string; refresh_token: string } | null {
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return null;
  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (access_token && refresh_token) return { access_token, refresh_token };
  return null;
}

export async function installAuthDeepLinkListener(): Promise<void> {
  if (installed) return;
  if (!Capacitor.isNativePlatform()) return;
  installed = true;

  const moduleSpecifier = "@capacitor/app";
  try {
    const mod: any = await import(/* @vite-ignore */ moduleSpecifier);
    await mod.App.addListener("appUrlOpen", async (event: { url: string }) => {
      // Defensive: only react to our own scheme.
      if (!event?.url) return;

      const isAuthCallback =
        event.url.startsWith("turfpro://auth-callback") ||
        // Some OS/email-client combos lowercase the scheme; be lenient.
        event.url.toLowerCase().startsWith("turfpro://auth-callback");

      if (!isAuthCallback) return;

      // Close the system browser (Google OAuth opens it via
      // @capacitor/browser) so the app is in the foreground when we finish.
      try {
        const browserMod: any = await import(
          /* @vite-ignore */ "@capacitor/browser"
        );
        await browserMod.Browser.close();
      } catch {
        // Browser plugin may not be present / nothing open — ignore.
      }

      // --- OAuth (Google) PKCE flow -------------------------------------
      // The callback carries `?code=...`. Exchange it for a session so the
      // native session is established; AuthContext's onAuthStateChange then
      // fires and the app navigates home.
      const code = extractCode(event.url);
      if (code) {
        try {
          // supabase-js accepts the full URL or the bare code; pass the URL
          // so it can also read the PKCE verifier it stored at start.
          const { error } = await supabase.auth.exchangeCodeForSession(
            event.url,
          );
          if (error) {
            console.warn(
              "[auth-deep-link] exchangeCodeForSession failed:",
              error,
            );
          }
        } catch (err) {
          console.warn("[auth-deep-link] exchangeCodeForSession threw:", err);
        }
        return;
      }

      // --- Implicit / recovery token flow -------------------------------
      // Some flows deliver tokens in the URL hash instead of a code.
      // Establish the session directly from them.
      const tokens = extractHashTokens(event.url);
      if (tokens) {
        try {
          const { error } = await supabase.auth.setSession(tokens);
          if (error) {
            console.warn("[auth-deep-link] setSession failed:", error);
          }
        } catch (err) {
          console.warn("[auth-deep-link] setSession threw:", err);
        }
        return;
      }

      // --- Plain confirm flow (sign-up email) ---------------------------
      // No code or tokens to process — Supabase already confirmed the
      // account server-side and onAuthStateChange picks up the session on
      // the next refresh. The OS has foregrounded us already.
      //
      // NOTE: `?type=recovery` (our password-reset deep link) currently has
      // no in-app screen on native — there is no /reset-password equivalent
      // wired into a native route here. The recovery session will still be
      // established (via the hash-token path above when present); a future
      // pass could route the user to an in-app new-password form.
    });
  } catch (err) {
    console.warn(
      "[auth-deep-link] Could not register appUrlOpen listener — @capacitor/app is not available:",
      err,
    );
  }
}
