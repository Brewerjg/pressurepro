import type { LucideIcon } from "lucide-react";

// A built-in campaign message template the wizard offers in step 1.
export interface CampaignTemplate {
  kind: string;      // template id ("aeration", …, "custom"); vertical-specific
  label: string;
  blurb: string;
  season: string;    // informational ("Aug – Oct")
  icon: LucideIcon;
  subject: string;
  body: string;      // uses this vertical's merge tags
}

export interface CampaignsModule {
  /** Built-in templates offered by the campaign wizard. */
  templates: CampaignTemplate[];
  /** The template kind selected by default when composing a new campaign. */
  defaultKind: string;
  /** Trade-specific copy on the campaigns surfaces. */
  copy: {
    pageSubtitle: string;
    emptyStateBlurb: string;
    previewFallbackBusinessName: string;
  };
}
