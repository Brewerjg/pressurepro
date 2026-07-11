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

AMENDED 2026-07-10: the Vercel plan caps projects per Git repo, so instead of
a new project, REPOINT the existing `pressure-pro-quoter` project:

1. Vercel → `pressure-pro-quoter` project → Settings → Git → disconnect the
   old repo → connect `Brewerjg/turf` (production branch `main`).
2. Settings → Environment Variables (Production + Preview):

   | Name | Value |
   |---|---|
   | `VITE_VERTICAL` | `pressure` (ADD) |
   | `VITE_SUPABASE_URL` | already present from the old app (same name) |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | already present from the old app |
   | `VITE_PAYMENTS_CLIENT_TOKEN` | copy from the turf Vercel project if missing |

   (`VITE_PUBLIC_APP_ORIGIN` / `VITE_REVENUECAT_*` are native-only — omit.
   Old-app-only vars like Sentry can stay; the unified build ignores them.)
3. Redeploy `main` (connecting the repo usually triggers it).
4. Production URL (unchanged): `https://pressure-pro-quoter.vercel.app`
5. Rollback: Vercel Instant Rollback to the prior production deployment — the
   old app's deployments survive the repo swap in the project history.

## 3. Supabase auth allowlist (user, dashboard)

Likely a NO-OP under the amended §2: `pressure-pro-quoter.vercel.app` was the
old live pressure app's domain and should already be allowlisted. VERIFY:
supabase.com → project `dkksryutecjbyuscpxdb` ("Pressure") → Authentication →
URL Configuration → confirm the domain appears (as Site URL or in Additional
Redirect URLs); add `https://pressure-pro-quoter.vercel.app/**` only if absent.
If Google OAuth is enabled, its authorized origins likewise should already
carry the domain.

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

### Status 2026-07-09 — partially executed, paused at the Vercel gate

- §1 DB gate: **DONE.** 0032 applied via `db query -f ... --linked`; live enum
  verified = `draft, sent, accepted, scheduled, complete, paid, expired`
  (before-state lacked `expired`). Idempotent; nothing to undo.
- §2 Vercel project: **DEFERRED by user.** Not created yet. NOTE: the old
  deploy at `https://pressure-pro-quoter.vercel.app` is alive and still serves
  the old app (confirmed 2026-07-09) — it remains the rollback.
- §3 auth allowlist / §4 verification: pending §2.
- Known gap found during §2 smoke: turf `index.html` hardcodes
  `<title>TurfPro</title>` + TurfPro og/meta tags — the pressure web deploy
  will show a "TurfPro" browser-tab title. Needs a small 1e-followup (vertical
  index.html title/meta via Vite transformIndexHtml or equivalent) BEFORE or
  right after cutover; out of 1f's zero-code scope.
