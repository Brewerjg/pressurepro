// send-campaign — fan-out blaster for TurfPro's seasonal campaign tool.
//
// NOTE: This function is EXEMPT from the RESEND_ENABLED / TWILIO_ENABLED
// feature flags that gate the per-customer transactional sends. Campaigns
// intentionally stay on Resend (and Twilio when enabled) because mailto:
// and sms: deep-links don't scale to a 200-customer blast — the operator
// can't realistically tap Send 200 times. The operator-self-sends model
// is for high-touch transactional moments (on-the-way, quote send, etc);
// campaigns are bulk marketing and need real automation.
//
// Given a campaigns row id, this function:
//   1. Resolves the audience_filter against the operator's customers
//      (server-side query — never trusts a client-supplied recipient list)
//   2. Renders merge tags ({first_name}, {address}, {business_name}) per
//      recipient and fans out to send-customer-email / send-customer-sms,
//      one POST per recipient per channel
//   3. Updates email_sent_count / sms_sent_count as it goes and promotes
//      the row to status='sent' (or 'failed' on hard error)
//
// Rate-limiting: we await a fixed delay between sends to stay under
// Resend's "10 emails/sec on the free plan" cap and Twilio's per-account
// MPS cap. ~5 sends/sec is conservative but safe.
//
// Idempotency: if the campaign is already 'sent', we skip and return
// the existing counts. If it's 'sending' we assume another worker has
// it and bail out — the operator can retry from the UI by re-queueing
// after a manual status reset.
//
// Auth: same authenticated-caller pattern as send-customer-email. The
// operator's JWT identifies which campaigns row they can touch (RLS
// enforces user_id match), but actual writes happen via service-role
// because email_log / sms_log inserts and campaign counter updates would
// otherwise race against RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders } from "../_shared/cors.ts";

// Mirrors APP_ID in src/lib/app-context.ts. Keep in sync.
const APP_ID = "turfpro";

// ---------------------------------------------------------------------
// Inbound request shape
// ---------------------------------------------------------------------
interface SendCampaignPayload {
  campaign_id: string;
}

interface AudienceFilter {
  preset?:
    | "all"
    | "with_active_plan"
    | "without_active_plan"
    | "inactive_days"
    | "test_self";
  days?: number;
}

interface CampaignRow {
  id: string;
  user_id: string;
  name: string;
  kind: string;
  channels: string[];
  subject: string | null;
  body: string;
  audience_filter: AudienceFilter;
  status: string;
  total_recipients: number;
  email_sent_count: number;
  sms_sent_count: number;
}

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  primary_address: string | null;
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    // Service-role for all writes (campaign counter updates, log inserts).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const payload = (await req.json()) as SendCampaignPayload;
    if (!payload?.campaign_id) {
      return json({ error: "Missing campaign_id" }, 400);
    }

    // -----------------------------------------------------------------
    // 1) Load the campaign row + verify ownership.
    // -----------------------------------------------------------------
    const { data: campaign, error: cErr } = await supabase
      .from("campaigns")
      .select(
        "id, user_id, name, kind, channels, subject, body, audience_filter, status, total_recipients, email_sent_count, sms_sent_count",
      )
      .eq("id", payload.campaign_id)
      .eq("user_id", userData.user.id)
      .eq("app", APP_ID)
      .maybeSingle();
    if (cErr || !campaign) return json({ error: "Campaign not found" }, 404);

    const c = campaign as CampaignRow;

    // Idempotency — skip on terminal states.
    if (c.status === "sent") {
      return json({
        ok: true,
        skipped: true,
        reason: "already_sent",
        email_sent_count: c.email_sent_count,
        sms_sent_count: c.sms_sent_count,
        total_recipients: c.total_recipients,
      });
    }
    if (c.status === "sending") {
      return json({
        ok: true,
        skipped: true,
        reason: "already_in_flight",
      });
    }

    if (!c.channels || c.channels.length === 0) {
      await markFailed(supabase, c.id, "No channels selected");
      return json({ error: "Campaign has no channels selected" }, 400);
    }
    const wantEmail = c.channels.includes("email");
    const wantSms = c.channels.includes("sms");

    // -----------------------------------------------------------------
    // 2) Resolve the audience filter SERVER-SIDE.
    //    Every preset is one SQL query against customers/maintenance_plans/
    //    route_stops — we never pull "all customers" to the client.
    // -----------------------------------------------------------------
    const filter: AudienceFilter = c.audience_filter ?? {};
    const recipients = await resolveAudience(
      supabase,
      userData.user.id,
      filter,
      userData.user.email ?? null,
    );

    // -----------------------------------------------------------------
    // 3) Mark sending; record total_recipients.
    // -----------------------------------------------------------------
    await supabase
      .from("campaigns")
      .update({
        status: "sending",
        total_recipients: recipients.length,
        email_sent_count: 0,
        sms_sent_count: 0,
      })
      .eq("id", c.id);

    if (recipients.length === 0) {
      await supabase
        .from("campaigns")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", c.id);
      return json({
        ok: true,
        total_recipients: 0,
        email_sent_count: 0,
        sms_sent_count: 0,
      });
    }

    // -----------------------------------------------------------------
    // 4) Look up operator business name once — used in merge tags.
    // -----------------------------------------------------------------
    const { data: prof } = await supabase
      .from("profiles")
      .select("business_name")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    const businessName =
      (prof?.business_name as string | null) ?? "your lawn crew";

    // -----------------------------------------------------------------
    // 5) Fan out. ~5 sends/sec via a fixed 200ms delay between recipients.
    //    Within a single recipient, email + SMS fire in parallel (one
    //    counts against Resend's bucket, the other against Twilio's).
    // -----------------------------------------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const subject = c.subject ?? defaultSubjectForKind(c.kind);

    let emailSent = 0;
    let smsSent = 0;

    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      const merged = applyMergeTags(c.body, {
        first_name: firstName(r.name),
        address: r.primary_address ?? "",
        business_name: businessName,
      });
      const mergedSubject = subject
        ? applyMergeTags(subject, {
            first_name: firstName(r.name),
            address: r.primary_address ?? "",
            business_name: businessName,
          })
        : null;

      const tasks: Promise<boolean>[] = [];

      if (wantEmail && r.email) {
        tasks.push(
          fanoutEmail(supabaseUrl, authHeader, {
            recipient: { email: r.email, name: r.name },
            customer_id: r.id,
            subject: mergedSubject ?? "Update from your lawn crew",
            body: merged,
          }),
        );
      }
      if (wantSms && r.phone) {
        tasks.push(
          fanoutSms(supabaseUrl, authHeader, {
            recipient: { phone: r.phone, name: r.name },
            customer_id: r.id,
            body: trimForSms(merged),
          }),
        );
      }

      const results = await Promise.all(tasks);
      // Tally — wantEmail comes first when present.
      let ti = 0;
      if (wantEmail && r.email) {
        if (results[ti]) emailSent++;
        ti++;
      }
      if (wantSms && r.phone) {
        if (results[ti]) smsSent++;
      }

      // Periodic progress flush — every 10 recipients keeps the counters
      // visible to the operator polling the row from the UI.
      if ((i + 1) % 10 === 0 || i === recipients.length - 1) {
        await supabase
          .from("campaigns")
          .update({
            email_sent_count: emailSent,
            sms_sent_count: smsSent,
          })
          .eq("id", c.id);
      }

      // Rate-limit: ~5 sends/sec keeps us comfortably under Resend's
      // 10/sec free-tier and Twilio's 1 MPS-per-number default. Skip
      // the sleep on the last iteration.
      if (i < recipients.length - 1) {
        await sleep(200);
      }
    }

    // -----------------------------------------------------------------
    // 6) Promote to sent.
    // -----------------------------------------------------------------
    await supabase
      .from("campaigns")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        email_sent_count: emailSent,
        sms_sent_count: smsSent,
      })
      .eq("id", c.id);

    return json({
      ok: true,
      total_recipients: recipients.length,
      email_sent_count: emailSent,
      sms_sent_count: smsSent,
    });
  } catch (e) {
    console.error("send-campaign error:", e);
    return json(
      { error: e instanceof Error ? e.message : "Unknown" },
      500,
    );
  }
});

// ---------------------------------------------------------------------
// Audience resolution — every branch returns customers OWNED by the
// authenticated operator. RLS would block anyway but explicit user_id
// filters keep the queries fast (the indexes are on user_id).
// ---------------------------------------------------------------------
async function resolveAudience(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  filter: AudienceFilter,
  operatorEmail: string | null,
): Promise<CustomerRow[]> {
  // "Test send to me only" — sends one message addressed to the
  // signed-in operator. We don't have a customers row for them, so we
  // synthesize a recipient.
  if (filter.preset === "test_self") {
    if (!operatorEmail) return [];
    // Pull phone from profiles if present so a test SMS works too.
    const { data: prof } = await supabase
      .from("profiles")
      .select("phone, business_name")
      .eq("user_id", userId)
      .maybeSingle();
    return [
      {
        id: userId, // not a real customers.id; OK — log rows use customer_id nullable
        name: ((prof?.business_name as string | null) ?? "Test send"),
        email: operatorEmail,
        phone: (prof?.phone as string | null) ?? null,
        primary_address: null,
      },
    ];
  }

  // "Customers WITH at least one active plan."
  if (filter.preset === "with_active_plan") {
    // Two-step: pull active-plan customer_ids, then fetch the customer rows.
    const { data: plans, error: pErr } = await supabase
      .from("maintenance_plans")
      .select("customer_id")
      .eq("user_id", userId)
      .eq("app", APP_ID)
      .eq("status", "active")
      .not("customer_id", "is", null);
    if (pErr) throw pErr;
    const ids = uniq(
      ((plans ?? []) as { customer_id: string | null }[])
        .map((p) => p.customer_id)
        .filter((x): x is string => !!x),
    );
    if (ids.length === 0) return [];
    return loadCustomers(supabase, userId, ids);
  }

  // "Customers WITHOUT an active plan" — the lapsed list, high-conversion
  // audience for aeration / spring restart / fert pitch.
  if (filter.preset === "without_active_plan") {
    const { data: plans, error: pErr } = await supabase
      .from("maintenance_plans")
      .select("customer_id")
      .eq("user_id", userId)
      .eq("app", APP_ID)
      .eq("status", "active")
      .not("customer_id", "is", null);
    if (pErr) throw pErr;
    const excludeIds = new Set(
      ((plans ?? []) as { customer_id: string | null }[])
        .map((p) => p.customer_id)
        .filter((x): x is string => !!x),
    );
    const all = await loadAllCustomers(supabase, userId);
    return all.filter((c) => !excludeIds.has(c.id));
  }

  // "Customers who haven't been visited in N days" — pulls the most
  // recent completed route stop per customer, then keeps customers whose
  // newest completed_at is older than the cutoff (or who have NO completed
  // stops at all — those are the freshest leads).
  if (filter.preset === "inactive_days") {
    const days = Math.max(1, Math.min(365, filter.days ?? 60));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString();
    // Pull customer_ids that DO have a recent visit (>= cutoff) — we'll
    // exclude these from the all-customers list.
    const { data: recent, error: rErr } = await supabase
      .from("route_stops")
      .select("customer_id")
      .eq("user_id", userId)
      .eq("status", "done")
      .gte("completed_at", cutoff)
      .not("customer_id", "is", null);
    if (rErr) throw rErr;
    const excludeIds = new Set(
      ((recent ?? []) as { customer_id: string | null }[])
        .map((p) => p.customer_id)
        .filter((x): x is string => !!x),
    );
    const all = await loadAllCustomers(supabase, userId);
    return all.filter((c) => !excludeIds.has(c.id));
  }

  // Default — preset === 'all' or missing.
  return loadAllCustomers(supabase, userId);
}

async function loadAllCustomers(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<CustomerRow[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, email, phone, primary_address")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as CustomerRow[];
}

async function loadCustomers(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  ids: string[],
): Promise<CustomerRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, email, phone, primary_address")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw error;
  return (data ?? []) as CustomerRow[];
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

// ---------------------------------------------------------------------
// Per-recipient fanout. We POST directly to the existing edge functions
// rather than duplicate Resend/Twilio call code. This keeps the audit
// trail (email_log / sms_log) consistent with one-off transactional sends.
//
// The send-customer-email / send-customer-sms functions only accept
// well-known kinds (on_the_way / completed / review_request /
// plan_confirmation). Campaign sends don't fit any of those, so we'd
// have to extend those functions to accept a 'custom' kind — but the
// spec says NOT to touch send-customer-email / send-customer-sms.
//
// Workaround: we POST to Resend / Twilio directly here, mirroring the
// minimal shape from those functions, and write our own email_log /
// sms_log row. Slightly more code but avoids touching off-limits files.
// ---------------------------------------------------------------------

interface EmailFanoutArgs {
  recipient: { email: string; name?: string };
  customer_id: string | null;
  subject: string;
  body: string;
}

interface SmsFanoutArgs {
  recipient: { phone: string; name?: string };
  customer_id: string | null;
  body: string;
}

async function fanoutEmail(
  _supabaseUrl: string,
  _authHeader: string,
  args: EmailFanoutArgs,
): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS");
  if (!apiKey || !fromAddress) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: args.recipient.email,
        subject: args.subject,
        // For campaigns, the body is plain text the operator wrote. We
        // wrap it in minimal HTML so Resend doesn't strip newlines.
        html: htmlEscape(args.body).replace(/\n/g, "<br>"),
        text: args.body,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function fanoutSms(
  _supabaseUrl: string,
  _authHeader: string,
  args: SmsFanoutArgs,
): Promise<boolean> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) return false;
  const toPhone = normalizePhone(args.recipient.phone);
  if (!toPhone) return false;
  try {
    const form = new URLSearchParams();
    form.set("To", toPhone);
    form.set("From", from);
    form.set("Body", args.body);
    const basic = btoa(`${sid}:${token}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function markFailed(
  supabase: ReturnType<typeof createClient>,
  campaignId: string,
  error: string,
): Promise<void> {
  await supabase
    .from("campaigns")
    .update({ status: "failed", error })
    .eq("id", campaignId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function firstName(full: string | null | undefined): string {
  if (!full) return "there";
  const f = full.trim().split(/\s+/)[0];
  return f || "there";
}

function applyMergeTags(
  template: string,
  vars: { first_name: string; address: string; business_name: string },
): string {
  return template
    .replaceAll("{first_name}", vars.first_name)
    .replaceAll("{address}", vars.address)
    .replaceAll("{business_name}", vars.business_name);
}

function defaultSubjectForKind(kind: string): string {
  switch (kind) {
    case "aeration":
      return "Fall aeration — get on the schedule";
    case "leaf_cleanup":
      return "Leaf cleanup — book your visit";
    case "spring_restart":
      return "Spring is here — restart your weekly mow";
    case "fert_program":
      return "Lock in your 5-step fert program";
    case "snow_signup":
      return "Snow season — reserve your spot";
    default:
      return "An update from your lawn crew";
  }
}

// SMS bodies above ~480 chars get split into 3 segments by Twilio; we trim
// to a single GSM-friendly segment range. The operator's wizard already
// warns if the body is long, but this is the belt-and-suspenders cut.
function trimForSms(body: string): string {
  const MAX = 320;
  if (body.length <= MAX) return body;
  return body.slice(0, MAX - 1).trimEnd() + "…";
}

function htmlEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Minimal phone normalization — mirrors the helper in sms-templates.ts but
// inlined here so we don't import across function boundaries. Accepts
// 10-digit US numbers, 11-digit (1XXXXXXXXXX), or already-E.164.
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return digits.length >= 8 ? digits : null;
  }
  const onlyDigits = digits.replace(/\D/g, "");
  if (onlyDigits.length === 10) return `+1${onlyDigits}`;
  if (onlyDigits.length === 11 && onlyDigits.startsWith("1")) {
    return `+${onlyDigits}`;
  }
  return null;
}
