// Pre-application advisory card for ApplicationCalc — answers "should I
// spray right now?" before the operator touches the calc inputs.
//
// The verdict pill, data points, and warning list all come from the same
// server-computed workConditions object the Home strip uses. We never
// recompute spray-ability here — if the strip and this card disagree, the
// bug is in the edge function, not in two different React heuristics.

import { CheckCircle2, AlertTriangle, XCircle, Wind, Thermometer, CloudRain } from "lucide-react";
import {
  mostSevereVerdict,
  type DailyForecast,
  type HourlyForecast,
} from "@/lib/weather";

interface Props {
  // The DailyForecast row representing TODAY (Home.tsx already finds this
  // by matching `isToday(day.date)`; we accept it as a prop to keep this
  // component dumb).
  day: DailyForecast;
  // Hourly array from the forecast response — used to derive "rain in next
  // 4 hours" so the operator knows if they have a tank-friendly window.
  hourly: HourlyForecast[];
}

type Verdict = "good" | "caution" | "block";

const VERDICT_COPY: Record<Verdict, { headline: string; Icon: typeof CheckCircle2 }> = {
  good: { headline: "Good to spray", Icon: CheckCircle2 },
  caution: { headline: "Caution — verify before spraying", Icon: AlertTriangle },
  block: { headline: "Don't spray today", Icon: XCircle },
};

// Same Tailwind triplet used in DayDetailSheet's VerdictPill — keep these
// in sync so the spray card colors match the per-day sheet.
function verdictClasses(v: Verdict) {
  if (v === "good") {
    return {
      card: "border-green-100 bg-green-50",
      pill: "text-green-700 bg-white border-green-100",
      icon: "text-green-700",
      text: "text-green-700",
    };
  }
  if (v === "caution") {
    return {
      card: "border-bronze-400 bg-bronze-100",
      pill: "text-bronze-600 bg-white border-bronze-400",
      icon: "text-bronze-600",
      text: "text-bronze-700",
    };
  }
  return {
    card: "border-destructive/30 bg-[hsl(var(--destructive-bg))]",
    pill: "text-destructive bg-white border-destructive/30",
    icon: "text-destructive",
    text: "text-destructive",
  };
}

// Look ahead 4 hours from "now" and pick the max precip chance. Operators
// typically need a 3-4 hour dry window after spraying for the chemistry to
// translocate; we surface the peak so they can decide whether to wait.
function peakPopNext4h(hourly: HourlyForecast[]): { pct: number; hour: string | null } {
  if (!hourly.length) return { pct: 0, hour: null };
  const nowSec = Math.floor(Date.now() / 1000);
  const window = hourly.filter((h) => h.dt >= nowSec && h.dt <= nowSec + 4 * 3600);
  if (!window.length) return { pct: 0, hour: null };
  let peak = window[0];
  for (const h of window) {
    if (h.precipChance > peak.precipChance) peak = h;
  }
  return { pct: peak.precipChance, hour: peak.hour };
}

export default function SprayConditionsCard({ day, hourly }: Props) {
  // Defensive — if the parallel agent's contract hasn't fully landed, fall
  // back to "caution" so we still render something rather than crashing on
  // mostSevereVerdict() of undefined.
  const wc = day.workConditions;
  const sprayVerdict: Verdict = wc?.spraying ?? "caution";

  // mostSevereVerdict() of the full workConditions trio gives us the
  // "stop sign" priority — but for THIS card we care specifically about
  // spraying; we just use the helper as a sanity check (and for the
  // headline upgrade from caution -> block when any discipline is blocked).
  const overall = wc ? mostSevereVerdict(wc) : sprayVerdict;
  // The headline reflects the SPRAY verdict directly (the card is about
  // spraying, not mowing) — `overall` is only used to surface non-spray
  // blockers in the warning list below.
  const v = sprayVerdict;
  const copy = VERDICT_COPY[v];
  const cls = verdictClasses(v);
  const sprayWarnings =
    wc?.warnings?.filter((w) => w.affects.includes("spraying")) ?? [];

  const { pct: rainPct4h, hour: rainHour } = peakPopNext4h(hourly);

  return (
    <section className="mx-4 mb-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-ink-500 px-1 pb-2">
        Today's spray conditions
      </div>
      <div className={`rounded-[14px] border px-4 py-3.5 ${cls.card}`}>
        <div className="flex items-center gap-3">
          <copy.Icon className={`h-6 w-6 shrink-0 ${cls.icon}`} strokeWidth={1.9} />
          <div className="flex-1 min-w-0">
            <div className={`text-[14.5px] font-bold ${cls.text}`}>
              {copy.headline}
            </div>
            <div className="text-[11.5px] text-ink-700/80">
              {day.conditions} · {Math.round(day.high)}° / {Math.round(day.low)}°
            </div>
          </div>
          <span
            className={`text-[10.5px] font-semibold uppercase tracking-[0.4px] px-2 py-0.5 rounded-full border ${cls.pill}`}
          >
            {v === "good" ? "Good" : v === "caution" ? "Caution" : "Block"}
          </span>
        </div>

        {/* Inline warning list — only when caution/block. We render the
            server-provided messages verbatim; copy lives in the edge fn so
            other surfaces (Routes, Plans) can reuse the same strings. */}
        {(v === "caution" || v === "block" || overall === "block") &&
          sprayWarnings.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-1 pl-1">
              {sprayWarnings.map((w, i) => (
                <li
                  key={`${w.kind}-${i}`}
                  className={`text-[12px] flex items-start gap-1.5 ${cls.text}`}
                >
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-current shrink-0 opacity-70" />
                  <span className="text-ink-700">{w.message}</span>
                </li>
              ))}
            </ul>
          )}

        {/* Data points — wind, low, rain next 4h. These are the three
            metrics every spray-ability decision turns on. */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-current/10">
          <DataPoint
            Icon={Wind}
            label="Wind"
            value={`${Math.round(day.windMph)}`}
            suffix={`mph · g${Math.round(day.windGustMph)}`}
          />
          <DataPoint
            Icon={Thermometer}
            label="Low"
            value={`${Math.round(day.low)}°`}
            // 35°F frost threshold matches deriveTone() in weather.ts.
            suffix={day.low < 35 ? "frost" : "OK"}
            highlight={day.low < 35}
          />
          <DataPoint
            Icon={CloudRain}
            label="Rain 4h"
            value={`${Math.round(rainPct4h)}%`}
            suffix={rainHour ? `peak ${rainHour}` : "no data"}
            highlight={rainPct4h >= 40}
          />
        </div>
      </div>
    </section>
  );
}

function DataPoint({
  Icon,
  label,
  value,
  suffix,
  highlight,
}: {
  Icon: typeof Wind;
  label: string;
  value: string;
  suffix: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.4px] text-ink-500">
        <Icon className="h-3 w-3" strokeWidth={1.8} />
        {label}
      </div>
      <div className="tp-num text-[15px] font-bold text-ink-900">{value}</div>
      <div
        className={`text-[10.5px] font-medium ${
          highlight ? "text-destructive" : "text-ink-500"
        }`}
      >
        {suffix}
      </div>
    </div>
  );
}
