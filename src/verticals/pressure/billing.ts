import type { BillingModule } from "@/verticals/billing";
import type { Tier, TierId } from "@/lib/stripe";

const PRESSURE_TIERS: Tier[] = [
  {
    id: "payg",
    name: "Pay as you go",
    tagline: "Low base — pay only when you earn",
    monthly: { priceId: "pp_payg_monthly", price: 5 },
    yearly: { priceId: "pp_payg_yearly", price: 50, saveLabel: "Save $10" },
    seats: 1,
    extraSeatPrice: null,
    weeklyStopLimit: null,
    highlights: [
      "$5 monthly base",
      "2% on processed payments",
      "Up to 50 quotes / month",
      "Best for trials + cash-heavy ops",
    ],
    applicationFeePercent: 2.0,
  },
  {
    id: "solo",
    name: "Solo",
    tagline: "One truck, one operator",
    monthly: { priceId: "pp_solo_monthly", price: 15 },
    yearly: { priceId: "pp_solo_yearly", price: 150, saveLabel: "Save $30" },
    seats: 1,
    extraSeatPrice: null,
    weeklyStopLimit: null,
    highlights: [
      "Up to 50 quotes / month",
      "1 user",
      "500 MB cloud photo backup",
      "All quote, photo & SMS tools",
    ],
    applicationFeePercent: 0,
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Growing crew",
    monthly: { priceId: "pp_pro_monthly", price: 25 },
    yearly: { priceId: "pp_pro_yearly", price: 250, saveLabel: "Save $50" },
    seats: 2,
    extraSeatPrice: null,
    weeklyStopLimit: null,
    highlights: [
      "Unlimited quotes",
      "2 user seats",
      "5 GB cloud photo backup",
      "QuickBooks sync",
      "Route optimization",
    ],
    applicationFeePercent: 0,
  },
  {
    id: "crew",
    name: "Crew",
    tagline: "Multi-truck operation",
    monthly: { priceId: "pp_crew_monthly", price: 49 },
    yearly: { priceId: "pp_crew_yearly", price: 490, saveLabel: "Save $98" },
    seats: 5,
    extraSeatPrice: null,
    weeklyStopLimit: null,
    highlights: [
      "5 user seats",
      "25 GB cloud photo backup",
      "Fleet calendar",
      "Reporting export",
      "Everything in Pro",
    ],
    applicationFeePercent: 0,
  },
];

const PRESSURE_PRICE_TO_TIER: Record<string, TierId> = {
  pp_payg_monthly: "payg",
  pp_payg_yearly: "payg",
  pp_solo_monthly: "solo",
  pp_solo_yearly: "solo",
  pp_pro_monthly: "pro",
  pp_pro_yearly: "pro",
  pp_crew_monthly: "crew",
  pp_crew_yearly: "crew",
  // Grandfathered legacy single-tier plan → Pro.
  pressurepro_monthly: "pro",
  pressurepro_yearly: "pro",
};

export const pressureBilling: BillingModule = {
  tiers: PRESSURE_TIERS,
  priceToTier: PRESSURE_PRICE_TO_TIER,
};
