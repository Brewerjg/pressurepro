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
