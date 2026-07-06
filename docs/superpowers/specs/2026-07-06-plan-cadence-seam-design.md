# Phase 0c-4 — plan-cadence seam design

Status: approved design, ready for implementation planning.
Date: 2026-07-06.

## Context

Part of the multi-vertical platform (spec:
`2026-07-04-multi-vertical-platform-design.md`). **Phase 0c** extracts the lawn
domain behind the `Vertical` contract. **0c-1/0c-2/0c-3** built the quote-line,
catalog, and route/nav seams. **0c-4** (this) adds a `vertical.planCadence` config
module owning the trade-specific service-frequency model, and DRYs its definition
out of the five places it is currently copy-pasted.

### What the audit established

- **The lawn cadence model** on `maintenance_plans` (lawn columns added in
  `0001_turfpro_lawn_care.sql`, absent from generated types, read via
  `(supabase as any)`): `frequency` (`weekly|biweekly|monthly|fert_program`),
  `plan_kind` (`mow|fert_program|other`), `day_of_week`, `season_pause` (array),
  `schedule_anchor_date`. Billing `interval_months` (1/3/6/12) is a SEPARATE
  dimension.
- **The frequency definition is duplicated in FIVE places**, none shared:
  - `NewPlan.tsx` — `FREQ_OPTIONS` (key/label/sub) + `VISITS_PER_MONTH`.
  - `Plans.tsx` — `FREQUENCY_LABEL` map.
  - `PlanDetail.tsx` — `FREQUENCY_LABEL` map + `FREQ_OPTIONS` key list.
  - `ConvertToPlanForm.tsx` — `FREQ_OPTIONS` (labels **abbreviated**: fert = "Fert")
    + `VISITS_PER_MONTH`.
  - `convertHelpers.ts` — `suggestFrequency` heuristic.
- **The recurrence math** is pure and self-contained: `planned-jobs.ts`
  (`planOccursOn`/`plannedStopsForDate`, 211 lines) and `next-visit.ts`
  (`nextVisitDate`, 91 lines). No React, no Supabase. Only lawn's `/routes`
  (now in `extraRoutes`, 0c-3) and Home exercise it.
- **Season coupling is clean except one interlock:** `season.ts`'s
  `countAffectedPlans` and `swapSeasonFallback` hardcode
  `.eq("plan_kind","mow").in("frequency",["weekly","biweekly","monthly"])` — the
  set of plans a season swap pauses/resumes. This is the 0c-4/0c-5 boundary.
- **`plan_kind` auto-derivation** in NewPlan (`fert_program` frequency →
  `fert_program` kind, else `mow`, preserving `other`) is lawn business logic that
  STAYS in NewPlan.
- Pressure has NO cadence (one-off + billing interval only); a pressure vertical
  supplies its own `planCadence` (likely empty `frequencies`) in Phase 1.

## Decisions

1. **Add `planCadence: PlanCadenceModule` to the `Vertical` contract** (required —
   pressure supplies its own in Phase 1).
2. **The module owns the frequency CONFIG + two behaviors:** the frequency list
   (key/label/sub/visitsPerMonth), `defaultFrequency`, `defaultIntervalMonths`,
   `frequencyLabel`/`visitsPerMonth` lookups, `suggestFrequency`, and `seasonSwap`
   (the plan-set a season swap affects).
3. **The recurrence MATH stays in core** (`planned-jobs.ts`, `next-visit.ts`) —
   untouched. It is generic and only run for lawn. The `fert_program` route-skip
   stays there (routing is lawn-only).
4. **DRY all five copies** — the five consumers read from `vertical.planCadence`.
5. **Repair the season boundary now:** `season.ts` sources its swap filter from
   `vertical.planCadence.seasonSwap`. Season STATE (`useSeason`, the swap mutation,
   the `Season` type) stays for 0c-5.
6. **Behavior-identical for lawn**, with ONE deliberate cosmetic change:
   ConvertToPlanForm's frequency chips adopt the canonical labels, so its
   `fert_program` chip reads "Fert program" instead of "Fert".
7. **Consumer `frequency` STATE loosens to `string`.** The module's
   `suggestFrequency`/`defaultFrequency` and each `FrequencyOption.key` are `string`
   (frequency is now a config-driven open set). So the editable `frequency` state in
   NewPlan / PlanDetail / ConvertToPlanForm changes from the `"weekly"|…` union to
   `string`; the `fert_program` equality checks and DB writes work unchanged. The
   `LawnPlan` DB-row types (which document the stored union) stay as-is.

## The contract

New file `src/verticals/plan-cadence.ts`:

```ts
// A service-visit frequency this vertical offers.
export interface FrequencyOption {
  key: string;             // e.g. "weekly"
  label: string;           // e.g. "Weekly"
  sub: string;             // e.g. "Peak season mow" (NewPlan shows; others may ignore)
  visitsPerMonth: number;  // billing math (weekly 4, biweekly 2, monthly 1, fert 5/12)
}

// Everything trade-specific about recurring-service cadence. The recurrence MATH
// (planOccursOn/nextVisitDate) stays in the shared core; this configures which
// frequencies exist and what they mean.
export interface PlanCadenceModule {
  /** Ordered frequencies offered by this vertical. */
  frequencies: readonly FrequencyOption[];
  /** Default frequency key for a new plan. */
  defaultFrequency: string;
  /** Default billing interval (months) for a new plan. */
  defaultIntervalMonths: number;
  /** Display label for a frequency key (falls back to the key). */
  frequencyLabel(key: string): string;
  /** Visits/month for a frequency key (falls back to 0). */
  visitsPerMonth(key: string): number;
  /** Suggest a frequency from checked service names (quote→plan flow). */
  suggestFrequency(items: ReadonlyArray<{ name: string; isRecurring: boolean }>): string;
  /** The plan-set a season swap pauses/resumes (season slice reads this). */
  seasonSwap: { planKind: string; frequencies: readonly string[] };
}
```

The `Vertical` interface (`src/verticals/types.ts`) gains `planCadence: PlanCadenceModule`.

## Architecture / mechanics

- **`src/verticals/lawn/plan-cadence.ts`** — `lawnPlanCadence`, holding
  `LAWN_FREQUENCIES` (the 4 options relocated verbatim from `NewPlan.FREQ_OPTIONS`
  + the `VISITS_PER_MONTH` values):
  ```ts
  const LAWN_FREQUENCIES: readonly FrequencyOption[] = [
    { key: "weekly",       label: "Weekly",       sub: "Peak season mow", visitsPerMonth: 4 },
    { key: "biweekly",     label: "Biweekly",     sub: "Every 2 weeks",   visitsPerMonth: 2 },
    { key: "monthly",      label: "Monthly",      sub: "Light touch",     visitsPerMonth: 1 },
    { key: "fert_program", label: "Fert program", sub: "Scheduled apps",  visitsPerMonth: 5 / 12 },
  ];
  ```
  with `defaultFrequency: "weekly"`, `defaultIntervalMonths: 3` (NewPlan's current
  default), `frequencyLabel`/`visitsPerMonth` as lookups over `LAWN_FREQUENCIES`,
  `suggestFrequency` (the heuristic moved verbatim from `convertHelpers.ts` —
  biweekly/monthly/fert keyword match, else weekly), and
  `seasonSwap: { planKind: "mow", frequencies: ["weekly", "biweekly", "monthly"] }`.
- **`src/verticals/lawn/index.ts`** — register `planCadence: lawnPlanCadence`.
- **`src/pages/NewPlan.tsx`** — `FREQ_OPTIONS` → `vertical.planCadence.frequencies`;
  `VISITS_PER_MONTH[freq]` → `vertical.planCadence.visitsPerMonth(freq)`;
  `useState<Frequency>("weekly")` default → `vertical.planCadence.defaultFrequency`;
  `useState<BillingInterval>(3)` → `vertical.planCadence.defaultIntervalMonths`.
  The local `Frequency`/`BillingInterval`/`PlanKind` type aliases and the
  `fert_program` auto-`plan_kind` `useEffect` STAY (lawn business logic).
- **`src/pages/Plans.tsx`** and **`src/pages/PlanDetail.tsx`** — delete the local
  `FREQUENCY_LABEL` maps; use `vertical.planCadence.frequencyLabel(freq)`.
  PlanDetail's `FREQ_OPTIONS` key list → `vertical.planCadence.frequencies`. The
  local `LawnPlan` type extensions stay (they type DB rows, not the frequency
  config).
- **`src/components/quotes/convertHelpers.ts`** — remove `suggestFrequency` (moved
  to the vertical). Keep `RECURRING_KEYWORDS`/`ONE_TIME_KEYWORDS`/
  `isOneTimeByDefault`/`deriveInitialLineItems` (line-item recurrence, not cadence).
- **`src/components/quotes/ConvertToPlanForm.tsx`** — `suggestFrequency(...)` →
  `vertical.planCadence.suggestFrequency(...)`; local `FREQ_OPTIONS` →
  `vertical.planCadence.frequencies` (chips adopt canonical labels — "Fert" →
  "Fert program"); `VISITS_PER_MONTH[freq]` → `vertical.planCadence.visitsPerMonth(freq)`.
  Its local `BILLING_OPTIONS`/`PERIOD_NAME` and interval default stay (billing UI,
  out of scope).
- **`src/lib/season.ts`** — in `countAffectedPlans` and `swapSeasonFallback`,
  replace the hardcoded `.eq("plan_kind","mow").in("frequency",[…])` with
  `.eq("plan_kind", vertical.planCadence.seasonSwap.planKind)
   .in("frequency", vertical.planCadence.seasonSwap.frequencies as string[])`
  (add `import { vertical } from "@/vertical"`). The `pause_reason: "winter_swap"`
  logic stays (season-specific, 0c-5).

## Testing

- **Unit (vitest)** `src/verticals/lawn/plan-cadence.test.ts`:
  `frequencies` has the 4 keys in order; `visitsPerMonth("weekly")===4`,
  `("fert_program")` ≈ `5/12`, unknown key → 0; `frequencyLabel("monthly")===
  "Monthly"`, unknown → the key; `defaultFrequency==="weekly"`,
  `defaultIntervalMonths===3`; `suggestFrequency` → biweekly/monthly/fert_program/
  weekly for the matching checked-name cases and the default; `seasonSwap` deep-
  equals `{ planKind: "mow", frequencies: ["weekly","biweekly","monthly"] }`.
- **Conformance:** `lawnVertical.planCadence` defined.
- **Build + tsc:** `npx tsc --noEmit -p tsconfig.app.json` at the known 6-file
  baseline — no NEW file. `npm run build` succeeds; full vitest suite green.
- **Manual (deferred, human):** NewPlan / PlanDetail / Plans show the same
  frequencies + labels; the quote→plan convert form suggests the same frequency
  (its fert chip now reads "Fert program" — confirm it doesn't overflow the compact
  4-button row; if it does, that's a CSS wrap/size tweak, not a reason to reintroduce
  a local label); a season swap pauses the same plans.

## Out of scope (0c-4)

- The recurrence math (`planned-jobs.ts`, `next-visit.ts`) — stays in core.
- Season STATE (`useSeason`, the swap mutation, `Season` type, `pause_reason`) —
  0c-5.
- The billing `interval_months` UI (`BILLING_OPTIONS`) — only its NewPlan default
  sources from config.
- Adapting the Plans UI to an empty `frequencies` list (pressure) — Phase 1.
- Any pressure `planCadence` — Phase 1 (this seam makes it config-only).
