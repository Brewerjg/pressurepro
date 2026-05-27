// drain-sms-queue — pg_cron-invoked drainer for SMS rows held back by the
// send-customer-sms quiet-hours gate.
//
// Background: send-customer-sms writes a row to public.sms_log with
// status='queued' and error='quiet_hours' when an SMS is fired outside
// the operator's user_settings.sms_quiet_* window. Without this drainer
// those rows stay queued forever.
//
// This function runs every 5 minutes from pg_cron (migration 0012). It:
//   1. Refuses any call that isn't from the service role (the cron job
//      authenticates with the project's service-role JWT).
//   2. Selects sms_log rows where status='queued' AND error='quiet_hours'.
//   3. For each row, looks up the parent operator's quiet-hours window
//      from user_settings; if NOW falls inside the window, fires the
//      Twilio call and promotes the row to 'sent' (or 'failed').
//   4. Returns a count summary.
//
// We intentionally do NOT re-invoke send-customer-sms — that function
// requires an authenticated user JWT and would re-apply the quiet-hours
// gate. Instead we re-fire Twilio directly with the original body and
// recipient_phone stored on the sms_log row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders } from "../_shared/cors.ts";

interface SmsLogRow {
  id: string;
  user_id: string;
  recipient_phone: string;
  body: string | null;
  status: string;
  error: string | null;
}

interface QuietHoursPrefs {
  sms_quiet_start_hour: number | null;
  sms_quiet_end_hour: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // -----------------------------------------------------------------
    // 1) Auth gate: SERVICE ROLE ONLY.
    //
    //    pg_cron POSTs with `Authorization: Bearer <service_role_key>`.
    //    We compare the raw token against SUPABASE_SERVICE_ROLE_KEY (a
    //    function secret). Anything else gets 401 — we never want a
    //    customer-facing client invoking the drainer.
    // -----------------------------------------------------------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!serviceKey) {
      return json({ error: "Service role key not configured" }, 503);
    }
    const presented = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (presented !== serviceKey) {
      return json({ error: "Forbidden — service role only" }, 403);
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
    if (!accountSid || !authToken || !fromNumber) {
      // Treat as no-op rather than failure — Twilio not wired yet is a
      // common state and pg_cron shouldn't be alerting on it every 5
      // minutes.
      return json({ ok: true, drained: 0, skipped: 0, reason: "twilio_unconfigured" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey,
    );

    // -----------------------------------------------------------------
    // 2) Pull a bounded slice of queued/quiet_hours rows. Cap at 100 per
    //    run so a backed-up queue can't blow the function timeout.
    //    Older rows first — we want to honor original send order.
    // -----------------------------------------------------------------
    const { data: queued, error: qErr } = await supabase
      .from("sms_log")
      .select("id, user_id, recipient_phone, body, status, error")
      .eq("status", "queued")
      .eq("error", "quiet_hours")
      .order("created_at", { ascending: true })
      .limit(100);
    if (qErr) {
      console.error("drain-sms-queue: select failed:", qErr);
      return json({ error: qErr.message }, 500);
    }

    const rows = (queued ?? []) as SmsLogRow[];
    if (rows.length === 0) {
      return json({ ok: true, drained: 0, skipped: 0 });
    }

    // -----------------------------------------------------------------
    // 3) Look up each unique operator's quiet-hours window once. Keep
    //    a small in-function cache so we don't fan out N user_settings
    //    queries when many rows belong to the same operator.
    // -----------------------------------------------------------------
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const prefsByUser = new Map<string, QuietHoursPrefs>();
    for (const uid of userIds) {
      const { data: prefs } = await supabase
        .from("user_settings")
        .select("sms_quiet_start_hour, sms_quiet_end_hour")
        .eq("user_id", uid)
        .maybeSingle();
      prefsByUser.set(uid, {
        sms_quiet_start_hour:
          (prefs?.sms_quiet_start_hour as number | null) ?? 8,
        sms_quiet_end_hour:
          (prefs?.sms_quiet_end_hour as number | null) ?? 20,
      });
    }

    // -----------------------------------------------------------------
    // 4) Walk rows and fire Twilio for any that are now inside-window.
    //    Mirrors send-customer-sms's Twilio call almost exactly so the
    //    log row promotion shape matches existing 'sent' rows.
    // -----------------------------------------------------------------
    const now = new Date();
    let drained = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      const prefs = prefsByUser.get(row.user_id);
      const start = prefs?.sms_quiet_start_hour ?? 8;
      const end = prefs?.sms_quiet_end_hour ?? 20;

      if (!isWithinQuietHoursWindow(now, start, end)) {
        skipped++;
        continue;
      }
      if (!row.body || !row.recipient_phone) {
        // Defensive — a row with no body is unsendable; mark failed so
        // we don't keep retrying.
        await supabase
          .from("sms_log")
          .update({ status: "failed", error: "missing body or phone" })
          .eq("id", row.id);
        failed++;
        continue;
      }

      try {
        const form = new URLSearchParams();
        form.set("To", row.recipient_phone);
        form.set("From", fromNumber);
        form.set("Body", row.body);

        const basic = btoa(`${accountSid}:${authToken}`);
        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${basic}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
          },
        );
        const twilioBody = (await twilioRes.json().catch(() => null)) as
          | { sid?: string }
          | null;

        if (twilioRes.ok && twilioBody?.sid) {
          await supabase
            .from("sms_log")
            .update({
              status: "sent",
              twilio_message_sid: twilioBody.sid,
              sent_at: new Date().toISOString(),
              error: null, // clear the 'quiet_hours' marker
            })
            .eq("id", row.id);
          drained++;
        } else {
          await supabase
            .from("sms_log")
            .update({
              status: "failed",
              error: `Twilio ${twilioRes.status}: ${JSON.stringify(twilioBody)}`,
            })
            .eq("id", row.id);
          failed++;
        }
      } catch (e) {
        await supabase
          .from("sms_log")
          .update({
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
          })
          .eq("id", row.id);
        failed++;
      }
    }

    return json({
      ok: true,
      drained,
      skipped,
      failed,
      considered: rows.length,
    });
  } catch (e) {
    console.error("drain-sms-queue error:", e);
    return json(
      { error: e instanceof Error ? e.message : "Unknown" },
      500,
    );
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Same logic as send-customer-sms.isWithinQuietHoursWindow. Duplicated
 * here so we don't cross function boundaries.
 *
 * True if `now`'s hour falls within [startHour, endHour). Handles the
 * normal forward window (8..20) and the wrap-around window (22..6) —
 * if start === end, treat as "always closed" (safer default than open).
 */
function isWithinQuietHoursWindow(
  now: Date,
  startHour: number,
  endHour: number,
): boolean {
  const h = now.getHours();
  if (startHour === endHour) return false;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}
