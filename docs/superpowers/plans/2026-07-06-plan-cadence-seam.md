# Plan-Cadence Seam (Phase 0c-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `vertical.planCadence` config module owning the trade-specific service-frequency model, and DRY its definition out of the five places it is copy-pasted.

**Architecture:** New `src/verticals/plan-cadence.ts` contract (`FrequencyOption`, `PlanCadenceModule`); `src/verticals/lawn/plan-cadence.ts` holds `lawnPlanCadence`; five consumers (`NewPlan`, `Plans`, `PlanDetail`, `ConvertToPlanForm`, `convertHelpers`) plus `season.ts` read from it. The recurrence math (`planned-jobs.ts`, `next-visit.ts`) stays in core, untouched.

**Tech Stack:** React + TypeScript + Vite + Supabase + vitest.

## Global Constraints

- **Phase 0c-4** of the multi-vertical platform (spec: `2026-07-06-plan-cadence-seam-design.md`).
- **Behavior-identical for TurfPro**, with ONE deliberate cosmetic change: ConvertToPlanForm's `fert_program` chip reads "Fert program" (canonical) instead of "Fert".
- **Consumer `frequency` STATE loosens to `string`** (frequency is now a config-driven open set). `fert_program` equality checks and DB writes work unchanged. `LawnPlan` DB-row union types stay. Billing `interval_months` state/UI stays (only NewPlan's default sources from config; cast the default to the local `BillingInterval` union).
- The recurrence math (`planned-jobs.ts`, `next-visit.ts`) is OUT OF SCOPE — do not touch it.
- Verify tsc with the STRICT app config: `npx tsc --noEmit -p tsconfig.app.json`. Known PRE-EXISTING baseline of errors in 6 UNRELATED files — `src/components/campaigns/AudienceStep.tsx`, `src/components/campaigns/templates.ts`, `src/components/settings/BusinessProfile.tsx`, `src/lib/iap.ts`, `src/pages/Campaigns.tsx`, `src/pages/Onboarding.tsx`. Success = error set stays EXACTLY that baseline (no NEW file; the file you edited must NOT appear).
- Tests: `npm test -- --run`. Build: `npm run build`.
- Base branch: `feature/plan-cadence-seam` (spec committed there). Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` /
  `Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br`.

---

### Task 1: The plan-cadence contract + lawn module + registration + tests

**Files:**
- Create: `src/verticals/plan-cadence.ts`
- Create: `src/verticals/lawn/plan-cadence.ts`
- Create (test): `src/verticals/lawn/plan-cadence.test.ts`
- Modify: `src/verticals/types.ts` (add `planCadence` to `Vertical`)
- Modify: `src/verticals/lawn/index.ts` (register `planCadence`)

**Interfaces:**
- Produces (used by Tasks 2–4): `FrequencyOption`, `PlanCadenceModule` (`@/verticals/plan-cadence`); `lawnPlanCadence` (`@/verticals/lawn/plan-cadence`); `vertical.planCadence` (via `@/vertical`) exposing `frequencies`, `defaultFrequency`, `defaultIntervalMonths`, `frequencyLabel(key)`, `visitsPerMonth(key)`, `suggestFrequency(items)`, `seasonSwap`.

- [ ] **Step 1: Create the contract**

Create `src/verticals/plan-cadence.ts`:

```ts
// A service-visit frequency this vertical offers.
export interface FrequencyOption {
  key: string;             // e.g. "weekly"
  label: string;           // e.g. "Weekly"
  sub: string;             // e.g. "Peak season mow"
  visitsPerMonth: number;  // billing math (weekly 4, biweekly 2, monthly 1, fert 5/12)
}

// Everything trade-specific about recurring-service cadence. The recurrence MATH
// (planOccursOn / nextVisitDate) stays in the shared core; this configures which
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

- [ ] **Step 2: Add `planCadence` to the `Vertical` contract**

In `src/verticals/types.ts`, add the import and the field. After the existing `import type { VerticalRoute, NavEntry, HomeAction } from "./shell";`, add:
```ts
import type { PlanCadenceModule } from "./plan-cadence";
```
and inside `interface Vertical { … }`, after `homeActions: HomeAction[];`, add:
```ts
  /** Recurring-service cadence config (frequencies, labels, season swap). */
  planCadence: PlanCadenceModule;
```

- [ ] **Step 3: Write the lawn plan-cadence test (TDD)**

Create `src/verticals/lawn/plan-cadence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lawnPlanCadence } from "@/verticals/lawn/plan-cadence";

describe("lawnPlanCadence", () => {
  it("lists the 4 lawn frequencies in order", () => {
    expect(lawnPlanCadence.frequencies.map((f) => f.key)).toEqual([
      "weekly", "biweekly", "monthly", "fert_program",
    ]);
  });
  it("defaults to weekly service and quarterly billing", () => {
    expect(lawnPlanCadence.defaultFrequency).toBe("weekly");
    expect(lawnPlanCadence.defaultIntervalMonths).toBe(3);
  });
  it("visitsPerMonth maps known keys and falls back to 0", () => {
    expect(lawnPlanCadence.visitsPerMonth("weekly")).toBe(4);
    expect(lawnPlanCadence.visitsPerMonth("biweekly")).toBe(2);
    expect(lawnPlanCadence.visitsPerMonth("monthly")).toBe(1);
    expect(lawnPlanCadence.visitsPerMonth("fert_program")).toBeCloseTo(5 / 12);
    expect(lawnPlanCadence.visitsPerMonth("nope")).toBe(0);
  });
  it("frequencyLabel maps known keys and falls back to the key", () => {
    expect(lawnPlanCadence.frequencyLabel("monthly")).toBe("Monthly");
    expect(lawnPlanCadence.frequencyLabel("fert_program")).toBe("Fert program");
    expect(lawnPlanCadence.frequencyLabel("nope")).toBe("nope");
  });
  it("suggestFrequency matches keyword hints, else weekly", () => {
    const f = (name: string) => lawnPlanCadence.suggestFrequency([{ name, isRecurring: true }]);
    expect(f("Biweekly mow")).toBe("biweekly");
    expect(f("Monthly cleanup")).toBe("monthly");
    expect(f("Fert step 1")).toBe("fert_program");
    expect(f("Weekly mow")).toBe("weekly");
    expect(lawnPlanCadence.suggestFrequency([{ name: "Biweekly", isRecurring: false }])).toBe("weekly");
  });
  it("seasonSwap targets active mow plans on the mow frequencies", () => {
    expect(lawnPlanCadence.seasonSwap).toEqual({
      planKind: "mow",
      frequencies: ["weekly", "biweekly", "monthly"],
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- --run plan-cadence`
Expected: FAIL — `@/verticals/lawn/plan-cadence` does not exist yet.

- [ ] **Step 5: Implement the lawn plan-cadence module**

Create `src/verticals/lawn/plan-cadence.ts` (the frequency values are relocated verbatim from `NewPlan.tsx`'s `FREQ_OPTIONS` + `VISITS_PER_MONTH`; `suggestFrequency` is the heuristic moved verbatim from `convertHelpers.ts`):

```ts
import type { FrequencyOption, PlanCadenceModule } from "@/verticals/plan-cadence";

const LAWN_FREQUENCIES: readonly FrequencyOption[] = [
  { key: "weekly", label: "Weekly", sub: "Peak season mow", visitsPerMonth: 4 },
  { key: "biweekly", label: "Biweekly", sub: "Every 2 weeks", visitsPerMonth: 2 },
  { key: "monthly", label: "Monthly", sub: "Light touch", visitsPerMonth: 1 },
  { key: "fert_program", label: "Fert program", sub: "Scheduled apps", visitsPerMonth: 5 / 12 },
];

export const lawnPlanCadence: PlanCadenceModule = {
  frequencies: LAWN_FREQUENCIES,
  defaultFrequency: "weekly",
  defaultIntervalMonths: 3,
  frequencyLabel: (key) =>
    LAWN_FREQUENCIES.find((f) => f.key === key)?.label ?? key,
  visitsPerMonth: (key) =>
    LAWN_FREQUENCIES.find((f) => f.key === key)?.visitsPerMonth ?? 0,
  suggestFrequency: (items) => {
    const checkedNames = items
      .filter((i) => i.isRecurring)
      .map((i) => i.name.toLowerCase());
    if (checkedNames.some((n) => n.includes("biweekly"))) return "biweekly";
    if (checkedNames.some((n) => n.includes("monthly"))) return "monthly";
    if (checkedNames.some((n) => n.includes("fert"))) return "fert_program";
    return "weekly";
  },
  seasonSwap: { planKind: "mow", frequencies: ["weekly", "biweekly", "monthly"] },
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- --run plan-cadence`
Expected: PASS — all lawnPlanCadence cases green.

- [ ] **Step 7: Register `planCadence` on the lawn vertical**

In `src/verticals/lawn/index.ts`, add the import and the field:
```ts
import { lawnPlanCadence } from "./plan-cadence";
```
and inside `lawnVertical`, after `homeActions: lawnHomeActions,`, add:
```ts
  planCadence: lawnPlanCadence,
```

- [ ] **Step 8: Typecheck, build, full suite**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == 6-file baseline — `Vertical` now requires `planCadence` and `lawnVertical` provides it; the five consumers still use their local copies, which is fine), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 9: Commit**

```bash
git add src/verticals/plan-cadence.ts src/verticals/lawn/plan-cadence.ts src/verticals/lawn/plan-cadence.test.ts src/verticals/types.ts src/verticals/lawn/index.ts
git commit -m "feat(platform): add vertical.planCadence module (lawn frequencies + suggest + seasonSwap)"
```

---

### Task 2: NewPlan reads `vertical.planCadence`

**Files:**
- Modify: `src/pages/NewPlan.tsx`

**Interfaces:**
- Consumes: `vertical.planCadence.frequencies` / `.visitsPerMonth` / `.defaultFrequency` / `.defaultIntervalMonths`. (`vertical` is already imported in this file.)

- [ ] **Step 1: Delete the local frequency defs**

In `src/pages/NewPlan.tsx`:
- DELETE the `const FREQ_OPTIONS: { key: Frequency; label: string; sub: string }[] = [ … ];` block.
- DELETE the `const VISITS_PER_MONTH: Record<Frequency, number> = { … };` block (and its leading comment).

- [ ] **Step 2: Loosen the frequency state + source defaults**

- Change `const [frequency, setFrequency] = useState<Frequency>("weekly");` to
  `const [frequency, setFrequency] = useState<string>(vertical.planCadence.defaultFrequency);`
- Change `const [intervalMonths, setIntervalMonths] = useState<BillingInterval>(3);` to
  `const [intervalMonths, setIntervalMonths] = useState<BillingInterval>(vertical.planCadence.defaultIntervalMonths as BillingInterval);`
- In `calcBillingAmount`, change its param `frequency: Frequency` to `frequency: string`, and change the body reference `VISITS_PER_MONTH[frequency]` to `vertical.planCadence.visitsPerMonth(frequency)`.

- [ ] **Step 3: Render the frequency picker from the vertical**

In the "Service frequency" section JSX, change the map over `FREQ_OPTIONS` to `vertical.planCadence.frequencies` (the option shape is `{ key, label, sub, visitsPerMonth }` — `key`/`label`/`sub` are still read the same way; ignore the extra `visitsPerMonth` field). The `onClick` that calls `setFrequency(opt.key)` now assigns a `string`, which matches the loosened state.

- [ ] **Step 4: Remove the now-unused `Frequency` type alias**

If `type Frequency = "weekly" | "biweekly" | "monthly" | "fert_program";` is no longer referenced anywhere in the file (the state and `calcBillingAmount` now use `string`; the `frequency === "fert_program"` checks use string literals), DELETE it. If `tsc` still resolves it as used, leave it. (The `fert_program` auto-`plan_kind` `useEffect` and the `PlanKind`/`Season`/`BillingInterval` aliases STAY.)

- [ ] **Step 5: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == baseline; `NewPlan.tsx` must NOT appear), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 6: Commit**

```bash
git add src/pages/NewPlan.tsx
git commit -m "feat(platform): NewPlan reads frequencies/defaults from vertical.planCadence"
```

---

### Task 3: Plans + PlanDetail read `vertical.planCadence`

**Files:**
- Modify: `src/pages/Plans.tsx`
- Modify: `src/pages/PlanDetail.tsx`

**Interfaces:**
- Consumes: `vertical.planCadence.frequencyLabel(key)` and `.frequencies`.

- [ ] **Step 1: Plans — use the vertical's label lookup**

In `src/pages/Plans.tsx`:
- Add `import { vertical } from "@/vertical";` (with the other imports).
- DELETE the `const FREQUENCY_LABEL: Record<LawnPlan["frequency"], string> = { … };` block.
- Replace every `FREQUENCY_LABEL[<expr>]` usage with `vertical.planCadence.frequencyLabel(<expr>)`. (`<expr>` is a `LawnPlan["frequency"]` value — assignable to the `string` param.)

- [ ] **Step 2: PlanDetail — use the vertical's label lookup + frequency list**

In `src/pages/PlanDetail.tsx`:
- Add `import { vertical } from "@/vertical";` (with the other imports).
- DELETE the `const FREQUENCY_LABEL: Record<Frequency, string> = { … };` block.
- DELETE the `const FREQ_OPTIONS: Frequency[] = ["weekly", "biweekly", "monthly", "fert_program"];` block.
- Replace every `FREQUENCY_LABEL[<expr>]` usage with `vertical.planCadence.frequencyLabel(<expr>)`.
- In the frequency-picker JSX (the edit card), change the map over `FREQ_OPTIONS` (which mapped over bare frequency-key strings) to `vertical.planCadence.frequencies`, and read each option's key via `opt.key` (and label via `opt.label` if the picker currently rendered `FREQUENCY_LABEL[f]`). The button's `onClick` sets the frequency to `opt.key` (a `string`).

- [ ] **Step 3: PlanDetail — loosen the editable frequency state to `string`**

The edit-card frequency state (whatever holds the currently-selected frequency for the save patch — a `useState<Frequency>(...)` seeded from `plan.frequency`) changes its type parameter from `Frequency` to `string`. `plan.frequency` (a `LawnPlan["frequency"]` union value) is still assignable to `string` for the seed. The save mutation writes `frequency` as a string (the DB column accepts it via the existing `(supabase as any)` cast). If `type Frequency = LawnPlan["frequency"];` is now unreferenced, DELETE it; otherwise leave it.

- [ ] **Step 4: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == baseline; neither `Plans.tsx` nor `PlanDetail.tsx` may appear), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Plans.tsx src/pages/PlanDetail.tsx
git commit -m "feat(platform): Plans + PlanDetail read frequency labels from vertical.planCadence"
```

---

### Task 4: ConvertToPlanForm + convertHelpers + season.ts read `vertical.planCadence`

**Files:**
- Modify: `src/components/quotes/convertHelpers.ts`
- Modify: `src/components/quotes/ConvertToPlanForm.tsx`
- Modify: `src/lib/season.ts`

**Interfaces:**
- Consumes: `vertical.planCadence.suggestFrequency` / `.frequencies` / `.visitsPerMonth` / `.seasonSwap`.

- [ ] **Step 1: Remove `suggestFrequency` from convertHelpers**

In `src/components/quotes/convertHelpers.ts`, DELETE the entire `suggestFrequency` function (its doc-comment block plus `export function suggestFrequency(items: PlanLineItem[]): "weekly" | … { … }`). Keep everything else (`RECURRING_KEYWORDS`, `ONE_TIME_KEYWORDS`, `isOneTimeByDefault`, `deriveInitialLineItems`, the `PlanLineItem` type).

- [ ] **Step 2: ConvertToPlanForm — swap imports + delete local defs**

In `src/components/quotes/ConvertToPlanForm.tsx`:
- Change `import { suggestFrequency, type PlanLineItem } from "@/components/quotes/convertHelpers";` to `import { type PlanLineItem } from "@/components/quotes/convertHelpers";`.
- Add `import { vertical } from "@/vertical";`.
- DELETE the local `const FREQ_OPTIONS = [ … ];` block and the `const VISITS_PER_MONTH: Record<…> = { … };` block (and its comment). (Keep `BILLING_OPTIONS` and `PERIOD_NAME`.)

- [ ] **Step 3: ConvertToPlanForm — read cadence from the vertical**

- Change the frequency state (`const [frequency, setFrequency] = useState<"weekly" | "biweekly" | "monthly" | "fert_program">(() => suggestFrequency(initialLineItems));`) to:
  ```tsx
  const [frequency, setFrequency] = useState<string>(() =>
    vertical.planCadence.suggestFrequency(initialLineItems),
  );
  ```
- In the auto-suggest `useEffect`, change `const suggested = suggestFrequency(items);` to `const suggested = vertical.planCadence.suggestFrequency(items);`.
- In `billingPreview`, change `const visitsPerMonth = VISITS_PER_MONTH[frequency];` to `const visitsPerMonth = vertical.planCadence.visitsPerMonth(frequency);`.
- In the frequency-picker JSX, change the map over `FREQ_OPTIONS` to `vertical.planCadence.frequencies`; each option is `{ key, label, sub, visitsPerMonth }` — the picker reads `f.key` and `f.label` as before (the `fert_program` chip now shows the canonical "Fert program"). `const on = frequency === f.key;` still works (string comparison).

- [ ] **Step 4: season.ts — source the swap filter from the vertical**

In `src/lib/season.ts`:
- Add `import { vertical } from "@/vertical";` (with the other imports).
- In `countAffectedPlans` (the `to === "winter"` branch), replace
  `.eq("plan_kind", "mow")` … `.in("frequency", ["weekly", "biweekly", "monthly"])` with
  `.eq("plan_kind", vertical.planCadence.seasonSwap.planKind)` … `.in("frequency", vertical.planCadence.seasonSwap.frequencies as string[])` (keep the `.eq("status", "active")` and other filters unchanged, in the same order).
- In `swapSeasonFallback` (the `to === "winter"` update branch), make the identical two substitutions on its `.eq("plan_kind", …)` / `.in("frequency", …)` calls.
- Leave the `pause_reason: "winter_swap"` logic and the non-winter branches unchanged.

- [ ] **Step 5: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == baseline; none of `convertHelpers.ts`, `ConvertToPlanForm.tsx`, `season.ts` may appear; a leftover `suggestFrequency`/`FREQ_OPTIONS`/`VISITS_PER_MONTH` reference would surface here), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 6: Commit**

```bash
git add src/components/quotes/convertHelpers.ts src/components/quotes/ConvertToPlanForm.tsx src/lib/season.ts
git commit -m "feat(platform): convert flow + season swap read vertical.planCadence"
```

---

## Human verification (deferred — after deploy)

Not an implementer task (needs the running app):
- NewPlan: the 4 service-frequency options render with the same labels/subs; the billing-amount preview matches (weekly ×4, fert ≈5/12); default frequency = Weekly, default billing = Quarterly.
- PlanDetail: the plan row + edit card show the same frequency labels; editing frequency saves correctly.
- Plans: list rows show the same frequency badges.
- Convert quote → plan: the suggested frequency matches (fert-named lines → Fert program); the fert chip now reads "Fert program" — confirm it doesn't overflow the compact 4-button row (if it does, a CSS wrap/size tweak — do NOT reintroduce a local label).
- Season swap: switching to Winter pauses the same set of plans (active mow, weekly/biweekly/monthly); switching back resumes them.

## Notes for the implementer

- Behavior-identical for lawn except the ConvertToPlanForm fert chip label. If a plan lists/edits/creates differently, stop and report.
- The recurrence math (`src/lib/planned-jobs.ts`, `src/lib/next-visit.ts`) is OUT OF SCOPE — do not touch it.
- `vertical` is already imported in `NewPlan.tsx`; the other consumers need the import added.
- Each task's `tsc` gate is "the error set equals the known 6-file baseline, and the file(s) you edited are NOT in it." The 6 baseline files are pre-existing and unrelated.
- After Task 4, `grep -rn "suggestFrequency" src` should show ONLY `vertical.planCadence.suggestFrequency` call sites and the module definition — no `convertHelpers` export remains.
