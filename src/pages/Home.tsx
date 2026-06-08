import { useState } from "react";
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
  BarChart3,
  TrendingUp,
  Users,
  MapPin,
  FileText,
  MessageSquare,
  AlertTriangle,
  Ban,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useForecast, useUserZip, type ForecastDay, type DerivedTone } from "@/lib/weather";
import PreEmergentAlert from "@/components/gdd/PreEmergentAlert";
import WinterHomeCard from "@/components/season/WinterHomeCard";
import WorkConditionDots from "@/components/weather/WorkConditionDots";
import DayDetailSheet from "@/components/weather/DayDetailSheet";
import { useSeason } from "@/lib/season";
import { TWILIO_ENABLED } from "@/lib/feature-flags";
import { APP_ID } from "@/lib/app-context";

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

function getGreeting(name: string | null | undefined): string {
  const hour = new Date().getHours();
  const timeOfDay =
    hour < 12 ? "Good morning" :
    hour < 17 ? "Good afternoon" :
    "Good evening";

  if (name) {
    // Get first name only
    const firstName = name.split(" ")[0];
    return `${timeOfDay}, ${firstName}`;
  }
  return timeOfDay;
}

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
  { icon: FileText,     label: "Quotes",        sub: "One-off jobs",       accent: "text-bronze-600", to: "/quotes" },
  { icon: MessageSquare,label: "Inbox",         sub: "Customer texts",     accent: "text-green-700",  to: "/inbox" },
  { icon: Camera,       label: "Photo pair",    sub: "Before / after",     accent: "text-green-600",  to: "/photos/new" },
  { icon: Calculator,   label: "Application",   sub: "NPK · per 1000ft²",  accent: "text-bronze-600", to: "/calc" },
  { icon: StickyNote,   label: "Chemical log",  sub: "Compliance record",  accent: "text-green-700",  to: "/chem-log" },
  { icon: BarChart3,    label: "Reports",       sub: "MRR · churn · $/hr", accent: "text-ink-700",    to: "/reports" },
];

export default function Home() {
  const { user } = useAuth();
  const progressSegments = Array.from({ length: 11 });
  const zipQ = useUserZip();
  const forecast = useForecast(zipQ.data);
  const { isWinter } = useSeason();

  // Selected day for the detail sheet — controls the modal. We hold the
  // date string (not the day object) so re-fetches don't keep a stale
  // snapshot open. The lookup happens at render time.
  const [openDayDate, setOpenDayDate] = useState<string | null>(null);

  // Defensive accessors — `useForecast` exposes the rich ForecastResponse
  // under `.full` (current, hourly, alerts) and the day array under `.data`.
  // The `.full ?? forecast` fallback covers a transitional window if the
  // edge fn ever flattens the shape.
  const fc: any = (forecast as any).full ?? (forecast as any);
  const alerts: any[] = (fc?.alerts as any[]) ?? [];
  const hourly: any[] = (fc?.hourly as any[]) ?? [];
  const days: any[] = (forecast.data ?? []) as any[];
  const openDay = openDayDate
    ? days.find((d) => d.date === openDayDate) ?? null
    : null;

  // Find the first day with a spray-blocking warning so we can surface a
  // chip ("No spray Tue (wind)"). We pick the FIRST blocking day so the
  // chip is actionable today/tomorrow; a "first 3 days" filter avoids
  // chirping about Saturday's forecast on Monday morning.
  const sprayBlockedDay = days.slice(0, 3).find((d: any) => {
    const wc = d?.workConditions;
    if (!wc) return false;
    return wc.spraying === "block";
  });
  const sprayBlockWarning = sprayBlockedDay?.workConditions?.warnings?.find(
    (w: any) => w.affects?.includes("spraying") && w.severity === "block",
  );

  // Fetch user profile to check if demo and get business name
  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("name, business_name, is_demo")
        .or(`id.eq.${user!.id},user_id.eq.${user!.id}`)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Fetch customer count and calculate basic MRR
  const { data: stats } = useQuery({
    queryKey: ["home-stats", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Get customer count
      const { count: customerCount, error: custError } = await supabase
        .from("customers")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user!.id);

      if (custError) throw custError;

      // Get active plans count
      const { count: planCount, error: planError } = await supabase
        .from("maintenance_plans")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("app", APP_ID);

      if (planError) throw planError;

      return {
        customerCount: customerCount || 0,
        planCount: planCount || 0,
        // These would need real calculation from billing data
        mrr: 0,
        churn: 0,
        avgPerCustomer: 0,
      };
    },
  });

  const isDemo = profile?.is_demo === true;

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
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5 whitespace-nowrap">
            {isDemo ? "Good morning, Mike" : getGreeting(profile?.name)}
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
            {isDemo && (
              <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#cfead8] bg-white/10 px-2 py-1 rounded-full">
                <ArrowUp className="h-3 w-3" strokeWidth={2.2} /> +8.4% mo/mo
              </div>
            )}
          </div>
          <div className="tp-display tp-num text-[48px] font-bold leading-none tracking-[-0.04em]">
            {isDemo ? "$14,820" : stats?.mrr > 0 ? `$${stats.mrr.toLocaleString()}` : "$0"}
            <span className="text-lg text-bronze-400 font-semibold ml-1">/mo</span>
          </div>
          <div className="flex gap-6 mt-4 pt-3.5 border-t border-white/10">
            <Stat value={isDemo ? "67" : String(stats?.planCount || 0)} label="Active plans" />
            <Stat value={isDemo ? "2.1%" : stats?.churn ? `${stats.churn}%` : "0%"} label="Churn 30d" />
            <Stat value={isDemo ? "$221" : stats?.avgPerCustomer ? `$${stats.avgPerCustomer}` : "$0"} label="Avg/customer" />
          </div>
        </div>
      </section>

      {/* Pre-emergent GDD watch — renders nothing unless the crabgrass
          window is open/closing/imminent for the operator's ZIP. */}
      <PreEmergentAlert />

      {/* Today's route or empty state */}
      {isWinter ? (
        <WinterHomeCard />
      ) : isDemo ? (
        // Demo route for demo users
        <section className="mx-4 mb-3">
          <div className="flex items-center justify-between px-1 pb-2">
            <h2 className="text-[13px] font-semibold text-ink-700 tracking-[0.2px]">Today's route</h2>
            <span className="text-xs text-ink-500">Wednesday crew</span>
          </div>
          <div className="tp-card p-4">
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex gap-[18px]">
                <SummaryStat value="11" unit="" sub="stops" />
                <div className="w-px bg-ink-200" />
                <SummaryStat value="23" unit=" mi" sub="drive total" />
                <div className="w-px bg-ink-200" />
                <SummaryStat value="6.5" unit=" h" sub="est." />
              </div>
            </div>
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
      ) : (
        // Empty state for real users with no routes
        <section className="mx-4 mb-3">
          <div className="tp-card p-6 text-center">
            <MapPin className="h-12 w-12 text-ink-300 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-ink-700 mb-1">No routes scheduled</h3>
            <p className="text-xs text-ink-500 mb-4">
              {stats?.customerCount === 0
                ? "Add customers to start planning routes"
                : "Create maintenance plans for your customers to see routes here"
              }
            </p>
            <Link
              to={stats?.customerCount === 0 ? "/customers" : "/plans"}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-800 text-white rounded-xl text-sm font-semibold hover:bg-green-900 transition-colors"
            >
              {stats?.customerCount === 0 ? (
                <><Users className="h-4 w-4" /> Add First Customer</>
              ) : (
                <><TrendingUp className="h-4 w-4" /> Create Plan</>
              )}
            </Link>
          </div>
        </section>
      )}

      {/* Weekly forecast — live from OpenWeather via the `forecast` edge fn */}
      <section className="mx-4 mb-3 mt-3.5">
        {/* Active alerts banner — rendered ABOVE the "This week" header so
            operators see "Frost Advisory" before they scan the strip. We
            cap at 1 visible alert; the rest are summarized as "+N" in the
            tail. Tapping the banner opens today's detail sheet (the
            closest day to the alert's start time). */}
        {alerts.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // Open today's sheet if today is in range; otherwise the
              // first day. The detail sheet doesn't show alerts directly
              // — but it does surface the same workConditions warnings,
              // which is what an operator cares about.
              const target =
                days.find((d) => isToday(d.date)) ?? days[0] ?? null;
              if (target) setOpenDayDate(target.date);
            }}
            className="w-full mb-2.5 rounded-[14px] bg-bronze-100 border border-bronze-400 px-3.5 py-2.5 flex items-center gap-2.5 text-left hover:bg-bronze-100/80 transition-colors"
            aria-label={`Weather alert: ${alerts[0]?.event ?? "Active alert"}`}
          >
            <AlertTriangle
              className="h-4 w-4 text-bronze-600 shrink-0"
              strokeWidth={2}
            />
            <div className="flex-1 min-w-0 text-[12.5px] font-semibold text-bronze-700 leading-snug truncate">
              {alerts[0]?.event ?? "Active weather alert"}
              {alerts[0]?.end && (
                <span className="font-medium text-bronze-700/80 ml-1">
                  · until {formatAlertEnd(alerts[0].end)}
                </span>
              )}
              {alerts.length > 1 && (
                <span className="ml-1 text-bronze-600">
                  +{alerts.length - 1} more
                </span>
              )}
            </div>
          </button>
        )}

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
                  <div className="mt-1 text-[10px] text-ink-400 break-words px-2">
                    {forecast.error}
                  </div>
                </div>
              ) : (
                (forecast.data ?? []).slice(0, 7).map((day) => {
                  const today = isToday(day.date);
                  const toneKey: ForecastTone = today ? "today" : day.derived_tone;
                  const tone = forecastTone[toneKey];
                  const Icon = iconFor(day);
                  // High temp — fall back across the parallel agent's
                  // contract rename (temp_high -> high) so we work whether
                  // the rewrite has landed or not.
                  const high = (day as any).high ?? day.temp_high;
                  return (
                    <button
                      type="button"
                      key={day.date}
                      onClick={() => setOpenDayDate(day.date)}
                      className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-xl ${tone.container} hover:opacity-90 transition-opacity`}
                      aria-label={`Open forecast detail for ${dayLabel(day.date)}`}
                    >
                      <div className={`text-[10px] font-semibold tracking-[0.3px] ${tone.label}`}>
                        {dayLabel(day.date).toUpperCase()}
                      </div>
                      <Icon className={`h-4 w-4 ${tone.icon}`} strokeWidth={1.7} />
                      <div className={`tp-num text-[13px] font-bold ${tone.value}`}>
                        {high}°
                      </div>
                      {/* Per-day work verdict dots — mow / spray / fert.
                          Renders nothing until workConditions lands. */}
                      <WorkConditionDots day={day as any} />
                    </button>
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
              {/* Third class — spray-block chip. Derived from the
                  workConditions.warnings on the next 3 days; we surface
                  the kind ("wind"/"frost"/etc.) in parens so the operator
                  knows whether moving the visit by a day fixes it. */}
              {sprayBlockedDay && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-full bg-[hsl(var(--destructive-bg))] text-[11.5px] font-semibold text-destructive">
                  <Ban className="h-3 w-3" />
                  No spray {dayLabel(sprayBlockedDay.date)}
                  {sprayBlockWarning?.kind && (
                    <span className="opacity-80">({sprayBlockWarning.kind})</span>
                  )}
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
          {quickActions
            .filter((t) => t.to !== "/inbox" || TWILIO_ENABLED)
            .map(({ icon: Icon, label, sub, accent, to }) => {
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

      {/* Day detail sheet — modal opened by tapping any day cell or the
          alerts banner above the strip. State is owned here so the
          forecast strip stays a dumb renderer. */}
      {openDay && (
        <DayDetailSheet
          day={openDay as any}
          hourly={hourly as any}
          onClose={() => setOpenDayDate(null)}
        />
      )}
    </div>
  );
}

// Format an alerts[].end unix timestamp as a short "Wed 7am" style label.
// Used by the alerts banner so operators see when the alert clears.
function formatAlertEnd(endSec: number): string {
  const d = new Date(endSec * 1000);
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  let hour = d.getHours();
  const ampm = hour >= 12 ? "pm" : "am";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${day} ${hour}${ampm}`;
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
