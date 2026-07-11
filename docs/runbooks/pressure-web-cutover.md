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

Against `https://pressure-pro-quoter.vercel.app`:

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

Vercel Instant Rollback to the prior production deployment (§2 step 5) — the
old app's deployments survive the repo swap, so rollback does not require
recreating or touching a separate project.
DB change stays (additive, harmless).

## Results

### Verification pass 2026-07-10 — CUTOVER LIVE, 9/10 PASS

Deploy: repointed `pressure-pro-quoter` project built main (`ed86c33`);
served CSS `index-D_JDg-7Z.css` with `--brand-800: 220 65% 18%` (navy),
byte-identical to a local `VITE_VERTICAL=pressure` build. Lawn deploy serves a
different bundle (`148 65% 20%` green) — verticals correctly differentiated.

Checklist (browser, throwaway demo account `demo-scyadi@pressurepro.demo`;
full evidence in the SDD task-5 report):
1. Boot + brand — PASS (navy token exact; PressurePro auth branding; tab title
   "TurfPro" = the known index.html gap)
2. Auth demo login + session persistence — PASS
3. Onboarding — PASS on 2nd attempt (see anomaly A1)
4. Home shell — PASS (exactly 5 tabs; Mix Calc tile)
5. /mix — PASS (50 gal / 12.5% / house 1% → 4.00 SH, 46.00 water, 50.0 oz)
6. Quotes — PASS (Driveway 600 sqft × $0.18 = $108.00; soft/power toggle;
   public accept link renders w/ signature flow)
7. Surface-pricing matrix — PASS (edit persisted, then reverted; no net change)
8. Plans — PASS (flat "Plan amount" + billing cadence; NO lawn frequency/
   route-day/season sections)
9. Campaigns — PASS (6 pressure templates; {first_name}/{business_name}
   merge tags substitute)
10. Console health — FAIL: 7× HTTP 502 from the `forecast` Supabase Edge
    Function (`?zip=30301`), invoked by Home weather/GDD widgets. No uncaught
    JS exceptions.
Regression: turf-jade.vercel.app still lawn-branded — PASS.

Anomalies for follow-up (evidence-only, nothing fixed):
- A1 Onboarding: skipping the final Stripe step on the first pass silently
  reset the wizard to step 1; second pass completed. Likely also caused the
  duplicate "Solo" crew entry (onboarding seeded twice).
- A2/A3 Cross-vertical leaks (the KNOWN deferred 0c-5 season/weather seam):
  lawn "Pre-emergent watch"/GDD widget on pressure Home (links
  /calc?type=herbicide); "Season" selector with mow/snow copy in pressure
  Settings.
- A4 `forecast` edge fn 502s (see item 10) — infra, affects lawn too if down.
- A5 index.html "TurfPro" tab title on the pressure deploy (pre-known).
- Minor: NewPlan helper copy "service still runs on the frequency above" is
  stale for pressure (no frequency control) — 1d-3's known cosmetic tail.

Stripe pp_* price IDs + paid checkout remain UNVERIFIED (flagged known gap).

### Status 2026-07-09 — partially executed, paused at the Vercel gate

- §1 DB gate: **DONE.** 0032 applied via `db query -f ... --linked`; live enum
  verified = `draft, sent, accepted, scheduled, complete, paid, expired`
  (before-state lacked `expired`). Idempotent; nothing to undo.
- §2 Vercel project: **DEFERRED by user.** Not created yet. NOTE: the old
  deploy at `https://pressure-pro-quoter.vercel.app` is alive and still serves
  the old app (confirmed 2026-07-09) — it remains the rollback.
  (SUPERSEDED 2026-07-10 — plan-cap hit; §2 now repoints the existing
  pressure-pro-quoter project, repoint in progress.)
- §3 auth allowlist / §4 verification: pending §2's redeploy under the
  repoint framing.
- Known gap found during §2 smoke: turf `index.html` hardcodes
  `<title>TurfPro</title>` + TurfPro og/meta tags — the pressure web deploy
  will show a "TurfPro" browser-tab title. Needs a small 1e-followup (vertical
  index.html title/meta via Vite transformIndexHtml or equivalent) BEFORE or
  right after cutover; out of 1f's zero-code scope.
