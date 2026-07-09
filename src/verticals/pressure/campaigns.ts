import { Briefcase, Droplet, Fence, Leaf, Sparkles } from "lucide-react";
import type { CampaignTemplate, CampaignsModule } from "@/verticals/campaigns";

const PRESSURE_TEMPLATES: CampaignTemplate[] = [
  {
    kind: "spring_signup",
    label: "Spring power-wash signup",
    blurb: "March kickoff to clean up winter grime. Save 10% pulls folks off the fence.",
    season: "March",
    icon: Sparkles,
    subject: "Spring's here — let's wash off winter",
    body: `Hi {first_name},

Spring's here. Your driveway, siding, and deck have probably picked up a winter's worth of grime, salt, and mildew.

Book a wash with us this month and we'll take 10% off the bill. We're starting routes the first week of March and slots fill fast.

Reply YES and we'll lock in your date.

— {business_name}`,
  },
  {
    kind: "pre_winter_wash",
    label: "Pre-winter house wash",
    blurb: "October nudge — clean siding before the leaves and freeze lock dirt in.",
    season: "October",
    icon: Leaf,
    subject: "Get the house washed before the leaves drop",
    body: `Hi {first_name},

October is the last clean window. Once leaves come down and temps drop, dirt and mildew on your siding lock in for the winter.

We're scheduling pre-winter house washes through the end of the month. Limited slots — soft-wash, gutter exteriors, sidewalks all included.

Reply with a yes and we'll send a confirmation for your usual day.

— {business_name}`,
  },
  {
    kind: "fence_deck_refresh",
    label: "Fence + deck refresh",
    blurb: "April push — soft-wash and brighten wood before peak yard season.",
    season: "April",
    icon: Fence,
    subject: "Bring your fence + deck back this April",
    body: `Hi {first_name},

Fences and decks take the brunt of winter — gray, green, mossy. We can bring the wood back.

Our April fence + deck package is a soft-wash plus a brightener to lift the gray and pop the natural color. Quick to schedule, big visual difference, and it prolongs the wood.

Reply to grab an April slot.

— {business_name}`,
  },
  {
    kind: "commercial_requote",
    label: "Commercial property re-quote",
    blurb: "Year-end check-in with commercial accounts to lock in next year's contract.",
    season: "Nov – Dec",
    icon: Briefcase,
    subject: "End-of-year wash contract review",
    body: `Hi {first_name},

End-of-year check-in. We'd like to revisit your annual pressure-washing contract for next year — same scope, updated pricing, and any tweaks you want to make to the schedule.

Reply and we'll set up a 15-minute call to walk through it. If you want to add storefronts, awnings, dumpster pads, or extra visits, this is the easy time to do it.

— {business_name}`,
  },
  {
    kind: "roof_softwash",
    label: "Roof soft-wash",
    blurb: "April–May push — kill algae before it eats the shingles. High-margin add-on.",
    season: "Apr – May",
    icon: Droplet,
    subject: "Black streaks on your roof? It's algae.",
    body: `Hi {first_name},

Those black streaks on your roof are algae, and they're slowly eating your shingles. Left alone they shorten roof life by years.

We soft-wash roofs with a low-pressure mix that's safe for the shingles, kills the algae, and brings the roof back to clean. One visit, big improvement.

Reply if you want a quick estimate — most jobs come in under a few hundred dollars.

— {business_name}`,
  },
  {
    kind: "custom",
    label: "Custom",
    blurb: "Start from a blank message. Add merge tags as needed.",
    season: "Any time",
    icon: Sparkles,
    subject: "",
    body: "",
  },
];

export const pressureCampaigns: CampaignsModule = {
  templates: PRESSURE_TEMPLATES,
  defaultKind: "spring_signup",
  copy: {
    pageSubtitle: "Seasonal blasts to fill your route.",
    emptyStateBlurb: "No campaigns yet. Pick a seasonal template to reach past customers.",
    previewFallbackBusinessName: "your wash crew",
  },
};
