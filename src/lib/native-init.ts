// TurfPro — one-shot native-plugin bootstrap.
//
// Imported as a side effect from `src/main.tsx`. On web this module
// no-ops (everything is gated on `Capacitor.isNativePlatform()`); on
// iOS / Android it:
//
//   1. Configures the soft keyboard to resize the WebView body so
//      forms aren't covered when the keyboard is open. Adds a
//      `.native-keyboard-open` body class so we can also adjust CSS
//      if needed down the line.
//
//   2. Registers the auth deep-link listener (see auth-deep-link.ts).
//
// The Capacitor plugins (`@capacitor/keyboard`, `@capacitor/app`) are
// loaded via DYNAMIC imports with VARIABLE specifiers so that Rollup
// does not try to resolve them at build time. This lets the web
// bundle build cleanly even when `npm install` hasn't yet pulled
// down the new deps. Pattern matches src/lib/stripe.ts.

import { Capacitor } from "@capacitor/core";
import { installAuthDeepLinkListener } from "./auth-deep-link";
import { registerPushNotifications } from "./push";
import { supabase } from "@/integrations/supabase/client";

async function loadKeyboard(): Promise<any | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const moduleSpecifier = "@capacitor/keyboard";
  try {
    return await import(/* @vite-ignore */ moduleSpecifier);
  } catch (err) {
    console.warn(
      "[native-init] @capacitor/keyboard not available — skipping keyboard setup:",
      err,
    );
    return null;
  }
}

async function configureKeyboard(): Promise<void> {
  const mod = await loadKeyboard();
  if (!mod) return;

  const { Keyboard } = mod;
  if (!Keyboard) return;

  // Resize the WebView's body element when the keyboard is shown so
  // form inputs are not hidden under it. We pass the string 'body'
  // instead of importing the KeyboardResize enum from the same module
  // — the string value is what the plugin actually reads at the
  // bridge layer, and avoids needing a second named binding from a
  // dynamically-loaded module whose types we don't pull in.
  try {
    await Keyboard.setResizeMode({ mode: "body" });
  } catch (err) {
    console.warn("[native-init] Keyboard.setResizeMode failed:", err);
  }

  // Toggle a CSS class on <body> on keyboard show/hide so the rest of
  // the app can adjust layout if it ever needs to. Using willShow/
  // willHide (not didShow/didHide) so the class flips *before* the
  // animation starts, which keeps any reactive layout work smooth.
  try {
    Keyboard.addListener("keyboardWillShow", () => {
      document.body.classList.add("native-keyboard-open");
    });
    Keyboard.addListener("keyboardWillHide", () => {
      document.body.classList.remove("native-keyboard-open");
    });
  } catch (err) {
    console.warn("[native-init] Keyboard listener registration failed:", err);
  }
}

// ---------------------------------------------------------------------
// Push notifications — registered against `public.push_tokens` whenever
// there's an authenticated user. We deliberately listen to
// supabase.auth.onAuthStateChange in here (rather than hooking into
// src/contexts/AuthContext.tsx) so native-init stays self-contained and
// the AuthContext can stay UI-only.
//
// Auth state churn note: onAuthStateChange fires on EVERY state change
// (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED, SIGNED_OUT).
// We only want to register when there's a real new user we haven't yet
// registered for this session, otherwise we'd spam the upsert on every
// token refresh. `registeredForUserId` is a module-level latch:
//   - flip to userId on first observation
//   - skip subsequent events with the same userId
//   - reset to null on SIGNED_OUT so a later sign-in re-registers
// `registerPushNotifications` itself is also internally idempotent
// (push.ts module-level guard) but the early-return here keeps the noise
// down in the common steady-state case.
// ---------------------------------------------------------------------
let registeredForUserId: string | null = null;

async function installPushAuthListener(): Promise<void> {
  // Handle the case where the user is ALREADY signed in by the time we
  // get here (warm app start with a persisted session). onAuthStateChange
  // will also emit an INITIAL_SESSION event that catches this, but doing
  // a one-shot getSession() up front means we don't wait on that event.
  try {
    const { data } = await supabase.auth.getSession();
    const initialUserId = data.session?.user?.id ?? null;
    if (initialUserId && initialUserId !== registeredForUserId) {
      registeredForUserId = initialUserId;
      void registerPushNotifications(initialUserId);
    }
  } catch (err) {
    console.warn("[native-init] initial getSession failed:", err);
  }

  supabase.auth.onAuthStateChange((event, session) => {
    const userId = session?.user?.id ?? null;
    if (event === "SIGNED_OUT" || !userId) {
      registeredForUserId = null;
      return;
    }
    if (userId === registeredForUserId) return;
    registeredForUserId = userId;
    void registerPushNotifications(userId);
  });
}

// Fire and forget. We deliberately do NOT block app startup on these
// — if a plugin fails to load or a setting fails to apply, the rest
// of the app should still mount.
if (Capacitor.isNativePlatform()) {
  void configureKeyboard();
  void installAuthDeepLinkListener();
  void installPushAuthListener();
}
