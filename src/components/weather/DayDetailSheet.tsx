// Full-screen-on-mobile / centered-on-desktop sheet showing a single day's
// forecast. Opened from the Home forecast strip (per-day cell tap) or from
// the alerts banner above the strip. The component owns its own collapsible
// state for the per-discipline warning lists; the parent only controls
// open/close via `onClose`.
//
// The hourly preview only renders when the rendered day IS today — operators
// don't get hourly data for tomorrow / day-after, so showing an empty strip
// would be misleading.

import { useState } from "react";
import { vertical } from "@/vertical";
import {
  X,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  Wind,
  Droplets,
  Thermometer,
  Eye,
  Gauge,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import {
  verdictColor,
  type DailyForecast,
  type HourlyForecast,
} from "@/lib/weather";

interface Props {
  day: DailyForecast;
  hourly: HourlyForecast[];
  onClose: () => void;
}

// Lucide icon picker keyed to the OpenWeather-derived `condition` token.
// Mirrors the picker in Home.tsx so the sheet header doesn't look like a
// different app from the strip you tapped in from.
function ConditionIcon({
  condition,
  className,
}: {
  condition: DailyForecast["condition"];
  className?: string;
}) {
  const cls = className ?? "h-10 w-10";
  if (condition === "rain") return <CloudRain className={cls} strokeWidth={1.5} />;
  if (condition === "snow") return <CloudSnow className={cls} strokeWidth={1.5} />;
  if (condition === "cloud") return <Cloud className={cls} strokeWidth={1.5} />;
  return <Sun className={cls} strokeWidth={1.5} />;
}

// "2026-06-07" -> "Saturday, June 7". Parsed local to avoid UTC TZ slip.
function formatLongDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// Same local-date check Home uses — duplicated rather than imported to keep
// the sheet self-contained (it doesn't know which day Home tapped on).
function isTodayDate(dateStr: string): boolean {
  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return today === dateStr;
}

type Discipline = "mowing" | "spraying" | "fertilizing";
type Verdict = "good" | "caution" | "block";

const VERDICT_LABEL: Record<Verdict, string> = {
  good: "Good",
  caution: "Caution",
  block: "Block",
};

const DISCIPLINE_LABEL: Record<Discipline, string> = {
  mowing: "Mowing",
  spraying: "Spraying",
  fertilizing: "Fertilizing",
};

export default function DayDetailSheet({ day, hourly, onClose }: Props) {
  // Per-discipline expand state for the warnings drilldown. We default all
  // closed; users explicitly open the one that's blocking them.
  const [openRow, setOpenRow] = useState<Discipline | null>(null);

  // Defensive accessors — the parallel agent's contract guarantees these,
  // but we tolerate undefined during the rollout window.
  const wc = day.workConditions;
  const warnings = wc?.warnings ?? [];

  const showHourly = isTodayDate(day.date) && hourly.length > 0;

  // Stop click events on the inner sheet from bubbling to the backdrop.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Forecast detail for ${formatLongDate(day.date)}`}
    >
      <div
        className="w-full sm:max-w-md sm:rounded-[20px] bg-card overflow-y-auto max-h-screen sm:max-h-[90vh] shadow-card"
        onClick={stop}
      >
        {/* Header — sticky close button, day name + date, big condition icon. */}
        <div className="relative px-5 pt-5 pb-4 border-b border-neutral-100">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 h-9 w-9 rounded-full bg-neutral-100 grid place-items-center text-neutral-700 hover:bg-neutral-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>

          <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-neutral-500">
            {isTodayDate(day.date) ? "Today" : "Forecast"}
          </div>
          <h2 className="tp-display text-2xl font-bold text-neutral-900 mt-0.5 pr-10">
            {formatLongDate(day.date)}
          </h2>

          <div className="flex items-center gap-4 mt-4">
            <div className="text-brand-800">
              <ConditionIcon condition={day.condition} className="h-14 w-14" />
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className="tp-display tp-num text-[40px] font-bold text-neutral-900 leading-none">
                  {Math.round(day.high)}°
                </span>
                <span className="tp-num text-[18px] font-semibold text-neutral-500">
                  / {Math.round(day.low)}°
                </span>
              </div>
              <div className="text-[13px] text-neutral-700 mt-1 font-medium">
                {day.conditions}
              </div>
              <div className="text-[12px] text-neutral-500 mt-0.5">
                Feels like {Math.round(day.feelsLikeDay)}° today
              </div>
            </div>
          </div>
        </div>

        {/* Summary (OneCall v4 daily.summary) — italic so it reads like a
            caption rather than a section header. Hidden if null. */}
        {day.summary && (
          <div className="px-5 py-3.5 text-[12.5px] italic text-neutral-700 leading-relaxed border-b border-neutral-100">
            {day.summary}
          </div>
        )}

        {/* Work conditions — three rows, each tap-to-expand to show the
            warnings affecting that discipline. Lawn-only
            (vertical.season.workConditions). */}
        {vertical.season.workConditions && wc && (
          <SheetSection title="Work conditions">
            <div className="flex flex-col gap-1.5">
              {(["mowing", "spraying", "fertilizing"] as Discipline[]).map((d) => {
                const v = wc[d];
                const relevant = warnings.filter((w) => w.affects.includes(d));
                const open = openRow === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setOpenRow(open ? null : d)}
                    className="text-left rounded-[12px] border border-neutral-100 px-3 py-2.5 hover:bg-neutral-100/40 transition-colors"
                    aria-expanded={open}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 text-[13px] font-semibold text-neutral-900">
                        {DISCIPLINE_LABEL[d]}
                      </div>
                      <VerdictPill verdict={v} />
                      {relevant.length > 0 ? (
                        open ? (
                          <ChevronUp className="h-3.5 w-3.5 text-neutral-500" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-neutral-500" />
                        )
                      ) : (
                        // Spacer so verdict pills align across all rows
                        <span className="w-3.5" />
                      )}
                    </div>
                    {open && relevant.length > 0 && (
                      <ul className="mt-2 pl-2 flex flex-col gap-1">
                        {relevant.map((w, i) => (
                          <li
                            key={`${w.kind}-${i}`}
                            className="text-[11.5px] text-neutral-700 flex items-start gap-1.5"
                          >
                            <span
                              className="mt-1 h-1.5 w-1.5 rounded-full shrink-0"
                              style={{
                                backgroundColor: verdictColor(
                                  w.severity === "block"
                                    ? "block"
                                    : w.severity === "warn"
                                      ? "caution"
                                      : "good",
                                ),
                              }}
                            />
                            <span>{w.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                );
              })}
            </div>
          </SheetSection>
        )}

        {/* Wind — direction badge looks like a compass; rotate the arrow
            inside by windDeg so it points the same way the wind is moving. */}
        <SheetSection title="Wind">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-full border-2 border-neutral-200 grid place-items-center text-[10px] font-bold text-neutral-700"
              title={`From ${day.windDir} (${Math.round(day.windDeg)}°)`}
            >
              {day.windDir}
            </div>
            <div className="flex-1 flex items-baseline gap-3">
              <div>
                <div className="tp-num text-[22px] font-bold text-neutral-900">
                  {Math.round(day.windMph)}
                </div>
                <div className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wide">
                  mph
                </div>
              </div>
              <div>
                <div className="tp-num text-[16px] font-semibold text-neutral-700">
                  {Math.round(day.windGustMph)}
                </div>
                <div className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wide">
                  gusts
                </div>
              </div>
            </div>
            <Wind className="h-5 w-5 text-neutral-400" strokeWidth={1.7} />
          </div>
        </SheetSection>

        {/* Morning / Day / Night feels-like trio — operators use this to
            decide when to schedule heat-sensitive applications. */}
        <SheetSection title="Temperature">
          <div className="grid grid-cols-3 gap-2">
            <TempBlock label="Morning" feels={day.feelsLikeMorn} />
            <TempBlock label="Day" feels={day.feelsLikeDay} />
            <TempBlock label="Night" feels={day.feelsLikeNight} />
          </div>
        </SheetSection>

        {/* Humidity / dew / cloud / UV — flat grid; values are read-at-a-
            glance, no charts. */}
        <SheetSection title="Atmosphere">
          <div className="grid grid-cols-2 gap-2">
            <AtmoStat
              Icon={Droplets}
              label="Humidity"
              value={`${Math.round(day.humidity)}%`}
            />
            <AtmoStat
              Icon={Thermometer}
              label="Dew point"
              value={`${Math.round(day.dewPoint)}°`}
            />
            <AtmoStat
              Icon={Cloud}
              label="Cloud cover"
              value={`${Math.round(day.cloudCover)}%`}
            />
            <AtmoStat
              Icon={Eye}
              label="UV index"
              value={`${day.uvi.toFixed(1)}`}
            />
          </div>
        </SheetSection>

        {/* Precip — show even when zero so operators can sanity-check the
            "no rain expected" verdict that drove their scheduling. */}
        <SheetSection title="Precipitation">
          <div className="flex items-center gap-3">
            <Gauge className="h-5 w-5 text-neutral-400" strokeWidth={1.7} />
            <div className="flex-1">
              <div className="tp-num text-[20px] font-bold text-neutral-900">
                {Math.round(day.precipChance)}%
              </div>
              <div className="text-[11px] text-neutral-500">chance of precipitation</div>
            </div>
            <div className="text-right">
              {day.rainInches > 0 && (
                <div className="text-[12px] text-neutral-700">
                  <span className="tp-num font-semibold">
                    {day.rainInches.toFixed(2)}"
                  </span>{" "}
                  rain
                </div>
              )}
              {day.snowInches > 0 && (
                <div className="text-[12px] text-neutral-700">
                  <span className="tp-num font-semibold">
                    {day.snowInches.toFixed(2)}"
                  </span>{" "}
                  snow
                </div>
              )}
              {day.rainInches === 0 && day.snowInches === 0 && (
                <div className="text-[11px] text-neutral-500">No accumulation expected</div>
              )}
            </div>
          </div>
        </SheetSection>

        {/* Hourly preview — only today. Horizontal scroll, hour + icon +
            temp + pop. The 24h window gives operators a "rain at 2pm"
            without leaving Home. */}
        {showHourly && (
          <SheetSection title="Next 24 hours">
            <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
              {hourly.slice(0, 24).map((h) => (
                <HourCell key={h.dt} hour={h} />
              ))}
            </div>
          </SheetSection>
        )}

        <div className="h-4" />
      </div>
    </div>
  );
}

// =====================================================================
// Sub-components — scoped to the sheet, not exported.
// =====================================================================

function SheetSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 py-3.5 border-b border-neutral-100 last:border-b-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-neutral-500 pb-2">
        {title}
      </div>
      {children}
    </section>
  );
}

function VerdictPill({ verdict }: { verdict: Verdict }) {
  // Tailwind class trios per verdict — same triplet appears in
  // SprayConditionsCard and is documented in the project visual spec.
  const cls =
    verdict === "good"
      ? "text-brand-700 bg-brand-50 border-brand-100"
      : verdict === "caution"
        ? "text-accent-600 bg-accent-100 border-accent-400"
        : "text-destructive bg-[hsl(var(--destructive-bg))] border-destructive/30";

  return (
    <span
      className={`text-[10.5px] font-semibold uppercase tracking-[0.4px] px-2 py-0.5 rounded-full border ${cls}`}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

function TempBlock({ label, feels }: { label: string; feels: number }) {
  return (
    <div className="rounded-[12px] border border-neutral-100 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.4px] text-neutral-500">
        {label}
      </div>
      <div className="tp-num text-[18px] font-bold text-neutral-900 mt-0.5">
        {Math.round(feels)}°
      </div>
      <div className="text-[10px] text-neutral-500">feels like</div>
    </div>
  );
}

function AtmoStat({
  Icon,
  label,
  value,
}: {
  Icon: typeof Droplets;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[12px] border border-neutral-100 px-3 py-2.5 flex items-center gap-2.5">
      <Icon className="h-4 w-4 text-neutral-400" strokeWidth={1.7} />
      <div className="flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.4px] text-neutral-500">
          {label}
        </div>
        <div className="tp-num text-[14px] font-bold text-neutral-900">{value}</div>
      </div>
    </div>
  );
}

function HourCell({ hour }: { hour: HourlyForecast }) {
  // Same icon picker as the day header, scaled down. POP renders only
  // when it's worth knowing about (>= 10%) so the strip isn't a wall of
  // tiny percentages.
  const showPop = hour.precipChance >= 10;
  return (
    <div className="shrink-0 w-14 rounded-[12px] border border-neutral-100 px-1.5 py-2 flex flex-col items-center gap-1 bg-card">
      <div className="text-[10px] font-semibold text-neutral-500">{hour.hour}</div>
      <div className="text-neutral-700">
        <ConditionIcon condition={hour.condition} className="h-4 w-4" />
      </div>
      <div className="tp-num text-[12.5px] font-bold text-neutral-900">
        {Math.round(hour.temp)}°
      </div>
      {showPop && (
        <div className="text-[9.5px] font-semibold text-[hsl(var(--rain))] flex items-center gap-0.5">
          <Droplets className="h-2.5 w-2.5" strokeWidth={2} />
          {Math.round(hour.precipChance)}%
        </div>
      )}
    </div>
  );
}

// Re-export AlertTriangle for symmetry — Home imports the same icon for the
// alerts banner. (Tree-shaken to nothing if Home imports lucide directly.)
export { AlertTriangle };
