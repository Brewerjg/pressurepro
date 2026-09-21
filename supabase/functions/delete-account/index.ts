// delete-account
//
// Self-service account deletion for the signed-in operator — the in-app path
// Google Play's account-deletion policy requires (the web resource is
// /delete-account on each app's site). One POST does, in order:
//
//   1. Cancels every active subscription so the operator is never billed for
//      an account that no longer exists:
//        * source='stripe' rows with a real Stripe subscription id → Stripe
//          `subscriptions.cancel` on the row's environment (legacy web subs).
//        * source='google' rows → RevenueCat v1 "revoke" (the only
//          server-side cancel Google offers through RC): access ends
//          immediately and the current period is REFUNDED. The client UI
//          states this.
//        * source='apple' rows → no server-side cancel exists (Apple owns
//          it); iOS hasn't launched, so this is a warning, never a blocker.
//      A FAILED cancel of an ACTIVE paid sub ABORTS the whole request —
//      deleting the account while the store keeps charging is the one
//      outcome this function must never produce.
//   2. Empties the operator's storage: job-photos/{user_id}/** (paths are
//      user-prefixed by NewPhotoPair). Storage API, not SQL — deleting
//      storage.objects rows would orphan the S3 files.
//   3. Calls public.delete_user_data(user_id) — a service-role-only
//      SECURITY DEFINER function (migration 0036) that wipes every owned row
//      across all tables in ONE transaction and returns per-table counts.
//   4. Best-effort deletes the RevenueCat subscriber (PII cleanup in RC).
//   5. Deletes the auth user via auth.admin.deleteUser.
//
// Auth: user resolved from the JWT via an RLS-scoped client — the caller can
// only ever delete THEMSELVES. Body must carry { confirm: "DELETE" } so a
// stray invoke can't nuke an account.
//
// Secrets: STRIPE_{LIVE,SANDBOX}_API_KEY_{TURFPRO,PRESSUREPRO} (existing) and
// REVENUECAT_SECRET_API_KEY — must be a **V1 secret key** minted in the RC
// dashboard (API v1 rejects v2 sk_ keys with 403 code 7723, and revoke only
// exists on v1). If the key is missing/unusable AND the operator has an
// active Play subscription, we refuse with a "cancel it in the Play Store
// first" error rather than strand a billing relationship.
//
// Shared-core: this project serves BOTH TurfPro and PressurePro. The client
// passes `app` ("turfpro" | "pressurepro") to select the Stripe account, same
// contract as create-checkout-session. Deleting an account deletes the
// operator's data for BOTH apps — the auth user is shared, so "delete my
// account" can only mean all of it (both frontends say so).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { createStripeClient, type AppId, type StripeEnv } from "../_shared/stripe.ts";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";

const RC_API = "https://api.revenuecat.com/v1";

interface SubRow {
  id: string;
  source: "stripe" | "apple" | "google";
  status: string | null;
  environment: string | null;
  stripe_subscription_id: string | null;
  price_id: string | null;
}

// A row that still represents a live billing relationship. "canceled" is the
// terminal state the webhooks write; anything else (active, past_due,
// trialing) we treat as needing a cancel.
const needsCancel = (s: SubRow) => s.status !== "canceled";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.confirm !== "DELETE") {
      return jsonResponse(
        { error: 'Confirmation missing — send { "confirm": "DELETE" }.' },
        { status: 400 },
      );
    }
    const app: AppId = body.app === "pressurepro" ? "pressurepro" : "turfpro";

    // ----- Auth: resolve the caller from their JWT. -----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, { status: 401 });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ----- 1. Cancel subscriptions. -----
    const { data: subs, error: subsErr } = await admin
      .from("subscriptions")
      .select("id, source, status, environment, stripe_subscription_id, price_id")
      .eq("user_id", userId);
    if (subsErr) {
      console.error("delete-account: subscriptions read failed:", subsErr);
      return jsonResponse({ error: "Could not read subscriptions" }, { status: 500 });
    }

    const canceled: string[] = [];
    const warnings: string[] = [];

    for (const sub of (subs ?? []) as SubRow[]) {
      if (!needsCancel(sub)) continue;

      if (sub.source === "stripe" && sub.stripe_subscription_id?.startsWith("sub_")) {
        const env: StripeEnv = sub.environment === "live" ? "live" : "sandbox";
        try {
          const stripe = createStripeClient(env, app);
          await stripe.subscriptions.cancel(sub.stripe_subscription_id);
          canceled.push(`stripe:${sub.stripe_subscription_id}`);
        } catch (e: unknown) {
          const err = e as { code?: string; statusCode?: number; message?: string };
          // Already gone on Stripe's side = fine; anything else must abort.
          if (err?.code === "resource_missing" || err?.statusCode === 404) {
            warnings.push(`stripe sub ${sub.stripe_subscription_id} already absent (${env})`);
          } else {
            console.error("delete-account: Stripe cancel failed:", e);
            return jsonResponse(
              { error: "Could not cancel your subscription. Nothing was deleted — try again or contact support." },
              { status: 502 },
            );
          }
        }
      } else if (sub.source === "google") {
        const rcKey = Deno.env.get("REVENUECAT_SECRET_API_KEY");
        if (!rcKey) {
          console.error("delete-account: REVENUECAT_SECRET_API_KEY unset with an active Play sub.");
          return jsonResponse(
            { error: "Your Google Play subscription could not be cancelled automatically. Cancel it in the Play Store (Payments & subscriptions), then delete your account." },
            { status: 501 },
          );
        }
        // Ask RC which products are actually live for this subscriber, then
        // revoke each active Play one. Revoke = immediate access loss + refund
        // of the current period (Google-only; the sole server-side cancel).
        const subRes = await fetch(`${RC_API}/subscribers/${encodeURIComponent(userId)}`, {
          headers: { Authorization: `Bearer ${rcKey}` },
        });
        if (subRes.status === 401 || subRes.status === 403) {
          // Key rejected — RC's revoke lives on API v1 and REQUIRES a v1
          // secret key; a v2 sk_ key gets 403 code 7723 here. Same operator
          // guidance as a missing key: cancel manually, then delete.
          console.error("delete-account: RC key rejected (need a V1 secret key):", subRes.status, await subRes.text());
          return jsonResponse(
            { error: "Your Google Play subscription could not be cancelled automatically. Cancel it in the Play Store (Payments & subscriptions), then delete your account." },
            { status: 501 },
          );
        }
        if (!subRes.ok) {
          console.error("delete-account: RC subscriber fetch failed:", subRes.status, await subRes.text());
          return jsonResponse(
            { error: "Could not reach the subscription service. Nothing was deleted — try again shortly." },
            { status: 502 },
          );
        }
        const rcSubs: Record<string, { expires_date?: string | null; store?: string }> =
          (await subRes.json())?.subscriber?.subscriptions ?? {};
        const now = Date.now();
        const activePlay = Object.entries(rcSubs).filter(
          ([, s]) =>
            s.store === "play_store" &&
            (!s.expires_date || new Date(s.expires_date).getTime() > now),
        );
        for (const [productId] of activePlay) {
          const rev = await fetch(
            `${RC_API}/subscribers/${encodeURIComponent(userId)}/subscriptions/${encodeURIComponent(productId)}/revoke`,
            { method: "POST", headers: { Authorization: `Bearer ${rcKey}` } },
          );
          if (!rev.ok) {
            console.error("delete-account: RC revoke failed:", productId, rev.status, await rev.text());
            return jsonResponse(
              { error: "Could not cancel your Google Play subscription. Nothing was deleted — cancel it in the Play Store, then try again." },
              { status: 502 },
            );
          }
          canceled.push(`google:${productId}`);
        }
        if (activePlay.length === 0) {
          warnings.push("google sub row present but RC shows no active Play subscription");
        }
      } else if (sub.source === "apple") {
        // Apple offers no server-side cancel. iOS hasn't launched; if a row
        // ever exists, deletion proceeds and the user manages the sub in
        // App Store settings (the UI says so).
        warnings.push("apple subscription must be cancelled in App Store settings");
      }
    }

    // ----- 2. Storage sweep: job-photos/{userId}/{pairId}/*.jpg -----
    // Two-level layout (see NewPhotoPair). Abort on failure — after the DB
    // wipe we'd lose the path records that make cleanup findable.
    try {
      const bucket = admin.storage.from("job-photos");
      const { data: folders, error: listErr } = await bucket.list(userId, { limit: 1000 });
      if (listErr) throw listErr;
      const paths: string[] = [];
      for (const f of folders ?? []) {
        if (f.id) {
          // Plain file directly under the user folder (not the expected
          // layout, but sweep it anyway).
          paths.push(`${userId}/${f.name}`);
          continue;
        }
        const { data: files, error: subErr } = await bucket.list(`${userId}/${f.name}`, { limit: 1000 });
        if (subErr) throw subErr;
        for (const file of files ?? []) paths.push(`${userId}/${f.name}/${file.name}`);
      }
      if (paths.length > 0) {
        const { error: rmErr } = await bucket.remove(paths);
        if (rmErr) throw rmErr;
      }
    } catch (e) {
      console.error("delete-account: storage sweep failed:", e);
      return jsonResponse(
        { error: "Could not delete your photos. Nothing was deleted — try again." },
        { status: 500 },
      );
    }

    // ----- 3. Atomic DB wipe. -----
    const { data: counts, error: wipeErr } = await admin.rpc("delete_user_data", {
      p_user_id: userId,
    });
    if (wipeErr) {
      console.error("delete-account: delete_user_data failed:", wipeErr);
      return jsonResponse(
        { error: "Could not delete your data. Nothing was removed — try again or contact support." },
        { status: 500 },
      );
    }
    console.log("delete-account: wiped rows for", userId, JSON.stringify(counts));

    // ----- 4. Best-effort RC subscriber cleanup (PII in RevenueCat). -----
    const rcKey = Deno.env.get("REVENUECAT_SECRET_API_KEY");
    if (rcKey) {
      try {
        const del = await fetch(`${RC_API}/subscribers/${encodeURIComponent(userId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${rcKey}` },
        });
        if (!del.ok && del.status !== 404) {
          warnings.push(`RevenueCat subscriber delete returned ${del.status}`);
        }
      } catch (e) {
        console.warn("delete-account: RC subscriber delete failed:", e);
        warnings.push("RevenueCat subscriber delete failed");
      }
    }

    // ----- 5. Auth user. Data is already gone; if this one call fails the
    // account is an empty shell — surface a 500 so the client can retry, and
    // the retry path is safe (every step above is idempotent for a bare user).
    const { error: authDelErr } = await admin.auth.admin.deleteUser(userId);
    if (authDelErr) {
      console.error("delete-account: auth deleteUser failed:", authDelErr);
      return jsonResponse(
        { error: "Your data was deleted but the account itself could not be removed. Try again." },
        { status: 500 },
      );
    }

    console.log("delete-account: DONE", userId, "canceled:", canceled, "warnings:", warnings);
    return jsonResponse({ deleted: true, canceled, warnings, counts });
  } catch (e) {
    console.error("delete-account error:", e);
    return jsonResponse({ error: "Server error" }, { status: 500 });
  }
});
