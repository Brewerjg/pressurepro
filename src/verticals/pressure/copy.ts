import type { CopyModule } from "@/verticals/copy";

export const pressureCopy: CopyModule = {
  quoteRecurringBlurb: "We'll reach out every {months} months to keep things looking sharp.",
  quoteFooterThankYou: "Thank you for the opportunity to quote your property.",
  photoPairLabel: "Pressure wash visit",
  galleryCtaHeadline: "Want results like this?",
  galleryCtaBody: "Get a quote from {business} for your own property.",
  reviewCalloutHeadline: "Help us reach more homes",
  reviewCalloutBody:
    "A quick Google review goes a long way for a small pressure-washing business.",
  planPortalSubtitle: "Manage your wash plan below.",
  plansEmptyStateBody:
    "Recurring keeps surfaces clean year-round — add your first plan to get started.",
  customerPlansEmptyState:
    "No plans yet. Recurring service is the {brand} way — add a plan to keep this property on a schedule.",
  onboardingCatalogTitle: "Surface pricing",
  onboardingCatalogSubtitle:
    "We pre-loaded standard rates for the seven core surfaces. Tweak them anytime.",
  businessNamePlaceholder: "Acme Pressure Washing",
  catalogItemNamePlaceholder: "House wash",
  completedNotificationBlurb: "Thanks-for-your-business message after each job wraps.",
  onboardingSeedPreview: [
    { name: "House wash", price: "$250+" },
    { name: "Roof soft-wash", price: "$350+" },
    { name: "Driveway", price: "$150+" },
    { name: "Deck", price: "$200+" },
    { name: "Fence", price: "$150+" },
    { name: "+ concrete, siding…", price: "" },
  ],
  pricingTagline: "Built for pressure-washing pros.",
};
