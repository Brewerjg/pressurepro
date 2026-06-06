// Pure-function SMS template renderers for the customer comms layer.
// SMS counterpart to email-templates.ts — same four kinds, same context
// shapes (minus the HTML-only bits like gallery URL formatting), but each
// renderer returns just `{ body: string }` since SMS is plain text.
//
// Design goals:
//   1. Stay under 160 characters where possible — single SMS segment is
//      cheaper, faster, and arrives as one message on every carrier.
//   2. Gracefully expand past 160 if needed (long addresses, long business
//      names). The Twilio API will auto-segment; we never truncate content
//      since a half-sent address is worse than two messages.
//   3. Always include the "Reply STOP to opt out" suffix — required for
//      U.S. TCPA compliance on transactional service messages.
//
// Kept dependency-free so it's trivial to unit-test (mirrors the
// email-templates.ts shape).

// =====================================================================
// Types
// =====================================================================

export type SmsKind =
  | "on_the_way"
  | "completed"
  | "review_request"
  | "plan_confirmation"
  // quote_send = operator hit "Send" on a draft quote and the customer
  // has a phone on file. Body is a short link to /accept/{quote_id}.
  | "quote_send"
  // freeform = operator typed a custom reply from the Inbox. We render
  // it as-is, only appending the mandatory STOP suffix if missing.
  | "freeform"
  // payment_retry = the plan's card-on-file declined. Short body with the
  // portal link so the customer can update their card and resume the plan.
  | "payment_retry";

export interface RenderedSms {
  body: string;
}

export interface SmsBusinessInfo {
  /** Operator's business name from profiles.business_name. */
  name: string;
}

export interface SmsOnTheWayContext {
  firstName?: string;
  address: string;
  /** ETA in minutes if we have it; omitted from the body when null/undefined. */
  driveMinutes?: number | null;
}

export interface SmsCompletedContext {
  firstName?: string;
  address: string;
  /** Public gallery URL — only included when photos exist for the property. */
  galleryUrl?: string | null;
}

export interface SmsReviewRequestContext {
  firstName?: string;
  reviewUrl: string;
}

export interface SmsPlanConfirmationContext {
  firstName?: string;
  /** weekly | biweekly | monthly | fert_program — rendered as friendly label. */
  cadence: string;
  /** ISO date the first visit is expected. */
  firstVisitDate?: string | null;
  /** Self-service portal URL: `/plans/portal/{token}`. */
  portalUrl: string;
}

export interface SmsQuoteSendContext {
  firstName?: string;
  /** Public accept link: `${origin}/accept/{quote_id}`. */
  acceptUrl: string;
}

export interface SmsPaymentRetryContext {
  firstName?: string;
  /** Self-service portal URL: `/plans/portal/{token}`. */
  portalUrl: string;
}

export interface SmsFreeformContext {
  /** Operator-typed body, verbatim. We don't interpolate variables. */
  body: string;
}

/** Extra info returned with a freeform render so the UI can warn. */
export interface RenderedFreeformSms extends RenderedSms {
  /**
   * Twilio bills per segment (~160 GSM-7 chars or 70 UCS-2 chars). If the
   * rendered body exceeds 160 chars we set `segments` so the caller can
   * surface a confirmation. We don't truncate — a half-sent reply is
   * worse than two billed segments.
   */
  segments: number;
}

// =====================================================================
// Helpers
// =====================================================================

const STOP_SUFFIX = "Reply STOP to opt out.";

const fmtDate = (iso: string): string => {
  try {
    // Short form — "May 21" — to keep the body tight. Year only feels
    // worth including if the plan starts months out, which is rare for
    // lawn care; skipping to save characters.
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
};

const cadenceLabel = (c: string): string => {
  switch (c) {
    case "weekly":       return "weekly";
    case "biweekly":     return "biweekly";
    case "monthly":      return "monthly";
    case "fert_program": return "fertilizer";
    default:             return c;
  }
};

const firstNameOrFallback = (n?: string): string => {
  const trimmed = n?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "there";
};

// =====================================================================
// Renderers
// =====================================================================

export function renderOnTheWaySms(
  business: SmsBusinessInfo,
  ctx: SmsOnTheWayContext,
): RenderedSms {
  const biz = business.name || "your lawn crew";
  const name = firstNameOrFallback(ctx.firstName);
  const eta =
    ctx.driveMinutes && ctx.driveMinutes > 0
      ? `, about ${ctx.driveMinutes} min out`
      : "";
  // Worst case: "Hi {long_name}, your {long_biz} crew is on the way to
  // {long_addr}, about {NN} min out. Reply STOP to opt out."
  return {
    body: `Hi ${name}, your ${biz} crew is on the way to ${ctx.address}${eta}. ${STOP_SUFFIX}`,
  };
}

export function renderCompletedSms(
  business: SmsBusinessInfo,
  ctx: SmsCompletedContext,
): RenderedSms {
  const biz = business.name || "your lawn crew";
  const name = firstNameOrFallback(ctx.firstName);
  const photos = ctx.galleryUrl ? ` Photos: ${ctx.galleryUrl}.` : "";
  return {
    body: `Hi ${name}, lawn done at ${ctx.address}. Thanks! — ${biz}.${photos} ${STOP_SUFFIX}`,
  };
}

export function renderReviewRequestSms(
  business: SmsBusinessInfo,
  ctx: SmsReviewRequestContext,
): RenderedSms {
  const biz = business.name || "your lawn crew";
  const name = firstNameOrFallback(ctx.firstName);
  return {
    body: `Hi ${name}, would you take 20 sec to leave us a quick review? ${ctx.reviewUrl}. Thanks — ${biz}. ${STOP_SUFFIX}`,
  };
}

export function renderQuoteSendSms(
  business: SmsBusinessInfo,
  ctx: SmsQuoteSendContext,
): RenderedSms {
  const biz = business.name || "your lawn crew";
  const name = firstNameOrFallback(ctx.firstName);
  // Worst case: "Hi {first_name}, here's your quote from {long_biz}:
  // https://app.turfpro.test/accept/{uuid} — Reply STOP to opt out."
  // ~140-150 chars with a short business name; one segment in most cases.
  return {
    body: `Hi ${name}, here's your quote from ${biz}: ${ctx.acceptUrl} — ${STOP_SUFFIX}`,
  };
}

export function renderPlanConfirmationSms(
  business: SmsBusinessInfo,
  ctx: SmsPlanConfirmationContext,
): RenderedSms {
  const biz = business.name || "your lawn crew";
  const name = firstNameOrFallback(ctx.firstName);
  const cadence = cadenceLabel(ctx.cadence);
  const visit = ctx.firstVisitDate
    ? ` First visit ${fmtDate(ctx.firstVisitDate)}.`
    : "";
  return {
    body: `Hi ${name}, your ${cadence} TurfPro plan is set.${visit} Manage: ${ctx.portalUrl}. — ${biz}. ${STOP_SUFFIX}`,
  };
}

export function renderPaymentRetrySms(
  business: SmsBusinessInfo,
  ctx: SmsPaymentRetryContext,
): RenderedSms {
  const biz = business.name || "your lawn crew";
  const name = firstNameOrFallback(ctx.firstName);
  // Worst case: "Hi {long_name}, your card for your {long_biz} plan was
  // declined. Update it here: {portalUrl}. Reply STOP to opt out."
  return {
    body: `Hi ${name}, your card for your ${biz} plan was declined. Update it: ${ctx.portalUrl}. ${STOP_SUFFIX}`,
  };
}

/**
 * Operator-typed freeform reply. The renderer's only jobs:
 *   1. Append the mandatory "Reply STOP to opt out." footer if the
 *      operator didn't already include it (case-insensitive check).
 *   2. Compute the segment count so the caller can warn at > 1 segment.
 *
 * We never truncate — operators occasionally need to send long replies
 * (directions, an apology, a service question) and a clipped message is
 * worse than billing for two segments.
 */
export function renderFreeformSms(
  _business: SmsBusinessInfo,
  ctx: SmsFreeformContext,
): RenderedFreeformSms {
  const typed = ctx.body.trim();
  // Case-insensitive substring match — operator might write "reply stop
  // to opt out" or "Reply STOP" or some other variant. Anything that
  // mentions both "STOP" and "opt" we trust to satisfy the requirement.
  const hasStopFooter = /stop/i.test(typed) && /opt/i.test(typed);
  const body = hasStopFooter ? typed : `${typed} ${STOP_SUFFIX}`;
  // GSM-7 segment math is more involved than this (concat headers eat
  // 7 chars per segment past the first, UCS-2 is 70 chars/segment) but
  // for a warn-the-operator threshold the simple length / 160 is fine.
  const segments = Math.max(1, Math.ceil(body.length / 160));
  return { body, segments };
}

// =====================================================================
// Validation
// =====================================================================

// E.164-ish: leading +, then 8–15 digits. Twilio is strict about E.164,
// and most U.S. lawn customers should already be normalized to +1XXXXXXXXXX
// by the customers row's phone column. We also accept bare 10-digit US
// numbers (no +) and let the edge function prepend +1 — common in older
// data.
const E164_RE = /^\+[1-9]\d{7,14}$/;
const US10_RE = /^\d{10}$/;

export function isValidPhone(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const cleaned = s.replace(/[\s\-().]/g, "");
  return E164_RE.test(cleaned) || US10_RE.test(cleaned);
}

/**
 * Normalize a user-entered phone to E.164. Returns null if not parseable.
 * Best-effort — bare 10 digits become +1XXX...; anything else needs a +.
 */
export function normalizePhone(s: string): string | null {
  const cleaned = s.replace(/[\s\-().]/g, "");
  if (E164_RE.test(cleaned)) return cleaned;
  if (US10_RE.test(cleaned)) return `+1${cleaned}`;
  return null;
}
