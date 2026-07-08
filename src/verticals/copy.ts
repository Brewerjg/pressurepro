// The lawn-flavored domain copy that shared screens render. A flat object of
// strings (mirrors vertical.catalog / vertical.campaigns). Parameterized strings
// carry {token} placeholders the CONSUMER replaces — keeps this a plain string
// object with no functions. Tokens: {months}, {business}, {brand}.
export interface CopyModule {
  // Public print / quote
  quoteRecurringBlurb: string; // "We'll keep the lawn on schedule every {months} months."
  quoteFooterThankYou: string; // "Thank you for the opportunity to quote your lawn."
  // Public gallery
  photoPairLabel: string; // "Lawn care visit"
  galleryCtaHeadline: string; // "Want a lawn like this?"
  galleryCtaBody: string; // "Get a quote from {business} for your own yard."
  // Public review
  reviewCalloutHeadline: string; // "Help us reach more lawns"
  reviewCalloutBody: string; // "A quick Google review goes a long way for a small lawn-care business."
  // Public plan portal
  planPortalSubtitle: string; // "Manage your lawn-care plan below."
  // Plan empty states
  plansEmptyStateBody: string; // "Recurring is the default for lawn care — add your first plan to get started."
  customerPlansEmptyState: string; // "No plans yet. Recurring service is the {brand} default — add a plan to put this customer on a route."
  // Onboarding + settings
  onboardingCatalogTitle: string; // "Lawn services catalog"
  onboardingCatalogSubtitle: string; // "Want us to drop in the standard lawn-care services? You can edit them anytime."
  businessNamePlaceholder: string; // "Acme Lawn Care" (Onboarding + BusinessProfile)
  catalogItemNamePlaceholder: string; // "Weekly mow" (CatalogEditor new-item name)
  completedNotificationBlurb: string; // "Thanks-for-letting-us-mow message after each stop wraps."
  // Onboarding seed preview (Step 3 UI list)
  onboardingSeedPreview: ReadonlyArray<{ name: string; price: string }>;
  // Pricing
  pricingTagline: string; // "Built for lawn-care crews." (consumer appends " Cancel anytime.")
}
