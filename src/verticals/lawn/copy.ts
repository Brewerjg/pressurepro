import type { CopyModule } from "@/verticals/copy";

export const lawnCopy: CopyModule = {
  quoteRecurringBlurb: "We'll keep the lawn on schedule every {months} months.",
  quoteFooterThankYou: "Thank you for the opportunity to quote your lawn.",
  photoPairLabel: "Lawn care visit",
  galleryCtaHeadline: "Want a lawn like this?",
  galleryCtaBody: "Get a quote from {business} for your own yard.",
  reviewCalloutHeadline: "Help us reach more lawns",
  reviewCalloutBody:
    "A quick Google review goes a long way for a small lawn-care business.",
  planPortalSubtitle: "Manage your lawn-care plan below.",
  plansEmptyStateBody:
    "Recurring is the default for lawn care — add your first plan to get started.",
  customerPlansEmptyState:
    "No plans yet. Recurring service is the {brand} default — add a plan to put this customer on a route.",
  onboardingCatalogTitle: "Lawn services catalog",
  onboardingCatalogSubtitle:
    "Want us to drop in the standard lawn-care services? You can edit them anytime.",
  businessNamePlaceholder: "Acme Lawn Care",
  catalogItemNamePlaceholder: "Weekly mow",
  completedNotificationBlurb:
    "Thanks-for-letting-us-mow message after each stop wraps.",
  onboardingSeedPreview: [
    { name: "Weekly mow", price: "$45" },
    { name: "Biweekly mow", price: "$55" },
    { name: "Spring cleanup", price: "$175" },
    { name: "Aeration", price: "$125" },
    { name: "Fert step 1 (pre-emergent)", price: "$85" },
    { name: "+ 17 more (cleanups, fert, snow…)", price: "" },
  ],
  pricingTagline: "Built for lawn-care crews.",
};
