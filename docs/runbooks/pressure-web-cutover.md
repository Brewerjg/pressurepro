# Runbook — Pressure web cutover (Phase 1 slice 1f)

Cut the pressure vertical over to the unified turf codebase on the web.
Spec: `docs/superpowers/specs/2026-07-09-pressure-1f-web-cutover-design.md`.
Old deploy (from `Brewerjg/pressure-pro-quoter`) is the rollback — do not touch it.

## 1. DB gate — quote_status 'expired' (agent)

```powershell
supabase db query -f supabase/migrations/0032_pressure_quote_status_expired.sql --linked
supabase db query "SELECT unnest(enum_range(NULL::public.quote_status)) AS status;" --linked
```

(`--linked` is required — without it the CLI targets a local dev DB, not the
live linked project. Verified on CLI 2.108.0.)

Expected: second command lists `draft, sent, accepted, scheduled, complete, paid, expired`.
Additive + idempotent (`IF NOT EXISTS`); no rollback needed; lawn never writes 'expired'.

## 2. Vercel project (user, dashboard)

1. vercel.com → Add New → Project → Import `Brewerjg/turf`.
2. Project name: `pressurepro` (any name; the domain follows it).
3. Framework preset: Vite (auto-detected; `vercel.json` in the repo already
   sets buildCommand/outputDirectory/SPA rewrites — no overrides needed).
4. Environment variables (Production + Preview):

   | Name | Value |
   |---|---|
   | `VITE_VERTICAL` | `pressure` |
   | `VITE_SUPABASE_URL` | copy from the turf Vercel project |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | copy from the turf Vercel project |
   | `VITE_PAYMENTS_CLIENT_TOKEN` | copy from the turf Vercel project |

   (`VITE_PUBLIC_APP_ORIGIN` / `VITE_REVENUECAT_*` are native-only — omit.)
5. Deploy `main`. Record the production URL: `____________________`

## 3. Supabase auth allowlist (user, dashboard)

supabase.com → project `dkksryutecjbyuscpxdb` ("Pressure") → Authentication →
URL Configuration → Additional Redirect URLs → add:

- `https://<pressure-production-url>/**`

Site URL stays turf's. If Google OAuth is enabled, also add the new origin to
the Google Cloud OAuth client's authorized JavaScript origins.

## 4. Live verification (agent, browser)

Against `https://<pressure-production-url>`:

- [ ] Boot + brand: navy theme, "PressurePro", 5 tabs (Home/Customers/Quotes/
      Schedule/Settings), Mix Calc home tile
- [ ] Auth: demo login works (`demo-*@pressurepro.demo`); session survives reload
- [ ] Onboarding: fresh demo account completes; surface-pricing seed (7 surfaces)
- [ ] Quotes: create with surface lines (sqft × rate, soft/power mode); detail
      renders; accept link opens
- [ ] /mix: 50 gal, 12.5% stock, house (1%) → 4 gal SH, 46 gal water, 50 oz surfactant
- [ ] Settings: SurfacePricingEditor matrix loads and saves a rate
- [ ] Plans: flat-billing plan create (no lawn cadence sections)
- [ ] Campaigns: 6 pressure templates render
- [ ] Live data: pre-existing `app='pressurepro'` rows render (1 legacy quote,
      surface_pricing rows)
- [ ] Lawn regression: turf-jade.vercel.app still lawn-branded and boots

Known gaps (flagged, NOT 1f blockers): pp_* Stripe price IDs unverified against
the live Stripe account; paid-tier checkout verified only to the Stripe boundary.

## 5. Rollback

Delete (or ignore) the new Vercel project. Old pressure deploy untouched.
DB change stays (additive, harmless).

## Results

(appended by the verification pass)
