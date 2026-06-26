// TurfPro — RevenueCat (in-app purchase) client helpers.
//
// Operator SaaS subscriptions ship through the mobile app stores via
// RevenueCat (@revenuecat/purchases-capacitor). On the web these helpers
// all no-op — Stripe Checkout (src/lib/stripe.ts) remains the web path.
//
// As with src/lib/stripe.ts and src/lib/native-init.ts, we load
// @revenuecat/purchases-capacitor through a DYNAMIC import with a VARIABLE
// specifier + a `/* @vite-ignore */` hint so Rollup does not try to resolve
// the dep at build time. The package is in package.json but may not be
// installed yet; the import only fails at runtime (on native) when called.
//
// We type the loaded module loosely (`any`) to avoid pulling the SDK's types
// into the build graph statically. All SDK access stays behind loadPurchases().

import { Capacitor } from "@capacitor/core";
import { openExternal } from "@/lib/native-browser";

// RevenueCat product identifiers — these must match the products configured
// in the RevenueCat dashboard (and the underlying App Store / Play Store
// products). They mirror the Stripe lookup_keys in src/lib/stripe.ts.
//   turfpro_solo_monthly / turfpro_solo_yearly
//   turfpro_crew_monthly / turfpro_crew_yearly
// "Base" (payg) is the free default — no purchase.

const iosKey = import.meta.env.VITE_REVENUECAT_IOS_KEY as string | undefined;
const androidKey = import.meta.env.VITE_REVENUECAT_ANDROID_KEY as string | undefined;

/** Pick the platform-appropriate RevenueCat public SDK key. */
function apiKeyForPlatform(): string | undefined {
  const platform = Capacitor.getPlatform();
  if (platform === "ios") return iosKey;
  if (platform === "android") return androidKey;
  return undefined;
}

/** RevenueCat is usable only on native with a configured key for the platform. */
export function isRevenueCatAvailable(): boolean {
  return Capacitor.isNativePlatform() && !!apiKeyForPlatform();
}

// Dynamic-import the SDK behind a variable specifier so the web build never
// has to resolve it. Returns null on web or if the dep isn't installed.
async function loadPurchases(): Promise<any | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const moduleSpecifier = "@revenuecat/purchases-capacitor";
  try {
    const mod: any = await import(/* @vite-ignore */ moduleSpecifier);
    return mod?.Purchases ?? null;
  } catch (err) {
    console.warn(
      "[iap] @revenuecat/purchases-capacitor not available — run `npm install` to add it:",
      err,
    );
    return null;
  }
}

let configured = false;

/**
 * Configure the RevenueCat SDK for the signed-in operator. Native-only and
 * idempotent — safe to call once per signed-in user from native-init.
 *
 * No-ops on web, or if the platform key is missing (logs a warning so the
 * misconfiguration is visible during native testing).
 */
export async function configureRevenueCat(appUserId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const apiKey = apiKeyForPlatform();
  if (!apiKey) {
    console.warn(
      `[iap] No RevenueCat key for platform "${Capacitor.getPlatform()}" — ` +
        "set VITE_REVENUECAT_IOS_KEY / VITE_REVENUECAT_ANDROID_KEY. Skipping configure.",
    );
    return;
  }

  const Purchases = await loadPurchases();
  if (!Purchases) return;

  try {
    await Purchases.configure({ apiKey, appUserID: appUserId });
    configured = true;
  } catch (err) {
    console.warn("[iap] Purchases.configure failed:", err);
  }
}

// Loosely-typed shapes for the bits of the RevenueCat SDK we touch. We keep
// these minimal so callers get a little structure without importing SDK types.
export type IapPackage = any;

/**
 * Fetch the current offering's available packages. Returns null if RevenueCat
 * isn't available, isn't configured, or there's no current offering.
 */
export async function getOfferings(): Promise<IapPackage[] | null> {
  if (!isRevenueCatAvailable()) return null;

  const Purchases = await loadPurchases();
  if (!Purchases) return null;

  try {
    const result: any = await Purchases.getOfferings();
    const current = result?.current;
    if (!current) return null;
    return (current.availablePackages as IapPackage[]) ?? null;
  } catch (err) {
    console.warn("[iap] getOfferings failed:", err);
    return null;
  }
}

export type PurchaseResult =
  | { status: "success"; customerInfo: any }
  | { status: "cancelled" }
  | { status: "error"; error: unknown };

/**
 * Purchase a RevenueCat package. Distinguishes a user cancellation from a
 * real error so the UI can stay quiet on cancel and surface a message on
 * failure.
 */
export async function purchasePackage(pkg: IapPackage): Promise<PurchaseResult> {
  if (!isRevenueCatAvailable()) {
    return { status: "error", error: new Error("RevenueCat is not available") };
  }

  const Purchases = await loadPurchases();
  if (!Purchases) {
    return { status: "error", error: new Error("RevenueCat SDK not loaded") };
  }

  try {
    const result: any = await Purchases.purchasePackage({ aPackage: pkg });
    return { status: "success", customerInfo: result?.customerInfo };
  } catch (err: any) {
    // RevenueCat surfaces user cancellation via `userCancelled` on the error.
    if (err?.userCancelled === true || err?.code === "1") {
      return { status: "cancelled" };
    }
    console.warn("[iap] purchasePackage failed:", err);
    return { status: "error", error: err };
  }
}

/**
 * Open the store-native subscription-management screen so the operator can
 * cancel, change billing, or request a refund. The app stores own this flow
 * — we never cancel a sub ourselves.
 *
 * Prefers RevenueCat's `Purchases.showManageSubscriptions()` (which routes to
 * the correct platform screen). If the SDK doesn't expose it (older versions),
 * falls back to opening the platform's subscriptions URL externally. No-ops on
 * web (warns) — subscriptions there are managed in the mobile app.
 */
export async function manageSubscriptions(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    console.warn(
      "[iap] manageSubscriptions is native-only — subscriptions are managed in the mobile app.",
    );
    return;
  }

  const Purchases = await loadPurchases();
  if (Purchases && typeof Purchases.showManageSubscriptions === "function") {
    try {
      await Purchases.showManageSubscriptions();
      return;
    } catch (err) {
      console.warn(
        "[iap] showManageSubscriptions failed, falling back to store URL:",
        err,
      );
    }
  }

  // Fallback — open the platform's subscriptions screen in the default app.
  const platform = Capacitor.getPlatform();
  const url =
    platform === "ios"
      ? "https://apps.apple.com/account/subscriptions"
      : "https://play.google.com/store/account/subscriptions";
  await openExternal(url);
}

export type RestoreResult =
  | { status: "success"; customerInfo: any }
  | { status: "error"; error: unknown };

/** Restore previously-purchased subscriptions for the current store account. */
export async function restorePurchases(): Promise<RestoreResult> {
  if (!isRevenueCatAvailable()) {
    return { status: "error", error: new Error("RevenueCat is not available") };
  }

  const Purchases = await loadPurchases();
  if (!Purchases) {
    return { status: "error", error: new Error("RevenueCat SDK not loaded") };
  }

  try {
    const result: any = await Purchases.restorePurchases();
    return { status: "success", customerInfo: result?.customerInfo };
  } catch (err) {
    console.warn("[iap] restorePurchases failed:", err);
    return { status: "error", error: err };
  }
}
