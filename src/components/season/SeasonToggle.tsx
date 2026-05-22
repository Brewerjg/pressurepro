import { useState } from "react";
import { AlertCircle, Loader2, Snowflake, Sun, Sprout, Leaf } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  ALL_SEASONS,
  countAffectedPlans,
  seasonLabel,
  useSeason,
  useSwapSeason,
  type Season,
} from "@/lib/season";

// SeasonToggle — segmented control that flips the operator between the four
// seasons. Mounted in Settings under the "Season" section. The TO winter
// path and the FROM winter path each gate behind a confirm() with a live
// count of plans that will be affected.
//
// We don't allow flipping "to summer from summer" etc. to be a no-op — we
// still POST the change because some operators want season_changed_at to
// record the moment they re-confirmed (useful for audit). It's a single
// row update; cheap.

const SEASON_ICONS: Record<Season, typeof Snowflake> = {
  spring: Sprout,
  summer: Sun,
  fall: Leaf,
  winter: Snowflake,
};

export default function SeasonToggle() {
  const { user } = useAuth();
  const { season, isLoading } = useSeason();
  const swap = useSwapSeason();
  const [pending, setPending] = useState<Season | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const handleClick = async (next: Season) => {
    if (!user?.id || pending || swap.isPending) return;
    if (next === season) return;

    setPending(next);
    try {
      // Pre-query the count so the confirm dialog can show the real impact.
      // Only WINTER-direction swaps (to/from winter) pause/resume plans; the
      // spring<->summer or summer<->fall flips are pure cosmetic so we skip
      // the confirm UX there.
      const winterDirection = next === "winter" || season === "winter";
      if (winterDirection) {
        const affected = await countAffectedPlans(user.id, next);
        const message =
          next === "winter"
            ? `Switching to winter mode. This will pause your ${affected} active weekly/biweekly/monthly mow plan${affected === 1 ? "" : "s"} (they won't be billed or scheduled). Your snow-removal services and one-off plans stay active. Pause now?`
            : `Switching to ${seasonLabel(next).toLowerCase()} mode. This will resume the ${affected} mow plan${affected === 1 ? "" : "s"} that were paused for winter. Plans you paused manually won't be touched.`;
        if (!window.confirm(message)) {
          setPending(null);
          return;
        }
      }

      const result = await swap.mutateAsync(next);
      if (result.affected > 0) {
        setFlash(
          next === "winter"
            ? `Paused ${result.affected} mow plan${result.affected === 1 ? "" : "s"}`
            : `Resumed ${result.affected} mow plan${result.affected === 1 ? "" : "s"}`,
        );
      } else {
        setFlash(`Now in ${seasonLabel(next).toLowerCase()} mode`);
      }
      window.setTimeout(() => setFlash(null), 2400);
    } catch (e) {
      // Surface a minimal error — we lean on swap's `isError` state below
      // for sticky display. This flash just clears the in-flight UI.
      console.warn("[SeasonToggle] swap failed", e);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="tp-card p-4 space-y-3">
      <p className="text-[11px] text-ink-500 leading-relaxed">
        Winter mode pauses your recurring mow plans and switches Home + Routes
        to the storm-driven snow workflow. Flip back to resume them.
      </p>

      <div
        role="group"
        aria-label="Season"
        className="grid grid-cols-4 gap-1.5"
      >
        {ALL_SEASONS.map((s) => {
          const Icon = SEASON_ICONS[s];
          const on = s === season;
          const isPending = pending === s || (swap.isPending && pending === s);
          const isWinterCell = s === "winter";
          return (
            <button
              key={s}
              type="button"
              onClick={() => handleClick(s)}
              disabled={isLoading || !!pending || swap.isPending}
              aria-pressed={on}
              className={cn(
                "rounded-xl border px-2 py-2.5 flex flex-col items-center gap-1 transition-colors",
                on
                  ? isWinterCell
                    ? "bg-[hsl(var(--rain-bg))] border-[hsl(var(--rain))]/40 text-[hsl(var(--rain))]"
                    : "bg-green-50 border-green-700/30 text-green-800"
                  : "bg-card border-ink-200 text-ink-700 hover:bg-ink-100",
                "disabled:opacity-60",
              )}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Icon className="h-4 w-4" strokeWidth={1.8} />
              )}
              <span className="text-[11.5px] font-semibold">
                {seasonLabel(s)}
              </span>
            </button>
          );
        })}
      </div>

      {flash && (
        <div className="text-[11.5px] font-semibold text-green-800">
          {flash}
        </div>
      )}

      {swap.isError && (
        <p className="text-[11px] font-semibold text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {swap.error instanceof Error
            ? swap.error.message
            : "Couldn't update season"}
        </p>
      )}
    </div>
  );
}
