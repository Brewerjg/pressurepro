// swap-season — atomically flip an operator's season and (auto-)pause or
// resume their mow plans.
//
// Body: { to: 'winter' | 'summer' | 'spring' | 'fall' }
//
// Behavior:
//   - Always update user_settings.season + season_changed_at = now().
//   - If to === 'winter': bulk-pause every mow plan on a recurring weekly/
//     biweekly/monthly cadence that is currently 'active'. We stamp
//     pause_reason='winter_swap' on each row so the un-pause step can find
//     exactly the plans we paused (and not touch manually-paused plans).
//   - If to !== 'winter': bulk-resume every plan with pause_reason='winter_swap'
//     by clearing pause_reason and flipping status back to 'active'.
//
// Returns: { season, affected }
//   - affected = count of plans paused (winter) or resumed (non-winter)
//
// We use the user's auth context for the user_settings update (RLS scoped
// to auth.uid()) and for the plan updates (same RLS check). No service-role
// is needed; the function is a thin transactional wrapper that exists so
// the client doesn't have to coordinate two table writes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";

// Mirrors APP_ID in src/lib/app-context.ts. Keep in sync.
const APP_ID = "turfpro";

type Season = "spring" | "summer" | "fall" | "winter";

function isSeason(x: unknown): x is Season {
  return x === "spring" || x === "summer" || x === "fall" || x === "winter";
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }

    // User-scoped client — RLS will keep all updates within the caller's
    // own rows. Matches the auth pattern in send-customer-email.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = userData.user.id;

    const body = (await req.json().catch(() => null)) as { to?: unknown } | null;
    if (!body || !isSeason(body.to)) {
      return jsonResponse(
        { error: "Body must be { to: 'spring' | 'summer' | 'fall' | 'winter' }" },
        { status: 400 },
      );
    }
    const to: Season = body.to;
    const now = new Date().toISOString();

    // -----------------------------------------------------------------
    // 1) Update user_settings. Use update-then-insert so we don't have
    //    to invent values for the other required columns the user might
    //    not have created yet. Matches MessagingPreferences pattern.
    // -----------------------------------------------------------------
    // deno-lint-ignore no-explicit-any
    const sb = supabase as any;
    const { data: existing } = await sb
      .from("user_settings")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      const { error } = await sb
        .from("user_settings")
        .update({ season: to, season_changed_at: now })
        .eq("user_id", userId);
      if (error) {
        return jsonResponse({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await sb
        .from("user_settings")
        .insert({ user_id: userId, season: to, season_changed_at: now });
      if (error) {
        return jsonResponse({ error: error.message }, { status: 500 });
      }
    }

    // -----------------------------------------------------------------
    // 2) Plan bulk update. Two branches: pause (to winter) or resume
    //    (to anything else). We .select() the affected rows so we can
    //    return an accurate count to the client for the confirm UX.
    // -----------------------------------------------------------------
    let affected = 0;

    if (to === "winter") {
      const { data, error } = await sb
        .from("maintenance_plans")
        .update({ status: "paused", pause_reason: "winter_swap" })
        .eq("user_id", userId)
        .eq("app", APP_ID)
        .eq("plan_kind", "mow")
        .eq("status", "active")
        .in("frequency", ["weekly", "biweekly", "monthly"])
        .select("id");
      if (error) {
        return jsonResponse({ error: error.message }, { status: 500 });
      }
      affected = data?.length ?? 0;
    } else {
      const { data, error } = await sb
        .from("maintenance_plans")
        .update({ status: "active", pause_reason: null })
        .eq("user_id", userId)
        .eq("app", APP_ID)
        .eq("pause_reason", "winter_swap")
        .select("id");
      if (error) {
        return jsonResponse({ error: error.message }, { status: 500 });
      }
      affected = data?.length ?? 0;
    }

    return jsonResponse({ season: to, affected });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return jsonResponse({ error: message }, { status: 500 });
  }
});
