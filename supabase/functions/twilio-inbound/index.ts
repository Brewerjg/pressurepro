// twilio-inbound — public webhook Twilio POSTs to when a customer replies
// to one of our outbound SMSs. Persists the message into public.sms_inbound
// so the Inbox UI can surface it.
//
// Endpoint shape Twilio uses:
//   POST /functions/v1/twilio-inbound
//   Content-Type: application/x-www-form-urlencoded
//   X-Twilio-Signature: <HMAC-SHA1 base64>
//   Body: From=...&To=...&Body=...&MessageSid=...  (plus a dozen more)
//
// Security: we MUST validate X-Twilio-Signature using TWILIO_AUTH_TOKEN.
// Without it anyone with the URL can POST fake "customer replies" — that
// poisons the inbox and could be used to spam STOPs to opt customers out
// against their will. Reject 403 on signature mismatch.
//
// Response: Twilio expects valid TwiML. An empty <Response/> means "don't
// auto-reply" — exactly what we want, since the operator will respond
// manually from the Inbox UI.
//
// Per-operator Twilio number gap:
//   Today every TurfPro project shares a single TWILIO_FROM_NUMBER env
//   var. Real multi-tenant SMS would assign each operator their own
//   Twilio number and look the operator up by matching `To` against a
//   `user_settings.twilio_phone` column. We don't have that column yet,
//   so v1 falls back to TWILIO_INBOUND_DEFAULT_USER_ID — a single project-
//   wide operator UUID supplied as a function secret. If it's not set we
//   return 503 with a TODO message so the operator sees the gap explicitly
//   the first time someone replies.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

// =====================================================================
// Helpers
// =====================================================================

const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);

function isStopKeyword(body: string): boolean {
  // Twilio normalizes the body to UTF-8 but doesn't case-fold it. The
  // industry convention is case-insensitive single-word match — "Stop"
  // and "stop please" should both count.
  const first = body.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  return STOP_KEYWORDS.has(first);
}

const E164_RE = /^\+[1-9]\d{7,14}$/;
const US10_RE = /^\d{10}$/;

function normalizePhone(s: string | null | undefined): string | null {
  if (!s) return null;
  const cleaned = s.replace(/[\s\-().]/g, "");
  if (E164_RE.test(cleaned)) return cleaned;
  if (US10_RE.test(cleaned)) return `+1${cleaned}`;
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function twiml(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

// ---------------------------------------------------------------------
// Twilio signature validation
// ---------------------------------------------------------------------
// Algorithm (per Twilio docs):
//   1. Take the full URL of the request as Twilio sees it (including
//      protocol + host + path + querystring).
//   2. If the request is application/x-www-form-urlencoded, append each
//      form parameter sorted by name as `<name><value>` (no separator)
//      to the URL string.
//   3. HMAC-SHA1 the resulting string using the auth token as the key.
//   4. Base64-encode the digest. Compare against X-Twilio-Signature.
//
// We use Web Crypto for HMAC-SHA1 since we're in Deno Edge.
async function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) {
    data += k + params[k];
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return computed === signature;
}

// =====================================================================
// Handler
// =====================================================================
Deno.serve(async (req) => {
  // Twilio only POSTs. Reject anything else cleanly — including OPTIONS,
  // since this isn't a browser-callable endpoint.
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!authToken) {
      // Without the auth token we can't validate the signature — refuse
      // to write anything rather than silently accepting unsigned posts.
      return json({ error: "TWILIO_AUTH_TOKEN not configured" }, 503);
    }

    // -----------------------------------------------------------------
    // 1) Parse the form body. Twilio sends form-urlencoded, not JSON.
    // -----------------------------------------------------------------
    const rawBody = await req.text();
    const form = new URLSearchParams(rawBody);
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = v;

    const from = params["From"];
    const to = params["To"];
    const body = params["Body"] ?? "";
    const messageSid = params["MessageSid"] ?? null;

    if (!from || !to) {
      return json({ error: "Missing From/To" }, 400);
    }

    // -----------------------------------------------------------------
    // 2) Validate the Twilio signature. NON-NEGOTIABLE in production —
    //    skipping this lets anyone forge inbound messages.
    //
    //    The URL we hash must match exactly what Twilio used to compute
    //    its signature. Supabase edge functions can sit behind a few
    //    proxy layers, so we reconstruct from the X-Forwarded-* headers
    //    when present, falling back to req.url otherwise.
    // -----------------------------------------------------------------
    const signature = req.headers.get("X-Twilio-Signature") ?? "";
    if (!signature) {
      return json({ error: "Missing X-Twilio-Signature" }, 403);
    }

    // Reconstruct the public URL Twilio called. req.url in Deno edge is
    // sometimes the internal URL — prefer the forwarded host if present.
    const fwdProto = req.headers.get("x-forwarded-proto");
    const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const reqUrl = new URL(req.url);
    const publicUrl =
      fwdProto && fwdHost ? `${fwdProto}://${fwdHost}${reqUrl.pathname}${reqUrl.search}` : req.url;

    const valid = await validateTwilioSignature(
      authToken,
      publicUrl,
      params,
      signature,
    );
    if (!valid) {
      // Don't leak details — just 403.
      console.warn("twilio-inbound: signature mismatch", {
        url: publicUrl,
        sigPrefix: signature.slice(0, 8),
      });
      return json({ error: "Invalid Twilio signature" }, 403);
    }

    // -----------------------------------------------------------------
    // 3) Identify the operator. The proper multi-tenant path is to
    //    match `To` against a `user_settings.twilio_phone` column —
    //    but that column doesn't exist yet, so v1 falls back to a
    //    single project-wide operator UUID configured as a function
    //    secret. Document this gap loudly.
    //
    //    TODO(per-operator-numbers): when operators each own a Twilio
    //    number, add a `twilio_phone` column to user_settings, populate
    //    it on Twilio number purchase, and look the operator up by
    //    matching params.To against it here.
    // -----------------------------------------------------------------
    const fallbackUserId = Deno.env.get("TWILIO_INBOUND_DEFAULT_USER_ID");
    if (!fallbackUserId) {
      // Still respond 200 with empty TwiML so Twilio doesn't retry — we
      // don't want a 5xx loop. But surface the gap in the log.
      console.error(
        "twilio-inbound: TWILIO_INBOUND_DEFAULT_USER_ID not set, message dropped",
        { from, to, messageSid },
      );
      return twiml(EMPTY_TWIML);
    }
    const userId = fallbackUserId;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // -----------------------------------------------------------------
    // 4) STOP / UNSUBSCRIBE handling. We record the opt-out and SKIP
    //    the inbound insert — there's no value in surfacing "STOP" in
    //    the operator's inbox; the relevant signal is the opt-out row.
    //
    //    Note: Twilio also handles STOP at the carrier level for many
    //    U.S. shortcodes/numbers (the customer is auto-replied "You
    //    have been unsubscribed"), but the keyword still arrives in
    //    the webhook. Recording it gives us a server-side gate so the
    //    next outbound send-customer-sms call can check the opt_outs
    //    table before firing Twilio.
    //
    //    TODO(opt-out-gate): wire send-customer-sms to check
    //    sms_opt_outs before each send. Out of scope for this PR.
    // -----------------------------------------------------------------
    if (isStopKeyword(body)) {
      const normalizedFrom = normalizePhone(from) ?? from;
      const reason = body.trim().split(/\s+/)[0]?.toUpperCase() ?? "STOP";

      const { error: optErr } = await supabase
        .from("sms_opt_outs")
        .upsert(
          {
            user_id: userId,
            phone: normalizedFrom,
            reason,
          },
          { onConflict: "user_id,phone" },
        );
      if (optErr) {
        console.error("twilio-inbound: opt-out upsert failed:", optErr);
        // Still return empty TwiML — we don't want Twilio retrying.
      }
      return twiml(EMPTY_TWIML);
    }

    // -----------------------------------------------------------------
    // 5) Match the sender to a customer if we can. Best effort —
    //    customers.phone is stored in whatever format the operator
    //    typed (often E.164, sometimes (415) 555-1234). We normalize
    //    both sides before comparing.
    // -----------------------------------------------------------------
    const normalizedFrom = normalizePhone(from) ?? from;
    let customerId: string | null = null;
    const { data: candidates } = await supabase
      .from("customers")
      .select("id, phone")
      .eq("user_id", userId)
      .not("phone", "is", null);
    if (candidates && candidates.length > 0) {
      for (const c of candidates as Array<{ id: string; phone: string | null }>) {
        const cp = normalizePhone(c.phone);
        if (cp && cp === normalizedFrom) {
          customerId = c.id;
          break;
        }
      }
    }

    // -----------------------------------------------------------------
    // 6) Insert the inbound row.
    // -----------------------------------------------------------------
    const { error: insErr } = await supabase
      .from("sms_inbound")
      .insert({
        user_id: userId,
        customer_id: customerId,
        from_phone: normalizedFrom,
        to_phone: to,
        body,
        twilio_message_sid: messageSid,
      });
    if (insErr) {
      console.error("twilio-inbound: insert failed:", insErr);
      // Still return empty TwiML so Twilio doesn't retry forever. A
      // failed insert is logged for the operator to investigate.
    }

    return twiml(EMPTY_TWIML);
  } catch (e) {
    console.error("twilio-inbound: unhandled error:", e);
    // Always return 200 + empty TwiML so Twilio doesn't trigger its
    // retry logic for a transient error on our side.
    return twiml(EMPTY_TWIML);
  }
});
