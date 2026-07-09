import type { BillingModule } from "@/verticals/billing";
import type { Tier, TierId } from "@/lib/stripe";

const LAWN_TIERS: Tier[] = [
  {
    id: "payg",
    name: "Base",
    tagline: "Low flat price — keep 100%",
    monthly: { priceId: "turfpro_payg_monthly", price: 8 },
    yearly: { priceId: "turfpro_payg_yearly", price: 80, saveLabel: "Save $16" },
    seats: 1,
    extraSeatPrice: null,
    weeklyStopLimit: 25,
    highlights: [
      "$8/mo flat",
      "0% payout fees — keep 100%",
      "1 user seat",
      "Up to 25 stops / week",
      "All operator features",
    ],
    applicationFeePercent: 0,
  },
  {
    id: "solo",
    name: "Solo",
    tagline: "One truck, one operator",
    monthly: { priceId: "turfpro_solo_monthly", price: 15 },
    yearly: { priceId: "turfpro_solo_yearly", price: 150, saveLabel: "Save $30" },
    seats: 1,
    extraSeatPrice: null,
    weeklyStopLimit: 50,
    highlights: [
      "1 user seat",
      "Up to 50 stops / week",
      "0% payout fees — keep 100%",
      "Photo before/after, chemical log",
      "Weather & spray-day planner (beta)",
    ],
    applicationFeePercent: 0,
  },
  {
    id: "crew",
    name: "Crew",
    tagline: "Multi-truck operation",
    monthly: { priceId: "turfpro_crew_monthly", price: 59 },
    yearly: { priceId: "turfpro_crew_yearly", price: 590, saveLabel: "Save $118" },
    seats: 5,
    extraSeatPrice: 10,
    weeklyStopLimit: null,
    highlights: [
      "5 seats included (+$10/seat after)",
      "Unlimited stops",
      "Multi-truck routing & route optimization (beta)",
      "QuickBooks sync (coming soon)",
      "Recurring billing + maintenance plans",
      "Fleet view, crew calendar & report export",
    ],
    applicationFeePercent: 0,
  },
];

const LAWN_PRICE_TO_TIER: Record<string, TierId> = {
  turfpro_payg_monthly: "payg",
  turfpro_payg_yearly: "payg",
  turfpro_solo_monthly: "solo",
  turfpro_solo_yearly: "solo",
  turfpro_crew_monthly: "crew",
  turfpro_crew_yearly: "crew",
};

export const lawnBilling: BillingModule = {
  tiers: LAWN_TIERS,
  priceToTier: LAWN_PRICE_TO_TIER,
};
