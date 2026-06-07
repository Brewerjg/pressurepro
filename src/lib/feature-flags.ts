// Feature flags. Plain string-typed booleans so we don't have to thread a
// remote-config layer through the app for what's really one-or-two
// operator-instance preferences.

// Twilio auto-send (advanced) — when false, customer texts use the
// sms: deep-link copy/paste model via TextCustomerButton. Set this
// to true if your operator wants real Twilio automation. Requires
// TWILIO_* secrets on the Supabase project and per-operator number
// provisioning (TODO from earlier work).
export const TWILIO_ENABLED = false;
