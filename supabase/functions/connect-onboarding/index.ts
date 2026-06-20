// connect-onboarding
//
// Two-op endpoint that drives Stripe Connect Express onboarding for an
// individual TurfPro operator. The operator (the contractor running their
// own lawn-care business) connects their own Stripe account ONCE, then all
// downstream customer-facing charges (plan billing, quote deposits,
// per-visit charges) flow into THEIR bank account while TurfPro takes an
// `application_fee_amount` — see src/lib/stripe.ts feeForTier() for the
// percentage by plan tier. Stripe Connect Express keeps KYC + payouts off
// our backs: Stripe hosts the entire onboarding form.
//
// Operations (dispatched by ?op=... query param OR `action` JSON body):
//
//   create_account_link
//     Mints (or reuses) the operator's Express Connected Account and
//     returns an AccountLink URL. The browser must redirect to it; Stripe
//     hosts the KYC form. AccountLinks expire in ~5 minutes — the wizard
//     mints a fresh one on every mount when ?connect=return is absent so
//     stale links from prior sessions don't strand the operator.
//
//     Returns: { url: string, account_id: string }
//
//   refresh_status
//     Re-fetches the Express account and reports whether it's fully
//     onboarded. Called from the wizard's Step 5 after Stripe bounces the
//     operator back to /onboarding?connect=return. When ready we flip
//     profiles.connect_ready = true + connect_completed_at = now() so
//     downstream Stripe code can trust a single boolean.
//
//     Returns: { ready: boolean, requirements: object }
//
// Auth: user-scoped Supabase client (RLS-aware) so the operator can only
// touch their own profiles row. We resolve the user from the JWT and never
// trust caller-supplied user ids.
//
// Dev env flag:
//   STRIPE_CONNECT_ENABLED  (default: "true")
//     Set to "false" to disable the whole flow for local dev where the
//     Stripe Connect platform hasn't been provisioned. The function will
//     return a 503 with a clear error so the wizard can render a
//     "coming soon" state without bombing out the user.
//
// iOS / App Store note:
//   Stripe-processed payments for PHYSICAL services (lawn care, snow
//   removal, etc.) are explicitly EXEMPT from Apple's IAP 30% rule. We
//   are free to use Stripe Connect inside the iOS Capacitor build. See
//   App Store Review Guideline 3.1.5(a) — physical goods + services
//   delivered outside the app are excluded from the IAP requirement.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import {
  createStripeClient,
  getStripeEnvFromUrl,
  type AppId,
  type StripeEnv,
} from "../_shared/stripe.ts";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";

const APP_ID: AppId = "turfpro";

type Op = "create_account_link" | "refresh_status";

function getOp(req: Request, body: Record<string, unknown>): Op | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("op");
  const fromBody = typeof body.action === "string" ? body.action : undefined;
  const candidate = (fromQuery ?? fromBody) as string | null;
  if (candidate === "create_account_link" || candidate === "refresh_status") {
    return candidate;
  }
  return null;
}

function connectEnabled(): boolean {
  // Default ON. Only "false" / "0" / "no" disables.
  const raw = (Deno.env.get("STRIPE_CONNECT_ENABLED") ?? "true").toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  if (!connectEnabled()) {
    return jsonResponse(
      { error: "Stripe Connect is disabled in this environment" },
      { status: 503 },
    );
  }

  try {
    const env: StripeEnv = getStripeEnvFromUrl(req);
    const stripe = createStripeClient(env, APP_ID);

    // ----- Auth: resolve user from JWT (RLS-scoped client) -----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      "";
    // User-scoped client — RLS applies. We pin Authorization so the JWT is
    // forwarded on every PostgREST call; the operator can only touch their
    // own profile row.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? undefined;

    const body = await req.json().catch(() => ({}));
    const op = getOp(req, body as Record<string, unknown>);
    if (!op) {
      return jsonResponse(
        { error: "Unknown op (expected create_account_link or refresh_status)" },
        { status: 400 },
      );
    }

    // Read the operator's profile (id column maps to auth.uid()). We use
    // user_id as the canonical match key because the profiles table carries
    // both id + user_id from the PressurePro/TurfPro merged schema.
    const { data: profile, error: profileErr } = await userClient
      .from("profiles")
      .select("id, user_id, stripe_account_id, connect_ready")
      .or(`id.eq.${userId},user_id.eq.${userId}`)
      .maybeSingle();
    if (profileErr) {
      console.error("profile lookup failed", profileErr);
      return jsonResponse(
        { error: "Could not load profile" },
        { status: 500 },
      );
    }
    if (!profile) {
      return jsonResponse(
        { error: "Profile not found — finish Step 1 of onboarding first" },
        { status: 404 },
      );
    }

    // -------------------------------------------------------------------
    // OP: create_account_link
    // -------------------------------------------------------------------
    if (op === "create_account_link") {
      let accountId = profile.stripe_account_id as string | null;

      // Mint a brand-new Express account if the operator doesn't have one.
      // Type "express" → Stripe hosts the full onboarding UI; we only need
      // to provide the AccountLink redirect.
      if (!accountId) {
        const created = await stripe.accounts.create({
          type: "express",
          email: userEmail,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_type: "individual",
          metadata: {
            user_id: userId,
            kind: "turfpro_operator",
            environment: env,
          },
        });
        accountId = created.id;

        // Persist via the user-scoped client so RLS validates the write.
        // Update by both candidate match columns to cover both legacy
        // profile-row shapes (id vs user_id), same as the wizard does.
        const patch = { stripe_account_id: accountId } as const;
        const { error: byId } = await userClient
          .from("profiles")
          .update(patch)
          .eq("id", userId)
          .select()
          .maybeSingle();
        if (byId) {
          await userClient
            .from("profiles")
            .update(patch)
            .eq("user_id", userId);
        }
      }

      // Mint the hosted onboarding AccountLink. Expires in ~5 minutes per
      // Stripe; the wizard mints a fresh one on every mount when the
      // operator is starting/resuming, never reusing a stale URL.
      const origin = req.headers.get("origin") || "https://example.com";
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        return_url: `${origin}/onboarding?connect=return`,
        refresh_url: `${origin}/onboarding?connect=refresh`,
      });

      return jsonResponse({ url: link.url, account_id: accountId });
    }

    // -------------------------------------------------------------------
    // OP: refresh_status
    // -------------------------------------------------------------------
    if (op === "refresh_status") {
      const accountId = profile.stripe_account_id as string | null;
      if (!accountId) {
        // No account on file — the operator hasn't even started.
        return jsonResponse({ ready: false, requirements: {} });
      }

      const account = await stripe.accounts.retrieve(accountId);
      const ready = Boolean(
        account.details_submitted && account.charges_enabled,
      );
      const requirements = (account.requirements ?? {}) as Record<
        string,
        unknown
      >;

      // Only persist the success transition. We never flip connect_ready
      // back to false here — if Stripe later finds a new requirement
      // (e.g. updated tax form) we surface it in the requirements payload
      // but leave the boolean alone so the operator's existing charges
      // keep settling. The fee-retrofit agent's webhook handler is the
      // place that downgrades long-term.
      if (ready && !profile.connect_ready) {
        const patch = {
          connect_ready: true,
          connect_completed_at: new Date().toISOString(),
        } as const;
        const { data: byId } = await userClient
          .from("profiles")
          .update(patch)
          .eq("id", userId)
          .select()
          .maybeSingle();
        if (!byId) {
          await userClient
            .from("profiles")
            .update(patch)
            .eq("user_id", userId);
        }
      }

      return jsonResponse({ ready, requirements });
    }

    return jsonResponse({ error: "Unhandled op" }, { status: 400 });
  } catch (e) {
    console.error("connect-onboarding error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
});
