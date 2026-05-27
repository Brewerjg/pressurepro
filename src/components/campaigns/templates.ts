// Campaign templates — built-in starting points the wizard offers in Step 1.
//
// Each preset prefills the campaign's `kind`, `subject`, and `body`. The
// body uses three merge tags that the send-campaign edge fn resolves per
// recipient: {first_name}, {address}, {business_name}.
//
// Tip: the SMS path auto-trims to ~320 chars, so SMS-heavy templates
// stay deliberately short. Email-only templates can be longer.

import type { LucideIcon } from "lucide-react";
import { CloudSnow, Leaf, MessageCircle, Sparkles, Sprout } from "lucide-react";

export type CampaignKind =
  | "aeration"
  | "leaf_cleanup"
  | "spring_restart"
  | "fert_program"
  | "snow_signup"
  | "custom";

export interface CampaignTemplate {
  kind: CampaignKind;
  label: string;
  blurb: string;
  /** When this template makes sense — purely informational, not enforced. */
  season: string;
  icon: LucideIcon;
  subject: string;
  body: string;
}

export const TEMPLATES: CampaignTemplate[] = [
  {
    kind: "aeration",
    label: "Aeration push",
    blurb:
      "Core aeration sells itself in late summer. Best window: August through October.",
    season: "Aug – Oct",
    icon: Leaf,
    subject: "Fall aeration — get on the schedule",
    body: `Hi {first_name},

Fall is the best time to aerate your lawn at {address}. Core aeration relieves soil compaction, lets water and fertilizer reach the roots, and sets the lawn up to come back thicker in the spring.

We're booking aeration visits now through October. Reply to this message or text us back to lock in a date.

— {business_name}`,
  },
  {
    kind: "leaf_cleanup",
    label: "Leaf cleanup signup",
    blurb:
      "October–November signup nudge. The lapsed-customer audience converts best here.",
    season: "Oct – Nov",
    icon: Leaf,
    subject: "Leaf cleanup — book your visit",
    body: `Hi {first_name},

The leaves are coming down. We're scheduling fall cleanups at {address} now — full property blow-out, beds cleared, lawn raked, debris hauled.

Most yards take one or two visits between mid-October and Thanksgiving. Reply with the date that works and we'll get you on the route.

— {business_name}`,
  },
  {
    kind: "spring_restart",
    label: "Spring restart",
    blurb:
      "March–April nudge to last year's customers to return to a weekly mow.",
    season: "Mar – Apr",
    icon: Sprout,
    subject: "Spring is here — restart your weekly mow",
    body: `Hi {first_name},

The grass is waking up. We're putting the weekly mow route back together for {address} and would love to keep you on the schedule.

Reply with a yes and we'll send a confirmation for your usual day. If your needs have changed (new cadence, added services, vacation skip) just let us know and we'll re-quote.

Thanks for another season,
— {business_name}`,
  },
  {
    kind: "fert_program",
    label: "Fert program enrollment",
    blurb:
      "5-step fertilizer + weed control program. Best pitched January–March.",
    season: "Jan – Mar",
    icon: Sparkles,
    subject: "Lock in your 5-step fert program",
    body: `Hi {first_name},

Want a thicker, greener lawn at {address} this year? Our 5-step program covers it from end to end:

  1. Early spring — pre-emergent + starter fert
  2. Late spring — broadleaf weed control
  3. Summer — slow-release nitrogen
  4. Early fall — recovery feed
  5. Late fall — winterizer

One price, scheduled visits, no thinking required. Reply to lock in this season.

— {business_name}`,
  },
  {
    kind: "snow_signup",
    label: "Snow season signup",
    blurb:
      "Winter announcement for northern markets — plow/shovel route reservation.",
    season: "Oct – Nov",
    icon: CloudSnow,
    subject: "Snow season — reserve your spot",
    body: `Hi {first_name},

Winter's around the corner. We're locking in the snow route for {address} now — driveway plow, walks shoveled, salt on request, dispatched per event.

Reserved customers get priority before storms. Reply to claim your spot or with any questions about per-event vs. seasonal pricing.

— {business_name}`,
  },
  {
    kind: "custom",
    label: "Custom",
    blurb: "Start from a blank message. Add merge tags as needed.",
    season: "Any time",
    icon: MessageCircle,
    subject: "",
    body: ``,
  },
];

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
