# Multi-vertical platform — one codebase, many trade apps (architecture design)

Status: approved architecture. First implementable slice is **Phase 0**; later
phases each get their own spec/plan cycle.
Date: 2026-07-04.

## Goal

Ship a family of trade-specific field-service apps (lawn care, pressure washing,
and future trades) that stay **familiar in UI and functionality** because they
are the *same app* with a per-trade configuration — not N forked codebases.
Today there are two forked apps (TurfPro, PressurePro) sharing one Supabase
project; every feature is currently built twice (QuickBooks, sync-status, the
localhost fix were each done twice). This design ends that.

## What the code audit established

- **The two apps are ~90% the same.** After PressurePro's parity waves, both
  have: auth, onboarding, customers/properties, quotes, plans, invoices,
  payments, paywall, comms (email/SMS/inbox), campaigns, photos, reports,
  QuickBooks, schedule, and the native Capacitor shell.
- **Each trade's domain logic is small and contained** (see inventory below).
- **The database is already vertical-aware**: the `app` discriminator
  (`turfpro`/`pressurepro`) tags the 5 operator tables (`quotes`,
  `maintenance_plans`, `catalog_items`, `photo_pairs`, `campaigns`);
  customers/properties are fully shared. `vertical.id` === the existing `app`
  value, so **no DB migration and no data-model change** are required.

## Decision

**Approach B — single codebase, config-driven verticals.** One app repo; a
`verticals/` directory with one typed config module per trade; the build selects
a vertical via `VITE_VERTICAL`. Chosen over a monorepo-of-packages (more
ceremony than needed now; can harden into that later) and over a
shared-package-across-repos (doesn't escape the multi-repo fork/drift problem).

**Base repo = TurfPro** — the most mature core and the superset of generic
routes/calculators. PressurePro becomes the second vertical and its repo is
retired at Phase 2.

## The vertical contract

Each trade is one config module (`src/verticals/<trade>/index.ts`) exporting a
`Vertical`. The shared core provides all generic features and delegates to the
active vertical only at these seams:

```ts
interface Vertical {
  id: AppId;                    // "turfpro" | "pressurepro" | ... → the DB `app` value

  brand: {
    name: string;              // "TurfPro"
    tagline: string;
    bundleId: string;          // Capacitor appId, e.g. com.turfpro.app
    themeColor: string;        // status-bar / theme-color
  };

  theme: VerticalTheme;        // palette expressed as CSS-custom-property values,
                               // injected at build (the core references SEMANTIC
                               // tokens only — primary/accent/muted/success/…).

  quoteLine: {                 // THE deepest seam — how this trade quotes
    Editor: ComponentType<QuoteLineEditorProps>;   // the line-item builder UI
    lineTotal(line): number;
    quoteTotal(lines): number;
    describe(line): string;                         // per-line display label
    summarize(lines): string;                       // QBO description / SMS text
    toQboLines(input, itemId): QboInvoiceLine[];    // QuickBooks mapping
  };

  catalog: { seed: CatalogSeed; editorConfig: CatalogEditorConfig };

  plan?: { cadenceOptions: CadenceOption[]; seasonPause: boolean };

  calculators?: CalculatorDef[]; // optional trade tools → extra routes
                                 // lawn: ApplicationCalc, ChemicalLog, GDD; PW: MixCalculator

  weather?: WeatherSemantics;    // optional derived verdicts (mow/spray/fert | wash-day)

  propertyFields?: FieldSpec[];  // extra PropertyDetail fields (DB columns already exist, nullable)

  copy: { campaignTemplates: CampaignTemplate[]; labels: Record<string, string> };

  extraRoutes?: RouteDef[];      // vertical-only routes (lawn Routes/RouteMode/season; PW /mix)
}
```

### Selection & build

- `VITE_VERTICAL=lawn|pressure|…` selects the active vertical (default `lawn`).
- `src/vertical.ts` resolves `verticals[import.meta.env.VITE_VERTICAL]` and
  exports the active `vertical` (fails the build fast on an unknown/unset value).
- The core consumes it: `APP_ID = vertical.id`; inject `vertical.theme` CSS vars;
  compose generic routes + `vertical.extraRoutes` + `vertical.calculators`
  routes; render the quote builder via `vertical.quoteLine.*`; seed onboarding
  from `vertical.catalog.seed`; QuickBooks sync uses `vertical.quoteLine.toQboLines`.
- A per-trade app = one vertical module + a Capacitor config + a build env.
  Deploy = `VITE_VERTICAL=x vite build` → that trade's own web + native build.

## Shared-core / vertical-pack inventory (from the audit)

**Shared core (built once, identical for every trade):** auth; onboarding shell;
customers/properties CRM; quotes lifecycle (list/detail/accept/print); invoices;
plans + plan portal; payments (Stripe deposit/balance + manual cash/check);
paywall/trial/dunning; pricing/checkout; QuickBooks connect + sync orchestration;
comms (email/SMS/inbox) + campaign infrastructure; photos + gallery; schedule;
reports; native Capacitor shell (keyboard, deep-link auth, push, camera, offline);
app shell/tab bar/auth gates; the public customer-facing pages.

**Lawn vertical pack (extract to `verticals/lawn`):**
`components/onboarding/seedCatalog.ts` (catalog seed), `components/settings/CatalogEditor.tsx`
(lawn defaults), `pages/ApplicationCalc.tsx` + `pages/ChemicalLog.tsx` +
`components/calc/`, `lib/gdd.ts` + `components/gdd/`, `lib/season.ts` +
`components/season/`, `lib/weather.ts` verdict layer + `components/weather/`,
`pages/NewPlan.tsx` cadence (`VISITS_PER_MONTH`, `fert_program`, season pause),
`lib/planned-jobs.ts` + `lib/next-visit.ts` recurrence, `components/campaigns/templates.ts`
(lawn copy), the lawn `PropertyDetail` field block, green/bronze theme in
`index.css`, and the lawn edge functions (`compute-gdd`, `forecast` verdicts,
`swap-season`). The quote line is `{ name, qty, rate, total }`.

**Pressure-washing vertical pack (Phase 1, from PressurePro):**
`SURFACE_META`, `SH_TARGETS`, `computeMix`, `FALLBACK_RATES`, `SEASONAL_MULTIPLIERS`,
`sqft×rate×mode` pricing (in `store.ts`), `ModeToggle.tsx`, `MixCalculator.tsx`,
surface `seedCatalog.ts`, PW `campaigns/templates.ts`, `washDayVerdict`, the
navy/yellow theme. The quote line is `{ surface, sqft, rate, mode }`.

## Incremental migration path (both apps stay live)

- **Phase 0 — build the seam in TurfPro (behavior-identical).** Introduce the
  `Vertical` interface + `verticals/lawn` capturing TurfPro's current domain
  specifics behind it; wire the core to consume `vertical` (default
  `VITE_VERTICAL=lawn`). No user-visible change; TurfPro keeps shipping. Proves
  the seam with one vertical. **This is the first plan/build cycle.**
- **Phase 1 — add the pressure vertical.** Port PressurePro's domain pack into
  `verticals/pressure` behind the same interface. `VITE_VERTICAL=pressure` builds
  the PressurePro app from the unified codebase; validate against current PP.
- **Phase 2 — cut PressurePro over, retire its repo.** Point PressurePro's web +
  native deploys at the unified repo's `pressure` build; freeze
  `pressure-pro-quoter`. One codebase, two verticals, both live.
- **Phase 3+ — new trades are configs.** A new `verticals/<trade>` + Capacitor
  config; no fork.

## Hard parts / risks

1. **Quote-line divergence is the deepest seam.** Lawn `{name,qty,rate,total}`
   vs PW `{surface,sqft,rate,mode}` in the same `quotes.lines` JSONB. The vertical
   owns the editor + math + display + QBO mapping. Mitigated because the QBO
   mapping is already per-vertical (`buildInvoiceLines` vs `buildQuoteInvoiceLine`).
   Requires a clean `QuoteLineEditorProps` contract in Phase 0.
2. **Theme normalization.** TurfPro references named tokens (`green`/`bronze`/`ink`);
   the core must use semantic tokens so palettes swap per vertical. Broad but
   mechanical className work; part of Phase 0.
3. **Route/tab composition.** Router + tab bar compose generic + vertical routes;
   lawn-only Routes/RouteMode/season and PW-only `/mix` become `extraRoutes`.
4. **Two-live-apps discipline.** Phased; PressurePro is not cut over until its
   unified build is validated against the current app.
5. **Edge functions are already shared** (one Supabase project) and largely
   vertical-agnostic; the few lawn-specific ones stay as-is and are simply unused
   by other verticals.

## Testing

- The core keeps its existing vitest suite.
- Each vertical's pure logic (pricing, chemistry/quote-line math, `toQboLines`,
  catalog seed) gets unit tests.
- A "vertical conformance" test asserts each registered vertical satisfies the
  `Vertical` interface (all required seams present, `id` matches a known `app`).

## Out of scope (this architecture spec)

- Building any vertical beyond wiring `verticals/lawn` in Phase 0.
- Monorepo/package tooling (approach A) — a later evolution only if needed.
- DB/schema changes (none required; `app` discriminator already carries `vertical.id`).
- Stripe Connect / billing-model changes.

## Next step

Plan **Phase 0** first: introduce the `Vertical` interface, the `VITE_VERTICAL`
selection, the `verticals/lawn` extraction, and the theme-token normalization —
all behavior-identical to today's TurfPro. Phases 1–3 get their own cycles.
