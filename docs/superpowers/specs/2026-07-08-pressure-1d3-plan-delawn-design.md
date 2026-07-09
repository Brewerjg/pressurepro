# Phase 1 slice 1d-3 — pressure plan-cadence + Plans de-lawn design

Status: approved phase + approach; ready for planning.
Date: 2026-07-08.
Parent: `2026-07-08-pressure-vertical-phase1-design.md`. Final 1d sub-slice
(after 1d-1 config, 1d-2 billing). The hardest slice — shared-page surgery.

## Purpose

Make the shared plan screens (`NewPlan`, `PlanDetail`, `ConvertToPlanForm`) serve
BOTH lawn (unchanged) and a pressure vertical whose plans are a **flat `amount`
charged every `interval_months`** — no service frequency, route day, season
pause, or `plan_kind` semantics. Done via feature flags on `PlanCadenceModule`
that default to lawn's current behavior. Not registered (register-last, 1e).

## Contract — `PlanCadenceModule` gains 5 flags (`src/verticals/plan-cadence.ts`)

```ts
  /** "per-visit" = amount = perVisitRate × visitsPerMonth × interval; "flat" = amount entered directly. */
  billingModel: "per-visit" | "flat";
  /** Show the service-frequency picker (weekly/biweekly/…). */
  hasServiceFrequency: boolean;
  /** Show the day-of-week "route day" picker. */
  hasRouteDay: boolean;
  /** Show the season-pause controls. */
  hasSeasonPause: boolean;
  /** plan_kind written when there is no frequency-derived kind. */
  defaultPlanKind: string;
```

- **`lawnPlanCadence`** (`lawn/plan-cadence.ts`): `billingModel: "per-visit"`,
  `hasServiceFrequency: true`, `hasRouteDay: true`, `hasSeasonPause: true`,
  `defaultPlanKind: "mow"` — the current behavior, so lawn is byte-identical.
- **`pressurePlanCadence`** (`pressure/plan-cadence.ts`, NEW): `billingModel:
  "flat"`, the three `has*` flags `false`, `defaultPlanKind: "other"`. Supplies
  the existing `PlanCadenceModule` fields with no-op values: `frequencies: []`,
  `defaultFrequency: "weekly"` (a valid DB `frequency` value, semantically unused),
  `defaultIntervalMonths: 3`, `frequencyLabel: (k) => k`, `visitsPerMonth: () => 0`,
  `suggestFrequency: () => "weekly"`, `seasonSwap: { planKind: "other",
  frequencies: [] }`.

## Core principle — keep the DB payload SHAPE constant, compute values per-vertical

Rather than conditionally omitting columns (which would ripple into `NewPlanInput`
and the plan-creation edge function), the plan insert/update ALWAYS writes the
same columns; only their VALUES vary by vertical:
- `amount`: pressure = the flat amount input; lawn = `calcBillingAmount(...)` (+ override).
- `per_visit_rate`: pressure = `null` (`NewPlanInput.per_visit_rate` is already
  `number | null`); lawn = `perVisitNum`.
- `plan_kind`: `hasServiceFrequency ? <lawn derivation> : defaultPlanKind`
  (pressure → `"other"`).
- `frequency` / `day_of_week` / `season_pause`: pressure leaves the existing
  state at its defaults (`"weekly"` / `3` / `[]`) — WRITTEN but never read by the
  pressure app, so harmless (the columns are `NOT NULL DEFAULT`/nullable). No
  edge-function or `NewPlanInput` change.

## Per-file de-lawn (guards; lawn flags = true/per-visit → renders exactly as today)

### `src/pages/NewPlan.tsx`
- **Billing branch** (~155-170 submit + ~220-224 preview): if `billingModel ===
  "flat"`, `amountNum = Number(amountOverride)` (reuse `amountOverride` as the
  pressure amount input), require `> 0`, set `per_visit_rate: null`, and skip the
  per-visit validation; else the current per-visit logic.
- **Amount input**: pressure shows a single "Plan amount" `$`-input bound to
  `amountOverride`; lawn shows the per-visit-rate input (~414-431) + the
  billing-math card (~436-482) — both wrapped `{planCadence.billingModel ===
  "per-visit" && ( … )}`.
- **Guard sections** (self-contained `<Section>` blocks): frequency picker
  (~352-380) `{hasServiceFrequency && …}`; route-day picker (~382-407)
  `{hasRouteDay && …}`; season pause (~524-549) `{hasSeasonPause && …}`.
- **`planKind`**: the frequency-derivation `useEffect` (~84-89) becomes a no-op for
  pressure (guard `if (!hasServiceFrequency) return;` inside it, or initialize
  `planKind` from `defaultPlanKind`); the insert (~195) writes `hasServiceFrequency
  ? planKind : defaultPlanKind`.
- **Labels** (~229-236): `perVisitLabel`/`visitsPerMonthLabel` used only inside the
  per-visit branch — untouched for lawn.

### `src/pages/PlanDetail.tsx`
- **SummaryCard (read, ~590-657):** guard the Frequency/Route-day `<Stat>`s
  (`hasServiceFrequency`/`hasRouteDay`) and the seasonal-pauses block
  (`hasSeasonPause`); skip the `freqLabel`/`dayLabel` derivations for pressure.
- **EditCard:** guard the frequency picker (~732-754), day picker (~756-778),
  season pause (~834-856); `plan_kind` in the save (~710-716) becomes
  `hasServiceFrequency ? <derivation> : defaultPlanKind`; the amount/billing-cadence
  grid (~780-816) stays (amount label may read "Plan amount" for flat); the save
  payload keeps its shape (day/frequency/season default states written harmlessly).

### `src/components/quotes/ConvertToPlanForm.tsx`
- **`billingPreview` (~157-170):** if `billingModel === "flat"`, `total =
  effectiveRate × intervalMonths` with a `"flat"` label; else the current
  visits-based math.
- **Guard sections:** frequency picker (~593-620) `{hasServiceFrequency && …}`;
  day picker (~622-650) `{hasRouteDay && …}`.
- **State/effects:** `frequency` init + the auto-suggest `useEffect` (~135-139)
  guarded by `hasServiceFrequency` (`if (!hasServiceFrequency) return;`).
- **`onSubmit` (~269-280):** keep shape; `per_visit_rate`/`frequency`/`day_of_week`
  computed per-vertical (pressure: null / default / default).

## Testing

- `src/verticals/pressure/plan-cadence.test.ts`: `pressurePlanCadence.billingModel
  === "flat"`; the three `has*` flags `false`; `defaultPlanKind === "other"`;
  `frequencies` empty; `defaultFrequency === "weekly"`.
- `src/verticals/lawn/plan-cadence.test.ts`: extend to assert the new flags —
  `billingModel === "per-visit"`, all `has*` `true`, `defaultPlanKind === "mow"`.
- The shared pages have no unit tests (as today) — their lawn-identity is the
  whole-branch review's job; **tsc stays at the 6-file baseline** (`NewPlan`,
  `PlanDetail`, `ConvertToPlanForm` must NOT become new errors — `Onboarding.tsx`
  count unchanged), and `npm run build` green.
- **Lawn identity:** with lawn's flags (`per-visit`/all true), every guard renders
  and every value computes exactly as before — verified page-by-page.

## Tasks

1. `PlanCadenceModule` flags + `lawnPlanCadence` flags + `pressurePlanCadence` + tests.
2. De-lawn `NewPlan` (section guards + flat-billing branch + amount input).
3. De-lawn `PlanDetail` (SummaryCard + EditCard guards + save).
4. De-lawn `ConvertToPlanForm` (billingPreview + section guards + submit).

## Out of scope (1d-3)

- Registering `pressureVertical` (1e); assembling the index.
- Any `NewPlanInput`/edge-function/`maintenance_plans` schema change (payload shape
  is preserved).
- The `season.ts` season-swap engine (already reads `planCadence.seasonSwap`;
  pressure's is empty → inert).
- Recurrence/scheduling math in `planned-jobs.ts`/`next-visit.ts` (pressure plans
  are billing-only; those functions aren't invoked for flat plans).
- Any lawn behavior change.
