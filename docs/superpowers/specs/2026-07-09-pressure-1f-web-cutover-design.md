# Phase 1 slice 1f — pressure web cutover design

Status: approved scope (web-only cutover; native + repo retirement deferred).
Date: 2026-07-09.
Parent: `2026-07-08-pressure-vertical-phase1-design.md`. The cutover slice —
where the pressure vertical goes live on the web.

## Purpose

Put the unified codebase's pressure build (`VITE_VERTICAL=pressure`, proven
bootable in 1e, merged `e1a916a`) in front of live traffic: a second Vercel
project on the `Brewerjg/turf` repo, the `quote_status` enum fix applied to the
live shared DB, Supabase auth allowlisted for the new domain, and a scripted
live verification pass. **Zero app-code changes** — 1e finished the code; 1f is
sequencing, config, and verification.

## Decisions (user-approved 2026-07-09)

1. **Web cutover only.** Native pressure builds (`com.pressurepro.app` iOS/
   Android, RevenueCat IAP) are a separate later effort, like turf's own mobile
   launch. Rationale: PressurePro has no paid customers (1 live quote; its
   PRODUCTION_TODO still lists P0 launch blockers), so there is no native user
   base to cut over.
2. **New Vercel project on the turf repo** (monorepo-style: two projects, one
   repo) with `VITE_VERTICAL=pressure` in project env. The existing pressure
   Vercel deploy stays untouched as instant rollback; delete it only after
   verification, in a later cleanup.
3. **Migration 0032 applied during 1f by the agent** via
   `supabase db query -f` (untracked-migration convention; never `db push`).
4. **`pressure-pro-quoter` repo retirement is OUT of 1f** (user choice).
5. **No `build:pressure` npm script** — it would need a `cross-env` devDep for
   Windows; Vercel sets the env var in project settings, and local pressure
   builds use `$env:VITE_VERTICAL='pressure'; npm run build` (documented in the
   runbook).

## Verified facts (recon 2026-07-09)

- **`.env` is NOT committed** (`git ls-files .env*` → empty). On Vercel the
  dashboard env vars are the *only* env source — no precedence fight with a
  committed `VITE_VERTICAL=lawn`. `vite.config.ts` (`loadEnv(mode, cwd, "")`)
  and `src/vertical.ts` (`import.meta.env.VITE_VERTICAL ?? "lawn"`) both read
  it; the `@active-theme` alias resolves `src/verticals/pressure/theme.css`.
- **Client env surface** (grep `import.meta.env`): `VITE_VERTICAL`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_PAYMENTS_CLIENT_TOKEN` (optional at build; `getStripe()` rejects at
  call time if unset), `VITE_PUBLIC_APP_ORIGIN` + `VITE_REVENUECAT_*`
  (native-only — not needed for the web project).
- **`vercel.json` is vertical-agnostic** (SPA rewrite + cache headers) — serves
  both projects unchanged.
- **Migration `0032_pressure_quote_status_expired.sql`**: single
  `ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'expired';` —
  additive, idempotent, cannot run inside a transaction block, harmless to
  lawn (which never writes 'expired'). Pressure Quotes/QuoteDetail write it
  when auto-expiring stale quotes; those writes fail on the live enum today.
- **Old pressure deploy**: Vite SPA from `Brewerjg/pressure-pro-quoter` with
  its own `vercel.json`; same Supabase project at runtime, so both old and new
  deploys read the same data during the overlap window.

## Plan of record

### Task A — cutover runbook (repo artifact)

`docs/runbooks/pressure-web-cutover.md`: the ordered checklist below with exact
commands/URLs, the env-var table for the new Vercel project, the Supabase auth
allowlist steps, the verification list, and the rollback statement. This is the
only file 1f adds.

### Task B — DB gate: apply migration 0032

- `supabase db query -f supabase/migrations/0032_pressure_quote_status_expired.sql --linked`
  (standalone statement).
- Verify: `SELECT unnest(enum_range(NULL::public.quote_status));` includes
  `expired`.
- No rollback needed (additive; removing an enum value is not supported and
  not required — lawn ignores it).

### Task C — Vercel project (user drives, agent scripts)

User creates project `pressurepro` (name flexible) in the Vercel dashboard:
- Import `Brewerjg/turf`, framework Vite (auto from `vercel.json`).
- Env vars (all environments): `VITE_VERTICAL=pressure`, plus
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` /
  `VITE_PAYMENTS_CLIENT_TOKEN` copied from the turf project.
- Deploy `main`; note the production URL (e.g. `pressurepro-*.vercel.app`).

### Task D — Supabase auth allowlist

Dashboard → Authentication → URL Configuration: add the new production URL to
Additional Redirect URLs (magic links, OAuth callbacks, password reset). Site
URL stays turf's (shared project; redirect list is additive). If Google OAuth
is enabled, its authorized origins likewise gain the new domain.

### Task E — live verification (agent drives via Playwright)

Against the deployed pressure URL:
1. **Boot + brand**: navy theme (`--brand-800` 220 65% 18%), PressurePro name,
   5 tabs (Home/Customers/Quotes/Schedule/Settings), Mix Calc home tile.
2. **Auth**: demo login (creates `demo-*@pressurepro.demo`); session persists
   on reload.
3. **Onboarding + seed**: fresh demo account onboards; surface-pricing seed
   (7 surfaces) lands in `surface_pricing` with `app='pressurepro'` semantics.
4. **Quotes**: create a quote with surface lines (sqft × rate, soft/power
   mode), describe() rendering on card/detail; accept link opens; quote
   auto-expiry write (`status='expired'`) succeeds post-0032 if reproducible.
5. **/mix**: recipe math for house (50 gal / 12.5% stock / 1% target → 4 gal
   SH, 46 gal water, 50 oz surfactant).
6. **Settings**: SurfacePricingEditor matrix loads/saves.
7. **Plans**: flat-billing plan create (no lawn cadence sections).
8. **Campaigns**: 6 pressure templates render; merge tags substitute.
9. **Live data**: existing `app='pressurepro'` rows (the 1 live quote, 84
   surface_pricing rows) render correctly.
10. **Lawn regression spot-check**: turf-jade.vercel.app still lawn-branded
    after the (no-op for lawn) DB change.

Known-gap flags (verified only to the Stripe boundary, not through payment):
pp_* Stripe price IDs vs the live Stripe account; paid-tier checkout.

### Rollback

Delete (or ignore) the new Vercel project; the old pressure deploy was never
touched. DB change needs no rollback. Lawn is untouched throughout (no code
changes, additive-only DB change).

## Testing

No new unit tests (no code). The 1e suite (93 tests) must stay green on the
branch; tsc 6-file baseline holds. The deliverable "test" is the Task E
verification transcript recorded in the runbook.

## Out of scope (1f)

- Native pressure builds, capacitor config gating, RevenueCat/IAP for pressure.
- Retiring/archiving `pressure-pro-quoter` (user deferred).
- Deleting the old pressure Vercel project (post-verification cleanup, later).
- Stripe pp_* price-ID reconciliation with the live Stripe account (flagged).
- Weather washing-window; 0c-5 season seam (still deferred).
- Custom domain for the pressure app (vercel.app subdomain is fine for now).
