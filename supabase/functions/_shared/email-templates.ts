// Pure-function email template renderers for the customer comms layer.
// Each builder takes a small, kind-specific context and returns a fully
// rendered { subject, html, text } payload that send-customer-email can
// hand straight to Resend.
//
// Kept dependency-free so it's trivial to unit-test (the same pattern as
// PressurePro's supabase/functions/_shared/email.ts). All HTML uses an
// email-client-safe <table> layout with inline CSS only — no MJML, no
// external stylesheets.

// =====================================================================
// Types
// =====================================================================

export type EmailKind =
  | "on_the_way"
  | "completed"
  | "review_request"
  | "plan_confirmation"
  | "quote_send"
  | "payment_retry";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface BusinessInfo {
  /** Operator's business name from profiles.business_name. */
  name: string;
  /** Optional phone for the email footer. */
  phone?: string;
}

export interface OnTheWayContext {
  firstName?: string;
  address: string;
  /** ETA in minutes if we have it; omitted from the body when null/undefined. */
  driveMinutes?: number | null;
}

export interface CompletedContext {
  firstName?: string;
  address: string;
  /** Public gallery URL — only included when photos exist for the property. */
  galleryUrl?: string | null;
}

export interface ReviewRequestContext {
  firstName?: string;
  reviewUrl: string;
}

export interface QuoteSendLine {
  /** Display name — e.g. "Mow & edge". */
  name: string;
  /** Quantity (visits / units). */
  qty: number;
  /** Per-unit rate in dollars. */
  rate: number;
  /** Line subtotal in dollars (qty * rate). */
  total: number;
}

export interface QuoteSendContext {
  firstName?: string;
  /** Short ID slice ("3F2A") — currently unused in the body but threaded
   * through for future template variants that surface a quote number. */
  shortId?: string;
  /** Optional service address, rendered above the line items table. */
  address?: string | null;
  lines: QuoteSendLine[];
  /** Total in dollars. */
  totalAmount: number;
  /** Optional operator-authored note. */
  notes?: string | null;
  /** Public accept link: `${origin}/accept/{quote_id}`. */
  acceptUrl: string;
  /** Optional ISO expiry date — rendered as a footer hint. */
  expiresAt?: string | null;
}

export interface PaymentRetryContext {
  firstName?: string;
  /** Per-charge amount in cents that failed. */
  amountCents: number;
  /** ISO date the card declined. */
  failedOn?: string | null;
  /** Last 4 of the card on file (best effort — may be null). */
  cardLast4?: string | null;
  /** Self-service portal URL: `/plans/portal/{token}` — links into the
   * Stripe Billing Portal flow on the public plan page. */
  portalUrl: string;
}

export interface PlanConfirmationContext {
  firstName?: string;
  /** weekly | biweekly | monthly | fert_program (we render as friendly label). */
  cadence: string;
  /** 0..6 Sunday..Saturday, optional. */
  dayOfWeek?: number | null;
  /** Per-charge amount in cents. */
  amountCents: number;
  /** ISO date the first visit is expected. */
  firstVisitDate?: string | null;
  /** Self-service portal URL: `/plans/portal/{token}`. */
  portalUrl: string;
}

// =====================================================================
// Helpers
// =====================================================================

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const fmtUsd = (cents: number): string =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

// Quotes show dollars-with-cents on line items because mixed-precision
// pricing is common in lawn-care catalogs. The plan_confirmation flow above
// uses cents-rounded whole dollars; we keep both formats so each template
// renders naturally for its audience.
const fmtUsdExact = (dollars: number): string =>
  dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const dayName = (d: number | null | undefined): string | null => {
  if (d == null) return null;
  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][d] ?? null;
};

const cadenceLabel = (c: string): string => {
  switch (c) {
    case "weekly":        return "weekly";
    case "biweekly":      return "every other week";
    case "monthly":       return "monthly";
    case "fert_program":  return "on a seasonal fertilizer program";
    default:              return c;
  }
};

const greetingName = (firstName?: string): string =>
  firstName?.trim() ? escapeHtml(firstName.trim()) : "there";

/**
 * Shared HTML scaffold — a centered card with a green accent header strip,
 * the body slot, and a small business signature. Inline CSS only.
 */
function wrapHtml(business: BusinessInfo, bodyHtml: string): string {
  const safeBiz = escapeHtml(business.name || "your lawn crew");
  const phoneLine = business.phone
    ? `<div style="font-size:12px;color:#9aa39a;margin-top:4px">${escapeHtml(business.phone)}</div>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2421">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
    <tr><td style="background:linear-gradient(90deg,#1f3a2a 0%,#2c5440 100%);padding:18px 28px">
      <div style="color:#cfead8;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">${safeBiz}</div>
    </td></tr>
    <tr><td style="padding:28px">
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #eef0ee;background:#fafbfa">
      <div style="font-size:13px;color:#5b6b62">— ${safeBiz}</div>
      ${phoneLine}
    </td></tr>
  </table>
</body></html>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2421">${text}</p>`;
}

function ctaButton(href: string, label: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td>
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#b07a2c;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.2px;padding:12px 18px;border-radius:12px">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

// =====================================================================
// Renderers
// =====================================================================

export function renderOnTheWay(
  business: BusinessInfo,
  ctx: OnTheWayContext,
): RenderedEmail {
  const subject = "On the way — your TurfPro crew";
  const bizName = business.name || "the crew";
  const etaSentence = ctx.driveMinutes && ctx.driveMinutes > 0
    ? `We should be there in about ${ctx.driveMinutes} minutes.`
    : "We're on our way now.";

  const html = wrapHtml(
    business,
    paragraph(`Hi ${greetingName(ctx.firstName)},`) +
    paragraph(
      `The ${escapeHtml(bizName)} crew is on the way to ` +
      `<b>${escapeHtml(ctx.address)}</b>. ${escapeHtml(etaSentence)}`,
    ),
  );

  const text =
    `Hi ${ctx.firstName || "there"},\n\n` +
    `The ${bizName} crew is on the way to ${ctx.address}. ${etaSentence}\n\n` +
    `— ${bizName}`;

  return { subject, html, text };
}

export function renderCompleted(
  business: BusinessInfo,
  ctx: CompletedContext,
): RenderedEmail {
  const subject = `Lawn done at ${ctx.address}`;
  const bizName = business.name || "your crew";

  const galleryBlock = ctx.galleryUrl
    ? paragraph(`Want to see before/after? `) +
      ctaButton(ctx.galleryUrl, "View photo gallery")
    : "";

  const html = wrapHtml(
    business,
    paragraph(`Hi ${greetingName(ctx.firstName)},`) +
    paragraph(
      `Your lawn at <b>${escapeHtml(ctx.address)}</b> is freshly done. ` +
      `Thanks for letting us take care of it.`,
    ) +
    galleryBlock,
  );

  const text =
    `Hi ${ctx.firstName || "there"},\n\n` +
    `Your lawn at ${ctx.address} is freshly done. ` +
    `Thanks for letting us take care of it.\n\n` +
    (ctx.galleryUrl ? `View photos: ${ctx.galleryUrl}\n\n` : "") +
    `— ${bizName}`;

  return { subject, html, text };
}

export function renderReviewRequest(
  business: BusinessInfo,
  ctx: ReviewRequestContext,
): RenderedEmail {
  const subject = "Quick favor — leave us a review";
  const bizName = business.name || "your lawn crew";

  const html = wrapHtml(
    business,
    paragraph(`Hi ${greetingName(ctx.firstName)},`) +
    paragraph(
      `If our work was up to snuff, would you mind leaving a quick review? ` +
      `It takes about thirty seconds and it genuinely helps a small lawn-care ` +
      `crew like ours.`,
    ) +
    ctaButton(ctx.reviewUrl, "Leave a review") +
    paragraph(
      `<span style="font-size:13px;color:#5b6b62">Thanks — it means a lot.</span>`,
    ),
  );

  const text =
    `Hi ${ctx.firstName || "there"},\n\n` +
    `If our work was up to snuff, would you mind leaving us a quick review? ` +
    `It takes about thirty seconds.\n\n` +
    `Leave a review: ${ctx.reviewUrl}\n\n` +
    `Thanks — it means a lot.\n\n— ${bizName}`;

  return { subject, html, text };
}

export function renderPlanConfirmation(
  business: BusinessInfo,
  ctx: PlanConfirmationContext,
): RenderedEmail {
  const subject = "Your TurfPro plan is set";
  const bizName = business.name || "your lawn crew";

  const cadence = cadenceLabel(ctx.cadence);
  const day = dayName(ctx.dayOfWeek);
  const dayClause = day ? ` on ${day}s` : "";
  const amount = fmtUsd(ctx.amountCents);
  const firstVisit = ctx.firstVisitDate ? fmtDate(ctx.firstVisitDate) : null;

  const visitLine = firstVisit
    ? `Your first visit is scheduled for <b>${escapeHtml(firstVisit)}</b>.`
    : `We'll be in touch about your first visit shortly.`;

  const html = wrapHtml(
    business,
    paragraph(`Hi ${greetingName(ctx.firstName)},`) +
    paragraph(
      `You're all set on a plan with ${escapeHtml(bizName)} — we'll service ` +
      `your lawn ${escapeHtml(cadence)}${escapeHtml(dayClause)} at ` +
      `<b>${escapeHtml(amount)}</b> per visit.`,
    ) +
    paragraph(visitLine) +
    ctaButton(ctx.portalUrl, "Manage your plan") +
    paragraph(
      `<span style="font-size:13px;color:#5b6b62">You can pause, resume, or cancel any time from the portal.</span>`,
    ),
  );

  const text =
    `Hi ${ctx.firstName || "there"},\n\n` +
    `You're all set on a plan with ${bizName} — we'll service your lawn ` +
    `${cadence}${dayClause} at ${amount} per visit.\n\n` +
    (firstVisit ? `Your first visit is scheduled for ${firstVisit}.\n\n` : "") +
    `Manage your plan: ${ctx.portalUrl}\n\n` +
    `You can pause, resume, or cancel any time.\n\n— ${bizName}`;

  return { subject, html, text };
}

export function renderQuoteSend(
  business: BusinessInfo,
  ctx: QuoteSendContext,
): RenderedEmail {
  const bizName = business.name || "your lawn crew";
  const subject = `Your quote from ${bizName}`;
  const total = fmtUsdExact(ctx.totalAmount);

  // Line items as a tiny <table> — same email-client-safe approach as the
  // wrapper scaffold (inline CSS only, no flexbox).
  const lineRows = ctx.lines.length
    ? ctx.lines
        .map((l, i) => {
          const subtitle =
            l.qty && l.qty !== 1
              ? `<div style="font-size:11px;color:#9aa39a;margin-top:2px">Qty ${l.qty} × ${escapeHtml(fmtUsdExact(l.rate))}</div>`
              : "";
          const sep =
            i === 0
              ? ""
              : "border-top:1px solid #eef0ee;";
          return `<tr><td style="padding:10px 0;${sep}">
            <div style="font-size:14px;font-weight:600;color:#1f2421">${escapeHtml(l.name)}</div>
            ${subtitle}
          </td><td style="padding:10px 0;${sep}text-align:right;font-weight:700;font-size:14px;color:#1f2421;white-space:nowrap">${escapeHtml(fmtUsdExact(l.total))}</td></tr>`;
        })
        .join("")
    : `<tr><td style="padding:10px 0;font-size:13px;color:#9aa39a" colspan="2">No line items.</td></tr>`;

  const linesTable = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 14px;border-collapse:collapse">
      ${lineRows}
      <tr><td style="padding:12px 0 0;border-top:2px solid #1f3a2a;font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#1f3a2a">Total</td>
          <td style="padding:12px 0 0;border-top:2px solid #1f3a2a;text-align:right;font-size:18px;font-weight:800;color:#1f3a2a">${escapeHtml(total)}</td></tr>
    </table>`;

  const addressBlock = ctx.address
    ? paragraph(
        `Here's your quote for <b>${escapeHtml(ctx.address)}</b>.`,
      )
    : paragraph(`Here's the quote we put together for you.`);

  const notesBlock = ctx.notes && ctx.notes.trim()
    ? `<div style="margin:0 0 14px;padding:12px 14px;background:#fafbfa;border-left:3px solid #b07a2c;border-radius:6px"><div style="font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#9aa39a;margin-bottom:4px">Notes</div><div style="font-size:13px;color:#1f2421;white-space:pre-wrap;line-height:1.5">${escapeHtml(ctx.notes.trim())}</div></div>`
    : "";

  const expiresLine = ctx.expiresAt
    ? paragraph(
        `<span style="font-size:12px;color:#9aa39a">This quote expires ${escapeHtml(fmtDate(ctx.expiresAt))}.</span>`,
      )
    : "";

  const html = wrapHtml(
    business,
    paragraph(`Hi ${greetingName(ctx.firstName)},`) +
    addressBlock +
    linesTable +
    notesBlock +
    ctaButton(ctx.acceptUrl, "View & accept") +
    expiresLine,
  );

  const textLines = ctx.lines
    .map((l) => `  • ${l.name} — ${fmtUsdExact(l.total)}`)
    .join("\n");
  const text =
    `Hi ${ctx.firstName || "there"},\n\n` +
    (ctx.address
      ? `Here's your quote for ${ctx.address}.\n\n`
      : `Here's the quote we put together for you.\n\n`) +
    (textLines ? `${textLines}\n\n` : "") +
    `Total: ${total}\n\n` +
    (ctx.notes && ctx.notes.trim() ? `Notes: ${ctx.notes.trim()}\n\n` : "") +
    `View & accept: ${ctx.acceptUrl}\n\n` +
    (ctx.expiresAt ? `Expires ${fmtDate(ctx.expiresAt)}.\n\n` : "") +
    `— ${bizName}` +
    (business.phone ? `\n${business.phone}` : "");

  return { subject, html, text };
}

export function renderPaymentRetry(
  business: BusinessInfo,
  ctx: PaymentRetryContext,
): RenderedEmail {
  const bizName = business.name || "your lawn crew";
  const subject = `Card declined for your ${bizName} plan`;

  const amount = fmtUsd(ctx.amountCents);
  const failedOn = ctx.failedOn ? fmtDate(ctx.failedOn) : null;
  // Build the detail clause piece-by-piece so the dynamic fragments are
  // each escaped at the leaf while the <b> wrappers stay intact.
  const detailParts: string[] = [];
  if (failedOn) {
    detailParts.push(
      `We tried to charge it on <b>${escapeHtml(failedOn)}</b>`,
    );
  } else {
    detailParts.push("We tried to charge it");
  }
  if (ctx.cardLast4) {
    detailParts.push(
      ` on the card ending in <b>${escapeHtml(ctx.cardLast4)}</b>`,
    );
  }
  const detailClause = `${detailParts.join("")}.`;

  const html = wrapHtml(
    business,
    paragraph(`Hi ${greetingName(ctx.firstName)},`) +
      paragraph(
        `Your <b>${escapeHtml(amount)}</b> payment for your ${escapeHtml(bizName)} ` +
          `lawn-care plan didn't go through. ${detailClause}`,
      ) +
      paragraph(
        `Update your card from the plan portal and we'll automatically retry. ` +
          `No need to call — it takes about a minute.`,
      ) +
      ctaButton(ctx.portalUrl, "Update card") +
      paragraph(
        `<span style="font-size:13px;color:#5b6b62">If you've already updated it, you can ignore this email.</span>`,
      ),
  );

  const failedText = failedOn ? ` We tried to charge it on ${failedOn}.` : "";
  const cardText = ctx.cardLast4 ? ` Card ending in ${ctx.cardLast4}.` : "";
  const text =
    `Hi ${ctx.firstName || "there"},\n\n` +
    `Your ${amount} payment for your ${bizName} lawn-care plan didn't go through.${failedText}${cardText}\n\n` +
    `Update your card: ${ctx.portalUrl}\n\n` +
    `If you've already updated it, you can ignore this email.\n\n— ${bizName}`;

  return { subject, html, text };
}

// =====================================================================
// Validation helpers (re-exported for the edge function)
// =====================================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (s: unknown): s is string =>
  typeof s === "string" && EMAIL_RE.test(s) && s.length <= 254;
