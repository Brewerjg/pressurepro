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
  | "plan_confirmation";

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
