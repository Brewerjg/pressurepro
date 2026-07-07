// Merge-tag helpers for campaign preview and send.
// Templates are now defined per-vertical (see verticals/lawn/campaigns.ts).
// The CampaignTemplate type is re-exported here for convenience.

import type { CampaignTemplate } from "@/verticals/campaigns";
export type { CampaignTemplate };

// Available merge-tag keys for the preview pane.
export const MERGE_TAGS = ["{first_name}", "{address}", "{business_name}"] as const;

/** Apply merge tags client-side for the preview. */
export function applyMergeTags(
  template: string,
  vars: { first_name: string; address: string; business_name: string },
): string {
  return template
    .replaceAll("{first_name}", vars.first_name)
    .replaceAll("{address}", vars.address)
    .replaceAll("{business_name}", vars.business_name);
}
