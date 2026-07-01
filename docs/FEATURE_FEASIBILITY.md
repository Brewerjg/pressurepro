# Feature Feasibility — recommended build priorities

Assessment of the TurfPro_Pricing_Strategy build priorities against the actual
codebase. Verdicts are grounded in what exists today.

## 1. QuickBooks sync — ✅ Feasible (highest ROI, do first)
- **Foundation exists:** invoices, `manual_payments`, and Stripe payments are
  modeled; the per-operator OAuth + token-on-profile + edge-function pattern is
  already proven by Stripe Connect onboarding.
- **Needs:** Intuit developer app (OAuth client), per-operator encrypted token
  storage, edge functions (OAuth connect/callback + sync push), and wiring the
  existing "QuickBooks sync — Coming soon" Settings row to a real Connect button.
  Build server-side REST/OAuth (the removed node SDK is unnecessary).
- **Blocker:** Intuit app + production approval (sandbox is immediate).
- **Effort:** ~1–2 weeks. **Verdict: very feasible.**

## 2. Satellite property measurement — ✅ Feasible as manual-draw (⚠️ not auto-detect)
- **Stronger foundation than expected:** `properties.turf_sqft` already exists
  AND `ApplicationCalc` already reads/prefills it — a measurement just writes one
  field that already powers the NPK calculator + quotes. Addresses geocode with
  the existing Google key.
- **The catch:** no in-app map library yet, and the "no AI" constraint rules out
  automated turf detection (computer vision). Feasible version = operator draws a
  polygon over satellite imagery → geodesic area → `turf_sqft`. Matches the
  competitor *workflow* but is manual, not auto-measure.
- **Needs:** Google Maps JS (Drawing/Geometry) or Mapbox GL + draw, a
  measurement component, a browser-restricted Maps key (separate from the server
  Routes key).
- **Effort:** ~1–2 weeks. **Verdict: feasible (manual-draw); auto-measure is
  off the table without AI.**

## 3. Customer self-booking — ✅ Feasible (scope a v1)
- **Foundation exists:** public unauthenticated page pattern (Accept / Invoice /
  PlanPortal via RLS + tokens/RPCs), quotes pipeline, operator messaging.
- **Needs (net-new):** a public "request service" page per operator (slug), a
  `service_requests`/leads table + public-insert RPC + RLS, an operator-side
  triage list → convert to quote/plan, and a new-request notification.
- **Effort:** ~1–2 weeks for a v1 request-form → lead list (full availability/
  calendar booking is more). **Verdict: feasible — ship the request form first.**

## 4. Promote beta → GA — ✅ Trivial
- Weather/spray-day planner is live; route optimization is deployed. "GA" =
  validate stability + remove the "(beta)" labels (stripe.ts highlights, Home
  weather header, Routes header). **Effort: hours.**

## Already built (the lawn-native differentiators from the strategy)
Chemical log & compliance, GDD pre-emergent alerts, weather/spray-day planner
(beta), route optimization (beta), recurrence engine + season pause — all done.

## Recommended order (by ROI)
**QuickBooks → beta→GA (quick win) → customer self-booking → satellite
measurement.** None require AI except fully-automated satellite measurement,
which is excluded by the no-AI stance (manual-draw is the substitute).
