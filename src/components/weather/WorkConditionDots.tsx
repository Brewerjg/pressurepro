// Tiny three-dot verdict indicator: mow / spray / fert.
//
// Used in two places: the Home forecast strip (per-day cell) and the day
// detail sheet header. Extracted because both surfaces need to render the
// same indicator and the dot order / accessibility labels must stay in
// sync. Color comes from the parallel agent's `verdictColor()` helper in
// `src/lib/weather.ts` — we don't recompute color logic here.
//
// Defensive: if `workConditions` hasn't landed yet (parallel agent's edge
// fn / types rewrite still in flight), we render nothing rather than crash.

import { verdictColor, type DailyForecast } from "@/lib/weather";

type Verdict = "good" | "caution" | "block";

interface Props {
  day: DailyForecast;
  size?: "sm" | "md";
}

// Tooltip / aria text per verdict — operators need to know what a dot means
// without tapping into the detail sheet.
function describe(kind: "mowing" | "spraying" | "fertilizing", v: Verdict): string {
  const verbs: Record<Verdict, string> = {
    good: "Good to",
    caution: "Caution for",
    block: "Do not",
  };
  return `${verbs[v]} ${kind}`;
}

export default function WorkConditionDots({ day, size = "sm" }: Props) {
  // Defensive read — the contract guarantees workConditions but we tolerate
  // an undefined value during the transitional period while the parallel
  // agent's edge fn redeploys.
  const wc = day.workConditions;
  if (!wc) return null;

  const dot = size === "md" ? "h-2 w-2" : "h-1.5 w-1.5";
  const gap = size === "md" ? "gap-1.5" : "gap-1";

  // Order matters: matches the order operators read the detail sheet rows.
  const items: Array<{ key: "mowing" | "spraying" | "fertilizing"; v: Verdict }> = [
    { key: "mowing", v: wc.mowing },
    { key: "spraying", v: wc.spraying },
    { key: "fertilizing", v: wc.fertilizing },
  ];

  return (
    <div className={`flex items-center ${gap}`} aria-label="Work conditions">
      {items.map(({ key, v }) => (
        <span
          key={key}
          className={`${dot} rounded-full`}
          // Inline style via verdictColor() — keeps the source of truth in
          // weather.ts so a palette change there fans out automatically.
          style={{ backgroundColor: verdictColor(v) }}
          title={describe(key, v)}
          aria-label={describe(key, v)}
        />
      ))}
    </div>
  );
}
