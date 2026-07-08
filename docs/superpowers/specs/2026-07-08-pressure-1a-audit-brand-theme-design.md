# Phase 1 slice 1a — compatibility audit + brand + theme design

Status: approved phase; this slice's design ready for planning.
Date: 2026-07-08.
Parent: `2026-07-08-pressure-vertical-phase1-design.md`.

## Purpose

1a is the **gating slice** of Phase 1 (pressure vertical, full cutover). It (a)
records the DB + codebase compatibility audit that the whole phase depends on,
(b) delivers the first two concrete artifacts — the pressure **theme** and the
recorded **brand** values — and (c) creates the one required DB migration
(`quote_status` `'expired'`). No registration, no prod writes (the migration is
authored here, applied in 1f).

## Audit results (authoritative — file analysis + live read-only queries)

Live DB = shared Supabase project `dkksryutecjbyuscpxdb` (linked project name:
"Pressure"; both apps connect here at runtime). Live footprint is tiny —
**quotes: turfpro 5 / pressurepro 1; maintenance_plans: turfpro 3 / pressurepro
0; surface_pricing: 84; catalog_items: turfpro 242 / pressurepro 0** — so the
cutover carries near-zero live-customer risk.

### DB compatibility: GREEN (no data migration, no breaking DDL)

Confirmed against the live schema:

- **`surface_pricing` exists** with `UNIQUE (user_id, surface_type, mode)` (the
  seed's `ON CONFLICT` target). `catalog_items` has `surface_type` + `mode`.
  `subscriptions` has `source` + `revenuecat_subscriber_id`. `quotes` has
  `expires_at` + `qbo_synced_at`. `invoices`, `campaigns`, `manual_payments`,
  `push_tokens`, `processed_stripe_events` all exist.
- **No lawn migration breaks pressure rows.** Every column turf's
  `0001_turfpro_lawn_care.sql` (and later) adds to shared tables is nullable or
  `NOT NULL DEFAULT` that satisfies its own CHECK; every new CHECK is on a new
  lawn column pressure never writes. `0021` widened `interval_months` to
  `(1,3,6,12)` — pressure's `3|6|12` stays valid. No drops/renames/type changes.
- **Both RPCs pressure calls exist** (`public_business_info`,
  `get_invoice_by_token`).
- **Live signup trigger** `handle_new_user` seeds `surface_pricing` (pressure),
  not lawn catalog — so pressure new-users auto-seed surfaces; lawn seeds its
  catalog in app code. (Lawn users also get harmless surface_pricing rows.)
- **Inbox**: the live table is **`sms_log`** (not `sms_inbox`/`customer_comms`,
  which do not exist); the unified `Inbox.tsx` already reads `sms_log`. Compatible.

### The one DB fix

- 🔴 **`quote_status` enum is `{draft,sent,accepted,scheduled,complete,paid}` —
  missing `'expired'`.** Pressure writes `status='expired'` (auto-expiring stale
  quotes, `Quotes.tsx`/`QuoteDetail.tsx`); those writes fail on the live enum
  today. Fix: `ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'expired';`
  Authored as a migration here; **applied in 1f** (or earlier with explicit
  authorization — it is additive and backward-compatible).

### Codebase findings that widen the phase (slotted into existing slices)

The DB is ready; the real work is de-lawn-ing shared code. These are folded into
later slices (no new top-level slices):

- **Deep-link scheme** `turfpro://` hardcoded (`Auth.tsx`, `auth-deep-link.ts`)
  → derive from vertical. **→ 1e** (needs `brand.deepLinkScheme`; lawn = "turfpro").
- **Stripe price IDs** `turfpro_*` hardcoded (`stripe.ts`) → pressure needs
  `pressurepro_*`. **→ 1d** as a small billing config seam.
- **Catalog**: seed fallback inserts to `catalog_items`, but pressure seeds
  `surface_pricing`; `CatalogEditor` reads only `catalog_items`. **→ 1c** (widen
  `CatalogSeedItem` with `surface_type?`/`mode?` + route the fallback/editor).
- **Shared Plans pages** (`NewPlan`/`Plans`/`PlanDetail`) hardcode
  `"mow"`/`"fert_program"`; pressure uses plans. **→ 1d** (drive from
  `vertical.planCadence`).
- Low-priority: `offline-cache.ts` `turfpro_` storage-key prefix (data hygiene,
  not logic) — note, defer.

## 1a deliverables

### A. This audit report (committed as this spec). Consumed by 1c/1d/1e/1f.

### B. `src/verticals/pressure/theme.css`

Mirrors `lawn/theme.css` structure exactly — the SAME 50 CSS custom properties
(shared components reference these names), with PressurePro's navy + safety-yellow
palette. Loaded via the existing `@active-theme` vite alias when
`VITE_VERTICAL=pressure`. Proposed values (HSL triplets, matching lawn's format):

```css
/* Pressure (PressurePro) theme — navy + safety-yellow. Palette only.
   Selected at build via the @active-theme alias (VITE_VERTICAL=pressure). */
:root {
  --background: 218 35% 97%;
  --foreground: 220 45% 12%;
  --card: 0 0% 100%;
  --card-foreground: 220 45% 12%;
  --popover: 0 0% 100%;
  --popover-foreground: 220 45% 12%;

  --brand-900: 220 65% 12%;
  --brand-800: 220 65% 18%;
  --brand-700: 218 55% 24%;
  --brand-600: 215 55% 32%;
  --brand-500: 213 45% 44%;
  --brand-100: 220 30% 88%;
  --brand-50:  220 33% 96%;

  --primary: 220 65% 18%;
  --primary-foreground: 48 100% 55%;

  --accent-700: 40 100% 38%;
  --accent-600: 42 100% 48%;
  --accent-500: 48 100% 55%;
  --accent-400: 50 100% 65%;
  --accent-100: 48 100% 92%;

  --accent: 48 100% 55%;
  --accent-foreground: 220 65% 12%;

  --neutral-900: 220 45% 12%;
  --neutral-800: 220 30% 20%;
  --neutral-700: 220 20% 30%;
  --neutral-500: 220 15% 46%;
  --neutral-400: 220 14% 60%;
  --neutral-300: 220 16% 78%;
  --neutral-200: 220 20% 88%;
  --neutral-100: 220 24% 94%;

  --secondary: 220 24% 94%;
  --secondary-foreground: 220 30% 20%;
  --muted: 220 20% 94%;
  --muted-foreground: 220 15% 42%;
  --hairline: 220 20% 92%;

  --destructive: 0 78% 52%;
  --destructive-foreground: 0 0% 100%;
  --destructive-bg: 0 78% 95%;
  --success: 152 60% 38%;
  --success-foreground: 0 0% 100%;
  --success-bg: 152 55% 92%;
  --warning: 32 95% 52%;
  --warning-foreground: 0 0% 100%;
  --warning-bg: 32 95% 93%;
  --info: 210 80% 48%;
  --info-bg: 210 80% 95%;

  /* Status semantics — defined so shared status pills never render undefined.
     Repurposed for pressure (wet/surface) but kept at generic values. */
  --rain: 210 80% 50%;
  --rain-bg: 210 80% 95%;
  --drought: 36 80% 50%;
  --drought-bg: 36 85% 95%;

  --border: 220 20% 88%;
  --input: 220 20% 88%;
  --ring: 220 65% 18%;
  --radius: 1rem;

  --gradient-hero-deep: linear-gradient(160deg,
    hsl(220 70% 10%) 0%,
    hsl(215 60% 22%) 60%,
    hsl(213 50% 30%) 100%);

  --shadow-accent: 0 8px 24px -8px hsl(48 100% 50% / 0.55);
  --shadow-card: 0 1px 2px hsl(220 45% 12% / 0.04), 0 1px 3px hsl(220 45% 12% / 0.06);
  --shadow-card-lg: 0 4px 12px hsl(220 45% 12% / 0.06), 0 1px 3px hsl(220 45% 12% / 0.05);
}
```

A **parity test** (`src/verticals/pressure/theme.test.ts`) asserts the pressure
theme defines exactly the same set of `--custom-property` names as
`lawn/theme.css` (parse both files, compare the var-name sets) — guarantees no
shared component hits an undefined var. This is a new test pattern; add an
equivalent guard for lawn is out of scope.

### C. `supabase/migrations/00NN_pressure_quote_status_expired.sql`

Single statement `ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS
'expired';` with a header comment (untracked-migration convention: applied via
`supabase db query`, per repo memory, NOT `db push`). **File only in 1a;
application gated to 1f.**

### D. Recorded brand values (applied at 1e assembly, NOT in 1a)

For `pressureVertical.brand`:
`name: "PressurePro"`, `tagline: "Pressure-washing quotes, scheduling, and
billing."`, `bundleId: "com.pressurepro.app"`, `themeColor: "#11203F"`,
`fallbackBusinessName: "Pressure Washing"`, `authTagline: "Quotes, plans, and
recurring wash-route ops."` Plus the phase-new field (added to the contract in
1e when its consumer lands): `deepLinkScheme: "pressurepro"` (lawn: "turfpro").

## Testing

- **Unit:** `pressure/theme.test.ts` var-name parity vs lawn (green).
- **tsc:** `npx tsc --noEmit -p tsconfig.app.json` stays at the known 6-file
  baseline (a new `.css` + `.test.ts` add no app type surface; nothing imports
  the pressure theme yet). No NEW file in the error set.
- **Build:** `npm run build` (lawn build) green — pressure theme is not yet
  referenced by any build.
- The migration is NOT applied in 1a (no live write); verification already done.

## Out of scope (1a)

- Assembling/registering `pressureVertical` (1e); consuming `deepLinkScheme` (1e).
- Applying the `'expired'` migration to prod (1f gate).
- Billing seam (1d), catalog widening (1c), Plans-page de-lawn-ing (1d).
- Any lawn behavior change; any new pressure feature.
