import { CloudSnow, Plus } from "lucide-react";

// WinterRoutesBanner — renders above the Routes week strip when the
// operator is in winter mode. Single line of explanatory copy + a
// "+ New storm route" affordance that scrolls the user to the existing
// "+" button in the page header (we don't re-implement creation here).
//
// The header's "+" button doesn't have a stable id; we scroll into view
// on the closest known anchor (the page <header>) which gives the user
// the same affordance with one fewer click.

export default function WinterRoutesBanner({
  onNewRoute,
}: {
  onNewRoute?: () => void;
}) {
  return (
    <div className="mx-4 mb-3 rounded-[14px] border border-[hsl(var(--rain))]/30 bg-[hsl(var(--rain-bg))] px-3.5 py-2.5 flex items-center gap-2.5">
      <div className="h-7 w-7 rounded-full bg-white/70 text-[hsl(var(--rain))] grid place-items-center shrink-0">
        <CloudSnow className="h-3.5 w-3.5" strokeWidth={1.9} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold text-[hsl(var(--rain))]">
          Winter mode: routes are storm-driven, not weekly.
        </div>
      </div>
      <button
        type="button"
        onClick={onNewRoute}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[hsl(var(--rain))] text-white text-[11.5px] font-bold whitespace-nowrap hover:opacity-90 transition-opacity"
      >
        <Plus className="h-3 w-3" strokeWidth={2.6} />
        New storm route
      </button>
    </div>
  );
}
