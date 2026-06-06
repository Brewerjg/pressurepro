// Push notifications — Capacitor PushNotifications wrapper.
//
// Why the dynamic import: same pattern as native-init.ts / stripe.ts. The
// @capacitor/push-notifications plugin is in package.json (so types and the
// JS module resolve at install-time) but Rollup is told NOT to bundle it
// statically — that way the web build still produces a working dist/ even
// in environments where `npm install` hasn't yet pulled the dep down, AND
// importing the plugin on the web (which can't satisfy the native bridge)
// is avoided.
//
// Web is a no-op for v1. We deliberately scoped to native push (FCM/APNs)
// for the Tier-2 release — browser push is a different transport (VAPID +
// service worker) and would only be useful for the small number of operators
// who use the PWA on desktop. Tracked as future work.

import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

/**
 * Capacitor's PushNotifications module shape — we don't want to drag the
 * full type surface in at compile time (the dynamic import is type-erased),
 * so this is a structural subset of what we actually call.
 */
interface PushModule {
  PushNotifications: {
    checkPermissions: () => Promise<{ receive: PermissionState }>;
    requestPermissions: () => Promise<{ receive: PermissionState }>;
    register: () => Promise<void>;
    addListener: (
      event: string,
      // deno-lint-ignore no-explicit-any
      cb: (payload: any) => void,
    ) => Promise<{ remove: () => Promise<void> }>;
    removeAllListeners?: () => Promise<void>;
  };
}

type PermissionState = "prompt" | "prompt-with-rationale" | "granted" | "denied";

async function loadPushModule(): Promise<PushModule | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const moduleSpecifier = "@capacitor/push-notifications";
  try {
    return (await import(/* @vite-ignore */ moduleSpecifier)) as PushModule;
  } catch (err) {
    console.warn(
      "[push] @capacitor/push-notifications not available — skipping:",
      err,
    );
    return null;
  }
}

// Module-level guard so we don't double-register listeners on the same
// session. The registration token event fires every time the OS hands us a
// fresh token; we want exactly ONE handler in flight.
let listenerInstalled = false;
let currentUserId: string | null = null;

/**
 * Register the device for push notifications and persist the token to
 * `public.push_tokens` against the signed-in user. Idempotent — calling it
 * twice on the same device for the same user is a no-op past the first
 * registration in a session.
 *
 * No-ops on web (browser push out of scope for v1).
 */
export async function registerPushNotifications(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!userId) return;

  // If the user switched accounts on the same device, blow away the previous
  // listener so the new user-id is captured by the registration handler.
  if (currentUserId && currentUserId !== userId) {
    listenerInstalled = false;
  }
  currentUserId = userId;

  const mod = await loadPushModule();
  if (!mod) return;
  const { PushNotifications } = mod;

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") {
      console.log("[push] permission not granted:", perm.receive);
      return;
    }
  } catch (err) {
    console.warn("[push] permission flow failed:", err);
    return;
  }

  // Wire the registration / error listeners exactly once per session. The
  // registration listener fires AFTER register() with the device token.
  if (!listenerInstalled) {
    listenerInstalled = true;

    try {
      await PushNotifications.addListener(
        "registration",
        async (token: { value: string }) => {
          const tokenValue = token?.value;
          if (!tokenValue || !currentUserId) return;
          const platform =
            Capacitor.getPlatform() === "ios"
              ? "ios"
              : Capacitor.getPlatform() === "android"
                ? "android"
                : "web";
          try {
            // Upsert against the (user_id, token) unique index from
            // 0018_push_tokens.sql — bumps last_seen_at on re-registrations.
            const { error } = await supabase
              .from("push_tokens" as never)
              .upsert(
                {
                  user_id: currentUserId,
                  token: tokenValue,
                  platform,
                  last_seen_at: new Date().toISOString(),
                } as never,
                { onConflict: "user_id,token" },
              );
            if (error) console.warn("[push] token upsert failed:", error);
          } catch (e) {
            console.warn("[push] token upsert threw:", e);
          }
        },
      );
    } catch (err) {
      console.warn("[push] registration listener failed:", err);
    }

    try {
      await PushNotifications.addListener(
        "registrationError",
        (err: unknown) => {
          console.warn("[push] registration error:", err);
        },
      );
    } catch (err) {
      console.warn("[push] registrationError listener failed:", err);
    }
  }

  try {
    await PushNotifications.register();
  } catch (err) {
    console.warn("[push] register() failed:", err);
  }
}

/**
 * Remove a token from `push_tokens` — called on sign-out so the previous
 * user's device doesn't keep receiving notifications under the new
 * (signed-out) state. Safe on web (no-op).
 */
export async function unregisterPushOnDevice(token: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!token) return;
  try {
    const { error } = await supabase
      .from("push_tokens" as never)
      .delete()
      .eq("token", token);
    if (error) console.warn("[push] token delete failed:", error);
  } catch (e) {
    console.warn("[push] token delete threw:", e);
  }
  // Reset the in-session flags so a subsequent sign-in re-registers cleanly.
  currentUserId = null;
  listenerInstalled = false;
}
