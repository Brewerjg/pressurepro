# Phase 1 — Pressure vertical (full cutover) design

Status: approved phase-level design; per-slice specs/plans follow.
Date: 2026-07-08.

## Context

Part of the multi-vertical platform (converge TurfPro + PressurePro into ONE
config-driven codebase; base repo = turf). Phase 0 built the seam
(`src/verticals/`, `VITE_VERTICAL`, registry, resolver) and Phase 0c extracted
the lawn domain behind a 10-seam `Vertical` contract. **Phase 1 adds the
`pressure` vertical** — porting PressurePro's domain pack into
`src/verticals/pressure/` — and, per user decision, goes all the way to **full
cutover**: author config → flip the live pressure deployment to the unified
build → retire the `pressure-pro-quoter` repo.

### Confirmed facts (recon 2026-07-08)

- **One shared database.** Both repos connect at runtime to the same Supabase
  project `dkksryutecjbyuscpxdb.supabase.co` (turf's `VITE_SUPABASE_URL`;
  pressure's `client.ts` hardcodes the same URL as its fallback). Live pressure
  data already co-resides in the shared DB, discriminated by `app='pressurepro'`.
  **Cutover requires NO cross-database data migration.** (pressure's
  `config.toml` has a stale `project_id = "gevwhwloyoavrdbjcbue"` — a CLI-link
  artifact, not the runtime target.)
- **Turf's schema descends from PressurePro's.** `0001_turfpro_lawn_care.sql`
  states "interval_months CHECK from PressurePro is (3, 6, 12) and stays as-is";
  the shared DB already has `maintenance_plans.interval_months` (now `1,3,6,12`),
  `catalog_items` (kind/unit/default_rate/min_charge), and `quotes.lines` JSONB.
- **`quotes.lines` is shape-agnostic.** 0c-1b loosened the shared `QuoteLine`
  type to opaque `{id,total,[k]:unknown}`, so shared display screens render
  pressure's `SurfaceLine` without change. This is the linchpin that makes the
  quote-line port a vertical-local concern.
- The dominant risk is therefore **schema/query compatibility** (does the unified
  codebase read/write `app='pressurepro'` rows correctly against the shared DB?),
  NOT data migration.

### PressurePro domain pack (source: `C:\Users\Jason\Desktop\pressure-pro-quoter`)

- **Quote line** (`src/lib/store.ts:51-59`): `SurfaceLine { id; surface:
  SurfaceKey; sqft: number; rate: number; mode: JobMode; label?: string;
  custom?: boolean }`. `SurfaceKey = concrete|siding|roof|deck|fence|driveway|
  house`; `JobMode = soft|power`. `lineTotal = round(sqft*rate, 2)`. Editor is
  inline in `NewQuote.tsx:257-327` (emoji surface picker, sqft, $/sqft, ModeToggle;
  custom lines = flat amount with sqft=1). Display consumers: QuoteDetail, QuotePrint
  (table Service/Qty/Rate/Amount), Accept, InvoicePrint, InvoiceDetail.
- **Catalog / pricing**: `surface_pricing` table (per-user seed, 7 surfaces ×
  soft/power with `default_rate`, `min_charge`, `unit ∈ sqft|linear_ft|flat`) +
  `catalog_items` (kind service|chemical, surface_type, mode, unit). `SURFACE_META`
  (label+emoji+recommended mode). Seed `seedCatalog.ts`: concrete 0.20/power/min150,
  siding 0.15/soft/min200, roof 0.40/soft/min350, deck 1.50/soft/min200, fence
  3.00/linear_ft/soft/min150, driveway 0.18/power/min150, house 0.25/soft/min250.
  `seasonalRate()` bumps roof in spring / discounts driveway in winter.
- **Plans**: `interval_months ∈ 3|6|12`, `services: SurfaceKey[]`; surfaces "Maintenance
  Plans / Recurring revenue". Conversion quote→plan.
- **Calculator**: `/mix` MixCalculator — soft-wash sodium-hypochlorite recipe
  (SH stock gal, water gal, surfactant oz, cost) per surface targets.
- **Theme**: navy `--navy-900 #11203F` primary + safety-yellow `--yellow-500
  #E6B800` accent; fonts Archivo/Inter/JetBrains Mono; navy hero gradients + a
  subtle `--gradient-water`.
- **Nav**: tabs Home/Customers/Quotes/Schedule/Settings; home tiles Mix Calc + Plans.
  Pressure-only routes: `/mix`, plus pressure-flavored `/campaigns`.
- **Campaigns** (`campaigns/templates.ts`): spring_signup, pre_winter_wash,
  fence_deck_refresh, commercial_requote, roof_softwash, custom. Merge tags
  `{firstName}`, `{businessName}`.
- **Property fields**: `dog_warning` (bool), `gate_code` (text), `surface_notes`
  (textarea). (Plus `sqft` — lives on the Property card, out of the fields seam,
  mirroring lawn's turf_sqft.)
- **Brand/copy**: name "PressurePro"; bundle `com.pressurepro.app`; themeColor
  `#11203F`; fallback business name "Pressure Washing"; business placeholder
  "Acme Pressure Washing"; onboarding catalog "Surface pricing / We pre-loaded
  standard rates for the seven core surfaces…"; quote recurring blurb "We'll reach
  out every {months} months to keep things looking sharp."; MixCalc eyebrow
  "SOFT-WASH". (No distinct auth tagline today — one will be authored.)

## Architecture

- `src/verticals/pressure/` mirrors `lawn/`: `index.ts` (`pressureVertical`),
  `theme.css`, and one module per seam (`quote-line.tsx`, `catalog.ts`,
  `plan-cadence.ts`, `campaigns.ts`, `property-fields.ts`, `copy.ts`, `shell.tsx`),
  each with a `.test.ts`. `id: "pressurepro"` (already in the `AppId` union).
- **Register last.** The `Vertical` contract requires all 10 seams; `pressureVertical`
  cannot typecheck until every module exists. So modules are authored across slices
  1a–1e, and `registry.ts` gains `pressure: pressureVertical` only in 1e, when the
  object is complete and a `VITE_VERTICAL=pressure` build can boot.
- **Cut over last.** Production deploy flip + repo retirement is the final slice
  (1f), after a green dev boot + smoke test.
- **Behavior-identical for lawn throughout.** No slice may change lawn behavior;
  the tsc baseline gate (6 known files) holds every slice.

## Slice decomposition

Each slice = its own spec + plan + subagent-driven execution + task reviews +
whole-branch review + merge, per the 0c cadence.

- **1a — compatibility audit + brand + theme.** (Gating.) Audit that the unified
  codebase's queries/RPCs/generated types serve `app='pressurepro'` rows against
  the shared DB, and reconcile the catalog/pricing schema gap (does the shared DB
  have `surface_pricing` and `catalog_items.surface_type/mode`? decide: reuse
  existing tables vs. a tracked migration). Deliver `pressure/theme.css` (navy/
  yellow normalized to `brand/accent/neutral` shade scales, matching the lawn
  theme's structure) and the pressure `brand` block. Output includes a written
  compatibility report that later slices consume.
- **1b — quoteLine.** `pressure/quote-line.tsx`: `pressureQuoteLine:
  QuoteLineModule` — parse/normalize `SurfaceLine`, `total = sqft*rate`,
  `LineEditor` (surface picker + sqft + rate + ModeToggle + custom flat), and
  `describe()` producing `{label,detail,qty,rate,amount}` for the 6 shared display
  consumers. Mirrors lawn 0c-1a/1b.
- **1c — catalog.** `pressure/catalog.ts`: `pressureCatalog: CatalogModule` —
  surface seed (7×modes, min_charge), `serviceKind`, editor copy/defaultUnit.
  Fit the existing `CatalogModule`; widen it only if surface pricing genuinely
  cannot be expressed (decision recorded from 1a's audit).
- **1d — cadence + campaigns + fields + copy.** Four data-port modules:
  `pressure/plan-cadence.ts` (3/6/12 mo + labels), `campaigns.ts` (6 templates +
  copy), `property-fields.ts` (dog_warning/gate_code/surface_notes), `copy.ts`
  (the ~17 CopyModule keys). May be executed as sub-tasks within one slice.
- **1e — shell + assemble + register.** `pressure/shell.tsx` (`/mix` route +
  MixCalculator port, nav entries, home tiles); assemble `pressureVertical` in
  `index.ts`; register `pressure` in `registry.ts`; wire `VITE_VERTICAL=pressure`
  build (theme alias, capacitor/native config for `com.pressurepro.app`); boot +
  smoke-test the pressure build in dev against the shared DB.
- **1f — production cutover + retire repo.** Point pressure's Vercel + native
  builds at the unified codebase; verify against the live shared DB with an
  explicit checklist; rollback plan; archive/retire `pressure-pro-quoter`. User
  drives the actual deploy flip.

## Decisions

1. **Full cutover, one shared DB, no data migration** (confirmed).
2. **Register + cut over last**; author modules unregistered first.
3. **Port `SurfaceLine` verbatim** through the quote-line seam (the seam already
   supports opaque lines); do not redesign the pressure pricing model.
4. **Weather "washing window" deferred.** Pressure's Schedule ships on the shared
   forecast without the pressure weather-verdict (the unbuilt 0c-5c seam); added
   later. A conscious parity gap.
5. **MixCalculator ports as a pressure `extraRoute`** (like lawn's /calc), not
   shared core.
6. **Behavior-identical for lawn** every slice; tsc baseline (6 files) holds.

## Testing

- **Per slice:** vitest unit tests per module (mirroring lawn's module tests);
  `npx tsc --noEmit -p tsconfig.app.json` stays at the known 6-file baseline (no
  NEW file); `npm run build` (lawn build) green.
- **1e:** a `VITE_VERTICAL=pressure` build compiles, boots, and renders core
  surfaces in dev against the shared DB (quotes with SurfaceLines, catalog,
  plans, mix calc).
- **1f:** production verification checklist (auth, quote create/accept, invoice,
  plan portal, campaigns, gallery) against live `app='pressurepro'` data, with a
  documented rollback (revert the deploy pointer).

## Risks

- **Schema/query drift:** lawn migrations altered shared tables; a pressure-shape
  row could hit a lawn-added NOT NULL/CHECK. 1a's audit is the mitigation.
- **Catalog/pricing model fit:** `surface_pricing` + `min_charge` + `seasonalRate`
  may not map cleanly onto the lawn-shaped `CatalogModule`; 1a decides reuse vs.
  migration vs. seam widening.
- **Native/deploy cutover (1f):** two bundle IDs / two app-store listings; the
  flip must not break lawn's deployment. Handled with explicit config gating and
  user-driven rollout.

## Out of scope (Phase 1)

- Weather washing-window verdict (deferred 0c-5c).
- Any NEW pressure features beyond current PressurePro parity.
- Retiring lawn or changing lawn behavior.
- The deferred 0c-5 lawn weather/season seam.
