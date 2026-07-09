# Phase 1 slice 1d-3 (pressure plan-cadence + Plans de-lawn) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 feature flags to `PlanCadenceModule` and gate the lawn-only sections/logic in `NewPlan`/`PlanDetail`/`ConvertToPlanForm` behind them, so a pressure build creates flat-amount plans. Lawn behavior byte-identical.

**Architecture:** Flags default to lawn's current behavior. The DB payload SHAPE stays constant across verticals — only values vary (pressure: `per_visit_rate: null`, `plan_kind: defaultPlanKind`, flat `amount`; unused `frequency`/`day_of_week`/`season_pause` keep harmless default states). No `NewPlanInput`/edge/schema change.

**Tech Stack:** React + TypeScript, vitest.

## Global Constraints

- **tsc gate:** `npx tsc --noEmit -p tsconfig.app.json` (NOT root). Baseline = exactly 6 files: `AudienceStep.tsx`, `campaigns/templates.ts`, `BusinessProfile.tsx`, `iap.ts`, `Campaigns.tsx`, `Onboarding.tsx`. Gate = no NEW file. **`NewPlan.tsx`, `PlanDetail.tsx`, `ConvertToPlanForm.tsx` must NOT become new errors.**
- **Lawn byte-identity:** every guard uses `vertical.planCadence.<flag>`; for lawn those are `"per-visit"`/`true`/`true`/`true`/`"mow"`, so all sections render and all values compute exactly as today. Do NOT change any lawn-path logic — only WRAP sections and add `else`/branch code that runs for pressure.
- **Payload shape constant:** never remove a field from the insert/update/submit payloads; only change its value expression.
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br
  ```
- Full vitest suite green; `npm run build` succeeds.

---

### Task 1: PlanCadenceModule flags + lawn/pressure plan-cadence + tests

**Files:**
- Modify: `src/verticals/plan-cadence.ts` (add 5 flags)
- Modify: `src/verticals/lawn/plan-cadence.ts` (set flags)
- Create: `src/verticals/pressure/plan-cadence.ts`
- Modify: `src/verticals/lawn/plan-cadence.test.ts` (assert flags)
- Test: `src/verticals/pressure/plan-cadence.test.ts`

**Interfaces:**
- Produces: `PlanCadenceModule.{billingModel, hasServiceFrequency, hasRouteDay, hasSeasonPause, defaultPlanKind}`; `pressurePlanCadence`.

- [ ] **Step 1: Extend the contract**

In `src/verticals/plan-cadence.ts`, add to the `PlanCadenceModule` interface (after `seasonSwap`):

```ts
  /** "per-visit" = amount = perVisitRate × visitsPerMonth × interval; "flat" = amount entered directly. */
  billingModel: "per-visit" | "flat";
  /** Show the service-frequency picker. */
  hasServiceFrequency: boolean;
  /** Show the day-of-week "route day" picker. */
  hasRouteDay: boolean;
  /** Show the season-pause controls. */
  hasSeasonPause: boolean;
  /** plan_kind written when there is no frequency-derived kind. */
  defaultPlanKind: string;
```

- [ ] **Step 2: Set lawn flags (defaults = current behavior)**

In `src/verticals/lawn/plan-cadence.ts`, add to the `lawnPlanCadence` object:

```ts
  billingModel: "per-visit",
  hasServiceFrequency: true,
  hasRouteDay: true,
  hasSeasonPause: true,
  defaultPlanKind: "mow",
```

- [ ] **Step 3: Create pressurePlanCadence**

Create `src/verticals/pressure/plan-cadence.ts`:

```ts
import type { PlanCadenceModule } from "@/verticals/plan-cadence";

// Pressure plans are flat-amount recurring billing (charge every interval_months);
// no service frequency, route day, season pause, or plan_kind semantics.
export const pressurePlanCadence: PlanCadenceModule = {
  frequencies: [],
  defaultFrequency: "weekly", // a valid maintenance_plans.frequency value; unused by pressure
  defaultIntervalMonths: 3,
  frequencyLabel: (key) => key,
  visitsPerMonth: () => 0,
  suggestFrequency: () => "weekly",
  seasonSwap: { planKind: "other", frequencies: [] },
  billingModel: "flat",
  hasServiceFrequency: false,
  hasRouteDay: false,
  hasSeasonPause: false,
  defaultPlanKind: "other",
};
```

- [ ] **Step 4: Tests**

Append to `src/verticals/lawn/plan-cadence.test.ts` (inside the describe):

```ts
  it("uses the lawn per-visit plan model with all cadence sections", () => {
    expect(lawnPlanCadence.billingModel).toBe("per-visit");
    expect(lawnPlanCadence.hasServiceFrequency).toBe(true);
    expect(lawnPlanCadence.hasRouteDay).toBe(true);
    expect(lawnPlanCadence.hasSeasonPause).toBe(true);
    expect(lawnPlanCadence.defaultPlanKind).toBe("mow");
  });
```
(If `lawnPlanCadence` isn't already imported in that test, add the import.)

Create `src/verticals/pressure/plan-cadence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pressurePlanCadence } from "./plan-cadence";

describe("pressurePlanCadence", () => {
  it("is flat-billing with no cadence sections", () => {
    expect(pressurePlanCadence.billingModel).toBe("flat");
    expect(pressurePlanCadence.hasServiceFrequency).toBe(false);
    expect(pressurePlanCadence.hasRouteDay).toBe(false);
    expect(pressurePlanCadence.hasSeasonPause).toBe(false);
    expect(pressurePlanCadence.defaultPlanKind).toBe("other");
  });
  it("has no frequencies and a valid default frequency", () => {
    expect(pressurePlanCadence.frequencies).toHaveLength(0);
    expect(pressurePlanCadence.defaultFrequency).toBe("weekly");
  });
});
```

- [ ] **Step 5: Gates + commit**

Run: `npx vitest run src/verticals/lawn/plan-cadence.test.ts src/verticals/pressure/plan-cadence.test.ts` → PASS.
Run: `npx tsc --noEmit -p tsconfig.app.json` → 6-baseline, no new file.
Run: `npx vitest run` → full suite green.

```bash
git add src/verticals/plan-cadence.ts src/verticals/lawn/plan-cadence.ts src/verticals/pressure/plan-cadence.ts src/verticals/lawn/plan-cadence.test.ts src/verticals/pressure/plan-cadence.test.ts
git commit
```
(`feat(platform): plan-cadence flags (billingModel + section flags) + pressurePlanCadence` + trailers.)

---

### Task 2: de-lawn `NewPlan.tsx`

**Files:** Modify: `src/pages/NewPlan.tsx`

**Interfaces:** Consumes `vertical.planCadence.{billingModel,hasServiceFrequency,hasRouteDay,hasSeasonPause,defaultPlanKind}`.

Locate each region by its surrounding code (line numbers approximate — they drift). Lawn path (flags true/per-visit) MUST be unchanged.

- [ ] **Step 1: Guard the self-contained lawn sections**

Wrap each of these `<Section>` blocks in a flag guard so they render for lawn and vanish for pressure:
- The "Service frequency" `<Section>` (the one doing `vertical.planCadence.frequencies.map(...)`, ~lines 352-380): wrap in `{vertical.planCadence.hasServiceFrequency && ( … )}`.
- The "Route day" day-of-week `<Section>` (7-button Sun–Sat grid, ~382-407): wrap in `{vertical.planCadence.hasRouteDay && ( … )}`.
- The season-pause `<Section>` (~524-549): wrap in `{vertical.planCadence.hasSeasonPause && ( … )}`.

- [ ] **Step 2: Amount input — per-visit vs flat**

The per-visit-rate `<Field>` input (~414-431) and the billing-math card (~436-482, the `{perVisitNum > 0 && ( … )}` block showing `$rate × visits × interval = total` + the override input) render only for per-visit billing. Wrap BOTH in `{vertical.planCadence.billingModel === "per-visit" && ( … )}`.

Add a flat-amount input that renders for pressure (`{vertical.planCadence.billingModel === "flat" && ( … )}`), a single `<Field label="Plan amount">` with a `$`-prefixed number input bound to `amountOverride`/`setAmountOverride` (reuse that state as the pressure amount):

```tsx
{vertical.planCadence.billingModel === "flat" && (
  <Field label="Plan amount">
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">$</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={amountOverride}
        onChange={(e) => setAmountOverride(e.target.value)}
        placeholder="0.00"
        className="tp-input pl-7"
        required
      />
    </div>
  </Field>
)}
```

- [ ] **Step 3: Billing computation branch (submit handler, ~155-196)**

Replace the amount/validation logic so pressure uses the flat amount and lawn keeps the per-visit formula. In the submit handler, before building `input`:

```ts
      let amountNum: number;
      let perVisitForPayload: number | null;
      if (vertical.planCadence.billingModel === "flat") {
        amountNum = Number(amountOverride) || 0;
        if (!amountNum || amountNum <= 0) {
          setError("Enter a plan amount.");
          return;
        }
        perVisitForPayload = null;
      } else {
        const perVisitNum = Number(perVisitRate);
        if (!perVisitNum || perVisitNum <= 0) {
          setError("Enter a per-visit rate.");
          return;
        }
        const calculatedAmount = calcBillingAmount(perVisitNum, frequency, intervalMonths);
        const overrideNum = showOverride ? Number(amountOverride) : NaN;
        amountNum = Number.isFinite(overrideNum) && overrideNum > 0 ? overrideNum : calculatedAmount;
        if (!amountNum || amountNum <= 0) {
          setError("Enter a per-visit rate.");
          return;
        }
        perVisitForPayload = perVisitNum;
      }
```
(Match the exact existing error-setter name — `setError` or similar — and preserve the existing lawn messages/branches; the block above mirrors the current per-visit logic, only wrapping it in the `else`.)

In the `input: NewPlanInput = { … }` object:
- `amount: amountNum,`
- `per_visit_rate: perVisitForPayload,`
- `plan_kind: vertical.planCadence.hasServiceFrequency ? planKind : vertical.planCadence.defaultPlanKind,`
- leave `frequency`, `day_of_week`, `season_pause` as the existing state values (harmless defaults for pressure).

- [ ] **Step 4: planKind derivation useEffect (~84-89)**

Make the frequency-derivation `useEffect` a no-op for pressure — add as its first line:
```ts
    if (!vertical.planCadence.hasServiceFrequency) return;
```
(`planKind` state stays initialized to `"mow"`; it is not read for pressure because Step 3 writes `defaultPlanKind`.)

- [ ] **Step 5: Gates + commit**

Run: `npx tsc --noEmit -p tsconfig.app.json` → 6-baseline; **`NewPlan.tsx` NOT a new error**.
Run: `npx vitest run` → green. Run: `npm run build` → succeeds.

```bash
git add src/pages/NewPlan.tsx
git commit
```
(`feat(platform): NewPlan serves flat-amount plans for pressure (cadence flags)` + trailers.)

---

### Task 3: de-lawn `PlanDetail.tsx`

**Files:** Modify: `src/pages/PlanDetail.tsx`

- [ ] **Step 1: SummaryCard (read view, ~590-657)**

Guard the lawn-only read fields: the "Frequency" `<Stat>` and "Route day" `<Stat>` (~612-613) — wrap the Frequency stat in `{vertical.planCadence.hasServiceFrequency && …}` and the Route-day stat in `{vertical.planCadence.hasRouteDay && …}`; wrap the seasonal-pauses block (~638-654) in `{vertical.planCadence.hasSeasonPause && …}`. The `freqLabel`/`dayLabel` derivations (~591-595) may stay (they read `plan.frequency ?? "weekly"` etc. — harmless for a pressure plan whose default frequency was written), but the Stats that display them are now guarded.

- [ ] **Step 2: EditCard pickers**

Wrap: the frequency picker (~732-754) in `{vertical.planCadence.hasServiceFrequency && …}`; the day picker (~756-778) in `{vertical.planCadence.hasRouteDay && …}`; the season pause (~834-856) in `{vertical.planCadence.hasSeasonPause && …}`. The Amount + Billing-cadence grid (~780-816) stays for both.

- [ ] **Step 3: plan_kind in the save (~703-716)**

Change the `plan_kind` expression in the `onSave({ … })` object to:
```ts
  plan_kind: vertical.planCadence.hasServiceFrequency
    ? (frequency === "fert_program" && plan.plan_kind !== "other"
        ? "fert_program"
        : plan.plan_kind === "other"
          ? "other"
          : "mow")
    : vertical.planCadence.defaultPlanKind,
```
Keep the other payload fields (`amount`, `interval_months`, `next_charge_date`, `day_of_week`, `frequency`, `season_pause`) unchanged — their states hold harmless defaults for pressure.

- [ ] **Step 4: Gates + commit**

Run: `npx tsc --noEmit -p tsconfig.app.json` → 6-baseline; **`PlanDetail.tsx` NOT a new error**.
Run: `npx vitest run` → green. Run: `npm run build` → succeeds.

```bash
git add src/pages/PlanDetail.tsx
git commit
```
(`feat(platform): PlanDetail hides lawn cadence sections for pressure` + trailers.)

---

### Task 4: de-lawn `ConvertToPlanForm.tsx`

**Files:** Modify: `src/components/quotes/ConvertToPlanForm.tsx`

- [ ] **Step 1: billingPreview branch (~157-170)**

Make the `billingPreview` useMemo branch on the billing model:
```ts
  const billingPreview = useMemo(() => {
    if (vertical.planCadence.billingModel === "flat") {
      return {
        visitsLabel: "flat",
        total: Math.round(effectiveRate * intervalMonths * 100) / 100,
        periodName: PERIOD_NAME[intervalMonths],
      };
    }
    const visitsPerMonth = vertical.planCadence.visitsPerMonth(frequency);
    const visitsLabel =
      frequency === "fert_program"
        ? "5 visits/yr"
        : `${visitsPerMonth} visit${visitsPerMonth === 1 ? "" : "s"}/mo`;
    const total = Math.round(effectiveRate * visitsPerMonth * intervalMonths * 100) / 100;
    return { visitsLabel, total, periodName: PERIOD_NAME[intervalMonths] };
  }, [effectiveRate, frequency, intervalMonths]);
```
(Match the current per-visit body exactly for the `else` path.)

- [ ] **Step 2: Guard the picker sections**

Wrap the "How often" frequency `<div>` (~593-620) in `{vertical.planCadence.hasServiceFrequency && ( … )}` and the "Day" `<div>` (~622-650) in `{vertical.planCadence.hasRouteDay && ( … )}`.

- [ ] **Step 3: Guard the frequency auto-suggest effect (~135-139)**

Add as the first line inside the auto-suggest `useEffect`:
```ts
    if (!vertical.planCadence.hasServiceFrequency) return;
```

- [ ] **Step 4: onSubmit payload (~269-280)**

Change the lawn-only field values (keep the shape):
```ts
    per_visit_rate: vertical.planCadence.billingModel === "per-visit" ? effectiveRate : null,
    frequency,
    day_of_week: dayOfWeek,
```
(`frequency`/`day_of_week` keep their state values — harmless defaults for pressure; only `per_visit_rate` becomes null for flat. If the `onSubmit`/consumer type requires `per_visit_rate: number`, confirm it accepts `number | null` — the plan insert path uses `NewPlanInput.per_visit_rate?: number | null`, which is nullable.)

- [ ] **Step 5: Gates + commit**

Run: `npx tsc --noEmit -p tsconfig.app.json` → 6-baseline; **`ConvertToPlanForm.tsx` NOT a new error**.
Run: `npx vitest run` → green. Run: `npm run build` → succeeds.

```bash
git add src/components/quotes/ConvertToPlanForm.tsx
git commit
```
(`feat(platform): ConvertToPlanForm flat-billing path for pressure` + trailers.)

---

## Self-Review notes (author)

- **Spec coverage:** flags + config (Task 1); the three shared pages (Tasks 2-4). Payload shape preserved throughout.
- **Lawn identity:** every guard is `flag && (...)` with lawn flags true / `billingModel "per-visit"`; the per-visit branches reproduce the exact current logic. No lawn-path expression changes.
- **Type safety:** `per_visit_rate` is `number | null` in `NewPlanInput`; pressure sends `null`. `plan_kind` is a string either way.
- **No schema/edge change:** insert/update/submit keep all columns; pressure's unused `frequency`/`day_of_week`/`season_pause` write harmless default-state values.
- **Risk:** shared-page surgery — the whole-branch review must trace lawn-identity page by page. Each task is one page for focused review.
