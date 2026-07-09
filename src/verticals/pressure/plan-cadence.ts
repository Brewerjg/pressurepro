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
