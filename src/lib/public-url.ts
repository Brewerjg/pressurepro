// public-url.ts
//
// Resolve the canonical PUBLIC web origin for customer-facing links — the
// invoice page (/invoice/:token) and the quote-accept page (/accept/:id).
//
// WHY THIS EXISTS
//   These links are opened by the operator's CUSTOMER in a normal phone
//   browser (from an SMS/email), not inside our app. So they must point at the
//   deployed web app.
//
//   On the WEB build, `window.location.origin` IS already the deployed origin,
//   so we use it directly. Inside the native Capacitor app, however, the
//   WebView origin is "https://localhost" (capacitor.config androidScheme:
//   "https") — a URL nobody but the app itself can open. Sending a customer a
//   "https://localhost/invoice/…" link is the bug this module fixes. In the
//   native build we instead use the build-time `VITE_PUBLIC_APP_ORIGIN`.

import { Capacitor } from "@capacitor/core";

// Trim any trailing slash so callers can safely do `${origin}/invoice/...`.
const CONFIGURED = (
  import.meta.env.VITE_PUBLIC_APP_ORIGIN as string | undefined
)?.replace(/\/+$/, "");

/**
 * The origin to use when building a link a CUSTOMER will open.
 *
 * - Native (Capacitor): the configured public origin. Falls back to
 *   window.location.origin only if VITE_PUBLIC_APP_ORIGIN is unset (and warns,
 *   because that fallback is "https://localhost" and will not work).
 * - Web: window.location.origin (already the deployed origin).
 */
export function publicAppOrigin(): string {
  if (Capacitor.isNativePlatform()) {
    if (CONFIGURED) return CONFIGURED;
    console.warn(
      "[public-url] VITE_PUBLIC_APP_ORIGIN is unset — native customer links " +
        "will point at the WebView origin (localhost) and will not open.",
    );
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return CONFIGURED ?? "";
}
