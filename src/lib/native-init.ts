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

// Fire and forget. We deliberately do NOT block app startup on these
// — if a plugin fails to load or a setting fails to apply, the rest
// of the app should still mount.
if (Capacitor.isNativePlatform()) {
  void configureKeyboard();
  void installAuthDeepLinkListener();
}
