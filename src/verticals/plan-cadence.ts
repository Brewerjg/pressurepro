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
