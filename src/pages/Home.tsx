import { Link } from "react-router-dom";
import {
  Bell,
  ArrowUp,
  Play,
  Sun,
  CloudRain,
  Cloud,
  CloudSnow,
  Wind,
  Snowflake,
  Camera,
  Calculator,
  StickyNote,
  DollarSign,
} from "lucide-react";

import { useForecast, useUserZip, type ForecastDay, type DerivedTone } from "@/lib/weather";

// Ported from design/turf/project/screen-home.jsx. MRR/hero card numbers stay
// hardcoded until the billing data layer lands; the forecast strip is now live
// (driven by useForecast against the OpenWeather edge fn). Drought heuristic
// is documented in src/lib/weather.ts (TODO note in deriveTone).

// Visual treatment tokens — keyed by the new derived_tone palette. "today"
// is a positional accent the forecast logic doesn't produce, so it's applied
// to whichever day matches today regardless of tone.
type ForecastTone = DerivedTone | "today";
const forecastTone: Record<
  ForecastTone,
  { container: string; label: string; icon: string; value: string }
> = {
  ok:      { container: "bg-transparent",       label: "text-ink-700/70",        icon: "text-ink-400",          value: "text-ink-700" },
  today:   { container: "bg-green-800",         label: "text-bronze-400/90",     icon: "text-bronze-400",       value: "text-white" },
  rain:    { container: "bg-[hsl(var(--rain-bg))]",    label: "text-[hsl(var(--rain))]/80",    icon: "text-[hsl(var(--rain))]",    value: "text-[hsl(var(--rain))]" },
  drought: { container: "bg-[hsl(var(--drought-bg))]", label: "text-[hsl(var(--drought))]/80", icon: "text-[hsl(var(--drought))]", value: "text-[hsl(var(--drought))]" },
  // Wind + frost re-use the rain tinting because they're equally "stop" signals
  // and we don't want to add new CSS vars in this wave.
  wind:    { container: "bg-[hsl(var(--rain-bg))]",    label: "text-[hsl(var(--rain))]/80",    icon: "text-[hsl(var(--rain))]",    value: "text-[hsl(var(--rain))]" },
  frost:   { container: "bg-[hsl(var(--rain-bg))]",    label: "text-[hsl(var(--rain))]/80",    icon: "text-[hsl(var(--rain))]",    value: "text-[hsl(var(--rain))]" },
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(dateStr: string): string {
  // YYYY-MM-DD — parse as local date (the suffix matters; "2024-01-01" parses
  // as UTC, so we split + construct to avoid TZ off-by-one on the strip).
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  return DOW_LABELS[new Date(y, m - 1, d).getDay()];
}

function isToday(dateStr: string): boolean {
  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return today === dateStr;
}

function iconFor(d: ForecastDay) {
  if (d.derived_tone === "frost") return Snowflake;
  if (d.derived_tone === "wind") return Wind;
  if (d.condition === "rain") return CloudRain;
  if (d.condition === "snow") return CloudSnow;
  if (d.condition === "cloud") return Cloud;
  return Sun;
}

const quickActions = [
  { icon: Camera,       label: "Photo pair",    sub: "Before / after",    accent: "text-green-600",  to: "/photos/new" },
  { icon: Calculator,   label: "Application",   sub: "NPK · per 1000ft²", accent: "text-bronze-600", to: "/calc" },
  { icon: StickyNote,   label: "Chemical log",  sub: "Compliance record", accent: "text-green-700",  to: "/chem-log" },
  { icon: DollarSign,   label: "One-off quote", sub: "Spring cleanup +",  accent: "text-ink-700",    to: null },
];

export default function Home() {
  const progressSegments = Array.from({ length: 11 });
  const zipQ = useUserZip();
  const forecast = useForecast(zipQ.data);

  // Decision summaries for the chip row beneath the strip. We derive these
  // from the *forecast*, not from hardcoded text, so they always agree with
  // the strip's colored cells.
  const rainDays = (forecast.data ?? []).filter((d) => d.derived_tone === "rain");
  const droughtDays = (forecast.data ?? []).filter((d) => d.derived_tone === "drought");

  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-[18px] flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            Wednesday · May 20
          </div>
          <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5 whitespace-nowrap">
            Good morning, Mike
          </h1>
        </div>
        <button
          type="button"
          className="relative h-10 w-10 rounded-full border border-ink-200 bg-card flex items-center justify-center"
          aria-label="Notifications"
        >
          <Bell className="h-[18px] w-[18px] text-ink-700" strokeWidth={1.7} />
          <span className="absolute top-[9px] right-[11px] h-1.5 w-1.5 rounded-full bg-bronze-500" />
        </button>
      </header>

      {/* MRR hero */}
      <section className="mx-4 mb-3.5 rounded-[22px] bg-gradient-hero-deep text-white px-[22px] pt-5 pb-[22px] relative overflow-hidden shadow-[0_8px_24px_-10px_hsl(148_75%_12%_/_0.5)]">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 14px)",
          }}
        />
        <div className="relative">
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-[11px] font-semibold tracking-[1px] uppercase text-bronze-400">
              Monthly recurring
            </div>
            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#cfead8] bg-white/10 px-2 py-1 rounded-full">
              <ArrowUp className="h-3 w-3" strokeWidth={2.2} /> +8.4% mo/mo
            </div>
          </div>
          <div className="tp-display tp-num text-[48px] font-bold leading-none tracking-[-0.04em]">
            $14,820
            <span className="text-lg text-bronze-400 font-semibold ml-1">/mo</span>
          </div>
          <div className="flex gap-6 mt-4 pt-3.5 border-t border-white/10">
            <Stat value="67"   label="Active plans" />
            <Stat value="2.1%" label="Churn 30d" />
            <Stat value="$221" label="Avg/customer" />
          </div>
        </div>
      </section>

      {/* Today's route */}
      <section className="mx-4 mb-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="text-[13px] font-semibold text-ink-700 tracking-[0.2px]">Today's route</h2>
          <span className="text-xs text-ink-500">Wednesday crew</span>
        </div>
        <div className="tp-card p-4">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex gap-[18px]">
              <SummaryStat value="11"             unit="" sub="stops" />
              <div className="w-px bg-ink-200" />
              <SummaryStat value="23"             unit=" mi" sub="drive total" />
              <div className="w-px bg-ink-200" />
              <SummaryStat value="6.5"            unit=" h" sub="est." />
            </div>
          </div>

          {/* Progress segments */}
          <div className="flex gap-[3px] mb-3.5">
            {progressSegments.map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-1.5 rounded-[3px] ${
                  i < 3 ? "bg-green-600" : i === 3 ? "bg-bronze-500" : "bg-ink-100"
                }`}
              />
            ))}
          </div>

          {/* Up next */}
          <div className="flex items-center gap-3 px-3 py-2.5 bg-green-50 rounded-xl mb-3">
            <div className="h-8 w-8 rounded-full bg-green-800 text-white grid place-items-center text-[13px] font-bold">
              4
            </div>
            <div className="flex-1">
              <div className="text-[11px] font-semibold tracking-[0.3px] uppercase text-green-700">
                Up next
              </div>
              <div className="text-sm font-semibold text-ink-900">411 Lantana Ave</div>
            </div>
            <div className="text-[11px] font-semibold text-green-700">2 mi · 7 min</div>
          </div>

          <Link
            to="/routes"
            className="w-full rounded-[14px] bg-bronze-500 text-white py-3.5 font-bold text-[15px] tracking-[0.2px] flex items-center justify-center gap-2 shadow-bronze hover:bg-bronze-600 transition-colors"
          >
            <Play className="h-3.5 w-3.5" /> Start route
          </Link>
        </div>
      </section>

      {/* Weekly forecast — live from OpenWeather via the `forecast` edge fn */}
      <section className="mx-4 mb-3 mt-3.5">
        <h2 className="text-[13px] font-semibold text-ink-700 tracking-[0.2px] px-1 pb-2">
          This week
        </h2>

        {!forecast.hasZip && !zipQ.isLoading && (
          // Soft prompt — the rest of Home is fully usable without weather, so
          // we don't gate anything else behind ZIP.
          <div className="tp-card px-3.5 py-3 text-[12.5px] text-ink-600">
            Set your business ZIP in{" "}
            <Link to="/settings" className="font-semibold text-green-800 underline-offset-2 hover:underline">
              Settings
            </Link>{" "}
            to see live weather and skip-day suggestions.
          </div>
        )}

        {forecast.hasZip && (
          <>
            <div className="tp-card px-2 py-3 flex">
              {forecast.isLoading && (forecast.data?.length ?? 0) === 0 ? (
                // Skeleton row — matches the live row's geometry so the layout
                // doesn't jump when data arrives.
                Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 py-1.5">
                    <div className="h-2.5 w-7 rounded bg-ink-100" />
                    <div className="h-4 w-4 rounded-full bg-ink-100" />
                    <div className="h-3 w-6 rounded bg-ink-100" />
                  </div>
                ))
              ) : forecast.error ? (
                <div className="flex-1 py-2 text-center text-[12px] text-ink-500">
                  Weather unavailable.
                </div>
              ) : (
                (forecast.data ?? []).slice(0, 7).map((day) => {
                  const today = isToday(day.date);
                  const toneKey: ForecastTone = today ? "today" : day.derived_tone;
                  const tone = forecastTone[toneKey];
                  const Icon = iconFor(day);
                  return (
                    <div
                      key={day.date}
                      className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-xl ${tone.container}`}
                    >
                      <div className={`text-[10px] font-semibold tracking-[0.3px] ${tone.label}`}>
                        {dayLabel(day.date).toUpperCase()}
                      </div>
                      <Icon className={`h-4 w-4 ${tone.icon}`} strokeWidth={1.7} />
                      <div className={`tp-num text-[13px] font-bold ${tone.value}`}>
                        {day.temp_high}°
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Decision chips — derived from the forecast, not hardcoded copy */}
            <div className="flex gap-2 mt-2.5 px-1 flex-wrap">
              {rainDays.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-full bg-[hsl(var(--rain-bg))] text-[11.5px] font-semibold text-[hsl(var(--rain))]">
                  <CloudRain className="h-3 w-3" />
                  Skip {dayLabel(rainDays[0].date)}
                  {rainDays.length > 1 ? ` +${rainDays.length - 1}` : ""}
                </span>
              )}
              {droughtDays.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-full bg-[hsl(var(--drought-bg))] text-[11.5px] font-semibold text-[hsl(36_80%_35%)]">
                  <Sun className="h-3 w-3" />
                  Stretch {dayLabel(droughtDays[0].date)} to biweekly
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {/* Quick actions */}
      <section className="mx-4 mt-3.5 mb-1">
        <h2 className="text-[13px] font-semibold text-ink-700 px-1 pb-2">Quick actions</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {quickActions.map(({ icon: Icon, label, sub, accent, to }) => {
            const inner = (
              <>
                <div className={`h-[30px] w-[30px] rounded-[9px] bg-ink-100 grid place-items-center mb-2.5 ${accent}`}>
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                </div>
                <div className="text-[13.5px] font-semibold text-ink-900">{label}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">{sub}</div>
              </>
            );
            return to ? (
              <Link key={label} to={to} className="tp-card text-left px-3.5 pt-3.5 pb-3 block">
                {inner}
              </Link>
            ) : (
              <button key={label} type="button" className="tp-card text-left px-3.5 pt-3.5 pb-3">
                {inner}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="tp-num text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-[#a8c9b7] mt-px">{label}</div>
    </div>
  );
}

function SummaryStat({ value, unit, sub }: { value: string; unit: string; sub: string }) {
  return (
    <div>
      <div className="tp-num text-[22px] font-bold text-ink-900">
        {value}
        {unit && <span className="text-[13px] text-ink-500 font-medium">{unit}</span>}
      </div>
      <div className="text-[11px] text-ink-500 -mt-0.5">{sub}</div>
    </div>
  );
}
