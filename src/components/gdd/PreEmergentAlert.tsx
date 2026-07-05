// PreEmergentAlert — card-sized banner that surfaces the crabgrass
// pre-emergent application window on Home. The whole component renders
// nothing when the window isn't actionable, so it can sit unconditionally
// in the Home composition without leaving an empty slot.
//
// Decision logic (matches the `compute-gdd` edge fn output):
//   too_early  → render only if opens_eta_days <= 21 (else hidden)
//   open       → render with green-700 treatment + tiny chart
//   closing    → render with bronze-500 treatment + tiny chart
//   missed     → render only if "recently missed" — since the edge fn does
//                not currently emit "days since missed", we render whenever
//                status is `missed` but use a muted destructive treatment.
//                A future schema additon (`missed_days_ago`) could refine
//                this to the "missed_for <= 14 days" rule from the spec.
//                TODO: surface `missed_days_ago` from the edge fn.
//
// The CTA deep-links to /calc?type=herbicide which ApplicationCalc.tsx reads
// to default the mode toggle to "liquid" + the save-form application_type
// to "herbicide".
import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import {
  Sprout,
  AlertCircle,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserZip } from "@/lib/weather";
import { useGddForecast, type PreEmergentStatus } from "@/lib/gdd";

// Lazy import — GddTinyChart pulls in recharts (~400 KB). PreEmergentAlert
// sits on Home (eager route), but the chart only renders for the `open` /
// `closing` statuses, which are a small slice of the year. Keeping recharts
// out of the Home critical path means most operators on most days never pay
// for it. The Reports page already lazy-loads the same chunk separately.
const GddTinyChart = lazy(() => import("./GddTinyChart"));

// Tone tokens keyed off pre_emergent.status. We stay inside the existing
// green/bronze/ink/destructive palette (no new CSS vars introduced).
const TONES: Record<
  PreEmergentStatus,
  {
    container: string;
    eyebrow: string;
    headline: string;
    sub: string;
    iconWrap: string;
    iconColor: string;
    cta: string;
    Icon: typeof Sprout;
    chartTone: "open" | "closing" | null;
  }
> = {
  open: {
    container: "tp-card bg-brand-50 border-brand-100",
    eyebrow: "text-brand-700",
    headline: "text-brand-900",
    sub: "text-brand-700/80",
    iconWrap: "bg-brand-700/10",
    iconColor: "text-brand-700",
    cta:
      "bg-brand-700 text-white hover:bg-brand-800",
    Icon: Sprout,
    chartTone: "open",
  },
  closing: {
    container: "tp-card bg-accent-100 border-accent-100",
    eyebrow: "text-accent-600",
    headline: "text-accent-700",
    sub: "text-accent-700/80",
    iconWrap: "bg-accent-500/15",
    iconColor: "text-accent-600",
    cta:
      "bg-accent-500 text-white hover:bg-accent-600",
    Icon: AlertCircle,
    chartTone: "closing",
  },
  too_early: {
    container: "tp-card",
    eyebrow: "text-neutral-500",
    headline: "text-neutral-900",
    sub: "text-neutral-500",
    iconWrap: "bg-neutral-100",
    iconColor: "text-neutral-500",
    cta: "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
    Icon: Sprout,
    chartTone: null,
  },
  missed: {
    container:
      "tp-card bg-[hsl(var(--destructive)_/_0.06)] border-[hsl(var(--destructive)_/_0.18)]",
    eyebrow: "text-destructive",
    headline: "text-neutral-900",
    sub: "text-neutral-500",
    iconWrap: "bg-[hsl(var(--destructive)_/_0.1)]",
    iconColor: "text-destructive",
    cta:
      "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
    Icon: AlertCircle,
    chartTone: null,
  },
};

export default function PreEmergentAlert() {
  const zipQ = useUserZip();
  const gdd = useGddForecast(zipQ.data);

  // Render nothing while we don't have a zip OR we're still loading. Home
  // already has a "set ZIP" prompt elsewhere; we don't want to duplicate it.
  if (!gdd.hasZip) return null;
  if (gdd.isLoading || !gdd.data) return null;
  if (gdd.error) return null;

  const { pre_emergent: pe, cumulative_gdd_ytd, series } = gdd.data;

  // Actionability filter — don't crowd Home with not-yet-relevant alerts.
  if (pe.status === "too_early") {
    const eta = pe.opens_eta_days;
    // Hide if the window is more than 21 days out (or unknown / beyond
    // forecast horizon, since we can't promise it's coming soon).
    if (eta === null || eta > 21) return null;
  }
  // `missed` rendering is gated upstream by a "recently missed" rule; see
  // header comment. With no missed_days_ago today we still render in the
  // muted destructive treatment so the operator at least gets the heads-up
  // that the window has closed. If this proves noisy we'll wire the days-ago
  // signal and hide past 14 days.

  const tone = TONES[pe.status];
  const Icon = tone.Icon;

  // The cumulative-GDD sub copy is the same regardless of status. Keep the
  // /200 denominator so operators internalize the window scale.
  const cumulativeCopy = `Cumulative GDD ${Math.round(cumulative_gdd_ytd)} / ${200} (base 50°F)`;

  return (
    <section className="mx-4 mb-3.5">
      <div className={cn("px-4 pt-3.5 pb-3.5", tone.container)}>
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "h-9 w-9 rounded-[10px] grid place-items-center shrink-0",
              tone.iconWrap,
            )}
          >
            <Icon
              className={cn("h-[18px] w-[18px]", tone.iconColor)}
              strokeWidth={1.8}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "text-[10.5px] font-semibold uppercase tracking-[0.5px]",
                tone.eyebrow,
              )}
            >
              Pre-emergent watch
            </div>
            <div
              className={cn(
                "text-[14.5px] font-bold leading-snug mt-0.5",
                tone.headline,
              )}
            >
              {pe.window_summary}
            </div>
            <div className={cn("text-[11.5px] mt-0.5 tp-num", tone.sub)}>
              {cumulativeCopy}
            </div>
          </div>
        </div>

        {tone.chartTone && series && series.length > 0 && (
          <div className="mt-2.5">
            <Suspense fallback={<div className="h-[80px]" />}>
              <GddTinyChart series={series} tone={tone.chartTone} />
            </Suspense>
          </div>
        )}

        <Link
          to="/calc?type=herbicide"
          className={cn(
            "mt-3 w-full rounded-[12px] py-2.5 text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-colors",
            tone.cta,
          )}
        >
          {pe.status === "open" || pe.status === "closing" ? (
            <TrendingUp className="h-3.5 w-3.5" strokeWidth={2} />
          ) : null}
          Open calculator
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </div>
    </section>
  );
}
