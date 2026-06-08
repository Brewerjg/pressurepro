// Feature flags. Plain string-typed booleans so we don't have to thread a
// remote-config layer through the app for what's really one-or-two
// operator-instance preferences.

// Twilio auto-send (advanced) — when false, customer texts use the
// sms: deep-link copy/paste model via MessageCustomerButton. Set this
// to true if your operator wants real Twilio automation. Requires
// TWILIO_* secrets on the Supabase project and per-operator number
// provisioning (TODO from earlier work).
export const TWILIO_ENABLED = false;

// Resend auto-send (advanced) — when false, customer emails use the
// mailto: deep-link copy/paste model via MessageCustomerButton. The
// operator's own mail client opens with subject + body pre-filled and
// they tap Send. Set this to true to revive the Resend auto-send path
// in src/lib/customer-email.ts and supabase/functions/send-customer-email.
// Requires RESEND_API_KEY on the Supabase project. Note: send-campaign
// is EXEMPT from this flag — campaign blasts always go through Resend
// because mailto: doesn't scale to 200-customer fan-outs.
export const RESEND_ENABLED = false;
