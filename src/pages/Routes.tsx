import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  Play,
  Truck,
  GripVertical,
  Check,
  SkipForward,
  CloudRain,
  Cloud,
  CloudSnow,
  Sun,
  Snowflake,
  Wind,
  Plane,
  Lock,
  EyeOff,
  HelpCircle,
  Sprout,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useForecast, useUserZip, type ForecastDay } from "@/lib/weather";
import { geocodeAddress } from "@/lib/geocode";
import { fetchDriveMatrix, type DriveStop } from "@/lib/drive-matrix";
import type { Route, RouteStop, SkipReason, StopStatus } from "@/components/routes/types";
import WinterRoutesBanner from "@/components/season/WinterRoutesBanner";
import { useSeason } from "@/lib/season";

// =====================================================================
// Date utilities — local-time week math. We deliberately avoid date-fns
// to keep the bundle small; week starts Monday per the mockup.
// =====================================================================
function startOfWeekMonday(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay(); // 0=Sun ... 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // back to Monday
  out.setDate(out.getDate() + diff);
  return out;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Convert a Mon-indexed offset (0..6) to a SQL day_of_week (0=Sun..6=Sat).
function monIdxToSqlDow(monIdx: number): number {
  // monIdx 0=Mon -> 1, 1=Tue -> 2, ..., 5=Sat -> 6, 6=Sun -> 0
  return (monIdx + 1) % 7;
}

const SKIP_REASONS: { value: SkipReason; label: string; Icon: typeof CloudRain }[] = [
  { value: "rain",            label: "Rain",              Icon: CloudRain },
  { value: "drought",         label: "Drought",           Icon: Sun },
  { value: "customer_travel", label: "Customer away",     Icon: Plane },
  { value: "gate_locked",     label: "Gate locked",       Icon: Lock },
  { value: "no_show",         label: "No show",           Icon: EyeOff },
  { value: "other",           label: "Other",             Icon: HelpCircle },
];

// =====================================================================
// Main page
// =====================================================================
export default function RoutesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { isWinter } = useSeason();
  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => startOfWeekMonday(today), [today]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekEnd = weekDays[6];

  const initialSel = Math.max(0, weekDays.findIndex((d) => isSameDay(d, today)));
  const [selectedIdx, setSelectedIdx] = useState<number>(initialSel === -1 ? 0 : initialSel);
  const selectedDate = weekDays[selectedIdx];

  const [skipForStopId, setSkipForStopId] = useState<string | null>(null);

  // -----------------------------------------------------------------
  // Live weather — drives the week-strip indicators. ZIP comes from the
  // profile; if unset the forecast hook returns null (no error UI, the
  // strip simply hides icons).
  // -----------------------------------------------------------------
  const zipQ = useUserZip();
  const forecast = useForecast(zipQ.data);
  const forecastByDate = useMemo(() => {
    const m = new Map<string, ForecastDay>();
    for (const d of forecast.data ?? []) m.set(d.date, d);
    return m;
  }, [forecast.data]);

  // -----------------------------------------------------------------
  // Fetch all routes (+ nested stops) in the visible week. One query
  // covers the strip counts AND the selected day's detail list.
  // -----------------------------------------------------------------
  const weekRoutesQuery = useQuery({
    queryKey: ["routes-week", user?.id, ymd(weekStart), ymd(weekEnd)],
    enabled: !!user,
    queryFn: async (): Promise<Route[]> => {
      if (!user) return [];
      const { data, error } = await (supabase as any)
        .from("routes")
        .select("*, route_stops(*)")
        .eq("user_id", user.id)
        .gte("date", ymd(weekStart))
        .lte("date", ymd(weekEnd))
        .order("date");
      if (error) throw error;
      return (data ?? []) as Route[];
    },
  });

  const routesByDate = useMemo(() => {
    const m = new Map<string, Route>();
    for (const r of weekRoutesQuery.data ?? []) m.set(r.date, r);
    return m;
  }, [weekRoutesQuery.data]);

  // Count per visible day = stops on that day's route (0 if no route).
  const dayCounts = weekDays.map((d) => {
    const r = routesByDate.get(ymd(d));
    return r?.route_stops?.length ?? 0;
  });

  const selectedRoute = routesByDate.get(ymd(selectedDate));
  const stops = useMemo(() => {
    const s = selectedRoute?.route_stops ?? [];
    return [...s].sort((a, b) => a.sort_order - b.sort_order);
  }, [selectedRoute]);

  const counts = useMemo(() => {
    const c = { done: 0, in_progress: 0, pending: 0, skipped: 0 };
    for (const s of stops) c[s.status]++;
    return c;
  }, [stops]);

  const collectedCents = stops
    .filter((s) => s.status === "done")
    .reduce((sum, s) => sum + (s.fee_cents ?? 0), 0);

  const totalMiles = stops.reduce(
    (sum, s) => sum + Number(s.drive_miles_from_prev ?? 0),
    0,
  );
  const totalMinutes = stops.reduce(
    (sum, s) => sum + Number(s.drive_minutes_from_prev ?? 0),
    0,
  );

  const completedCount = counts.done;
  const pct = stops.length === 0 ? 0 : Math.round((completedCount / stops.length) * 100);

  // -----------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["routes-week", user?.id, ymd(weekStart), ymd(weekEnd)] });

  const markDoneMutation = useMutation({
    mutationFn: async (stopId: string) => {
      const { error } = await (supabase as any)
        .from("route_stops")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", stopId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const skipStopMutation = useMutation({
    mutationFn: async ({ stopId, reason }: { stopId: string; reason: SkipReason }) => {
      const { error } = await (supabase as any)
        .from("route_stops")
        .update({ status: "skipped", skip_reason: reason })
        .eq("id", stopId);
      if (error) throw error;
    },
    onSuccess: () => {
      setSkipForStopId(null);
      invalidate();
    },
  });

  // Start / Resume: creates the route + stops if needed; otherwise flips status
  // and navigates into route-mode.
  const startRouteMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const existing = selectedRoute;
      const dateStr = ymd(selectedDate);

      // Already in_progress / complete -> just navigate.
      if (existing && existing.status === "in_progress") {
        return existing.id;
      }

      // Planned -> flip to in_progress.
      if (existing && existing.status === "planned") {
        const { error } = await (supabase as any)
          .from("routes")
          .update({ status: "in_progress", started_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
        return existing.id;
      }

      // No route yet -> build one from active plans for this weekday.
      const sqlDow = monIdxToSqlDow(selectedIdx);
      const { data: plans, error: plansErr } = await (supabase as any)
        .from("maintenance_plans")
        .select("id, customer_id, property_id, address, customer_name, services, amount, day_of_week, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .eq("day_of_week", sqlDow);
      if (plansErr) throw plansErr;

      const { data: routeRow, error: routeErr } = await (supabase as any)
        .from("routes")
        .insert({
          user_id: user.id,
          date: dateStr,
          status: "in_progress",
          started_at: new Date().toISOString(),
          total_stops: plans?.length ?? 0,
          completed_stops: 0,
        })
        .select("*")
        .single();
      if (routeErr) throw routeErr;

      const routeId: string = routeRow.id;
      if (plans && plans.length > 0) {
        // -------------------------------------------------------------
        // Resolve property coordinates. Plans reference properties by id;
        // we need each property's lat/lng to build the Mapbox drive matrix.
        // If lat/lng are missing we geocode the plan's address and persist
        // the result back to `properties` so the next run skips this work.
        //
        // All weather/geocode/drive failures are non-fatal — they should
        // never block the operator from starting their day.
        // -------------------------------------------------------------
        const propertyIds = plans
          .map((p: any) => p.property_id)
          .filter((id: string | null): id is string => !!id);
        const propsById = new Map<string, { lat: number | null; lng: number | null; address: string | null }>();
        if (propertyIds.length > 0) {
          const { data: props } = await (supabase as any)
            .from("properties")
            .select("id, lat, lng, address")
            .in("id", propertyIds);
          for (const p of (props ?? []) as Array<{ id: string; lat: number | null; lng: number | null; address: string | null }>) {
            propsById.set(p.id, { lat: p.lat, lng: p.lng, address: p.address });
          }
        }

        // Geocode any property still missing coords. We use the property
        // address first, falling back to the plan's snapshot address.
        for (const p of plans) {
          if (!p.property_id) continue;
          const existing = propsById.get(p.property_id);
          if (existing?.lat != null && existing?.lng != null) continue;
          const addr = existing?.address ?? p.address;
          if (!addr) continue;
          try {
            const geo = await geocodeAddress(addr);
            if (geo) {
              propsById.set(p.property_id, { lat: geo.lat, lng: geo.lng, address: addr });
              // Persist back so the next route assembly is a cache hit. Fire
              // and forget — never block route start on a write failure.
              await (supabase as any)
                .from("properties")
                .update({ lat: geo.lat, lng: geo.lng })
                .eq("id", p.property_id);
            }
          } catch (e) {
            // Soft-fail: drive times for legs touching this stop will be null.
            console.warn("[Routes] geocode failed for", p.property_id, e);
          }
        }

        // Drive matrix — one Mapbox call covers the whole ordered sequence.
        // We only call it when at least 2 stops have coords; otherwise legs
        // stay null and the UI shows "–" for drive time.
        const orderedCoords: Array<{ idx: number; lat: number; lng: number } | null> = plans.map(
          (p: any, i: number) => {
            const prop = p.property_id ? propsById.get(p.property_id) : null;
            if (prop?.lat != null && prop?.lng != null) {
              return { idx: i, lat: Number(prop.lat), lng: Number(prop.lng) };
            }
            return null;
          },
        );
        // legMinutes/Miles are aligned to the *plans* array index: entry i is
        // the drive FROM plans[i-1] TO plans[i]. Entry 0 is always null
        // because there's no "previous" stop on the first visit.
        const legMinutes = new Array<number | null>(plans.length).fill(null);
        const legMiles = new Array<number | null>(plans.length).fill(null);

        const coordStops: DriveStop[] = orderedCoords
          .filter((c): c is { idx: number; lat: number; lng: number } => c !== null)
          .map(({ lat, lng }) => ({ lat, lng }));
        const coordIndices = orderedCoords
          .map((c, i) => (c ? i : -1))
          .filter((i) => i >= 0);

        if (coordStops.length >= 2) {
          try {
            const matrixLegs = await fetchDriveMatrix(coordStops);
            // matrixLegs[k] is the drive from coordStops[k] to coordStops[k+1].
            // Map back into plans-space using coordIndices.
            for (let k = 0; k < matrixLegs.length; k++) {
              const toPlanIdx = coordIndices[k + 1];
              if (toPlanIdx == null) continue;
              legMinutes[toPlanIdx] = matrixLegs[k].minutes;
              legMiles[toPlanIdx] = matrixLegs[k].miles;
            }
          } catch (e) {
            console.warn("[Routes] drive-matrix failed", e);
          }
        }

        const stopRows = plans.map((p: any, i: number) => ({
          user_id: user.id,
          route_id: routeId,
          plan_id: p.id,
          property_id: p.property_id,
          customer_id: p.customer_id,
          address_snapshot: p.address ?? null,
          customer_name_snapshot: p.customer_name ?? null,
          services: p.services ?? [],
          // amount on maintenance_plans is dollars (NUMERIC); convert to cents.
          fee_cents: p.amount != null ? Math.round(Number(p.amount) * 100) : null,
          sort_order: i + 1,
          status: "pending",
          drive_minutes_from_prev: legMinutes[i],
          drive_miles_from_prev: legMiles[i],
        }));
        const { error: stopsErr } = await (supabase as any)
          .from("route_stops")
          .insert(stopRows);
        if (stopsErr) throw stopsErr;
      }
      return routeId;
    },
    onSuccess: (routeId) => {
      invalidate();
      navigate(`/routes/run/${routeId}`);
    },
  });

  const startButton = (() => {
    if (!selectedRoute) return { label: "Start route", Icon: Play };
    if (selectedRoute.status === "in_progress") return { label: "Resume", Icon: Play };
    if (selectedRoute.status === "complete") return { label: "Review", Icon: Check };
    return { label: "Start route", Icon: Play };
  })();

  // =================================================================
  // Render
  // =================================================================
  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pt-1 pb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            Week of {MONTH_SHORT[weekStart.getMonth()]} {weekStart.getDate()}
          </div>
          <h1 className="tp-display text-[28px] font-bold text-ink-900 leading-tight">
            Routes
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="h-9 w-9 rounded-full border border-ink-200 bg-card flex items-center justify-center"
            aria-label="Search routes"
          >
            <Search className="h-4 w-4 text-ink-700" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="h-9 w-9 rounded-full bg-green-800 flex items-center justify-center"
            aria-label="New route"
          >
            <Plus className="h-4 w-4 text-white" strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* Winter mode banner — routes pivot from weekly cadence to storm-
          driven. The "+ New storm route" button scrolls to the page
          header where the existing "+" affordance lives. */}
      {isWinter && (
        <WinterRoutesBanner
          onNewRoute={() => {
            // Scroll into view; the actual creation flow is the header "+".
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}

      {/* Week strip */}
      <div className="px-4 pb-3.5">
        <div className="tp-card p-1.5 flex gap-1">
          {weekDays.map((d, i) => {
            const on = i === selectedIdx;
            const past = !on && d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const count = dayCounts[i];
            const fc = forecastByDate.get(ymd(d));
            const WeatherIcon = fc ? weekStripIcon(fc) : null;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedIdx(i)}
                className={cn(
                  "flex-1 py-2 pb-1.5 rounded-[11px] flex flex-col items-center gap-0.5 transition-colors",
                  on ? "bg-green-800" : "bg-transparent",
                  past && "opacity-55",
                )}
              >
                <div
                  className={cn(
                    "text-[10px] font-semibold tracking-[0.5px]",
                    on ? "text-bronze-400" : "text-ink-500",
                  )}
                >
                  {DAY_LETTERS[i]}
                </div>
                <div
                  className={cn(
                    "tp-num text-[17px] font-bold",
                    on ? "text-white" : "text-ink-900",
                  )}
                >
                  {d.getDate()}
                </div>
                {/* Tiny weather indicator — only when a forecast for this day
                    is in scope. Keeps the strip lightweight on Sundays/etc. */}
                {WeatherIcon && (
                  <WeatherIcon
                    className={cn(
                      "h-3 w-3",
                      on ? "text-bronze-200" : weekStripIconColor(fc!),
                    )}
                    strokeWidth={1.8}
                  />
                )}
                <div
                  className={cn(
                    "text-[9px] font-semibold",
                    on ? "text-[#cfead8]" : "text-ink-400",
                  )}
                >
                  {count > 0 ? `${count} stops` : "–"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Day summary + start CTA */}
      <div className="px-4 pb-4">
        <div className="flex items-end justify-between mb-2.5">
          <div>
            <div className="tp-display text-[18px] font-bold text-ink-900">
              {WEEKDAY_NAMES[selectedIdx]} · {stops.length} stop{stops.length === 1 ? "" : "s"}
            </div>
            <div className="text-xs text-ink-500 mt-0.5">
              {stops.length === 0 ? (
                "Nothing scheduled"
              ) : (
                <>
                  {counts.done} done · {counts.in_progress} active · {counts.pending} pending
                  {counts.skipped > 0 ? ` · ${counts.skipped} skipped` : ""}
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={startRouteMutation.isPending}
            onClick={() => {
              if (selectedRoute && selectedRoute.status === "in_progress") {
                navigate(`/routes/run/${selectedRoute.id}`);
                return;
              }
              startRouteMutation.mutate();
            }}
            className="px-3.5 py-2 rounded-full bg-bronze-500 text-white text-[13px] font-bold inline-flex items-center gap-1.5 shadow-bronze hover:bg-bronze-600 transition-colors disabled:opacity-60"
          >
            <startButton.Icon className="h-3 w-3" strokeWidth={2.5} />
            {startRouteMutation.isPending ? "..." : startButton.label}
          </button>
        </div>

        {/* Progress + collected card */}
        <div className="bg-card border border-ink-100 rounded-[14px] px-3.5 py-3 flex gap-4 items-center shadow-card">
          <div className="flex-1">
            <div className="flex justify-between text-[11px] text-ink-500 mb-1.5">
              <span>
                {completedCount} / {stops.length} complete
              </span>
              <span className="tp-num">{pct}%</span>
            </div>
            <div className="h-1.5 bg-ink-100 rounded-[3px] overflow-hidden">
              <div
                className="h-full rounded-[3px]"
                style={{
                  width: `${pct}%`,
                  background:
                    "linear-gradient(90deg, hsl(var(--green-600)), hsl(var(--bronze-500)))",
                }}
              />
            </div>
          </div>
          <div className="w-px h-8 bg-ink-200" />
          <div className="text-right">
            <div className="tp-num text-[15px] font-bold text-ink-900">
              ${Math.round(collectedCents / 100)}
            </div>
            <div className="text-[10px] text-ink-500">collected today</div>
          </div>
        </div>

        {/* Mini progress strip — one segment per stop */}
        {stops.length > 0 && (
          <div className="flex gap-[3px] mt-2.5">
            {stops.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "flex-1 h-1.5 rounded-[3px]",
                  s.status === "done" && "bg-green-600",
                  s.status === "in_progress" && "bg-bronze-500",
                  s.status === "skipped" && "bg-ink-300",
                  s.status === "pending" && "bg-ink-100",
                )}
              />
            ))}
          </div>
        )}

        {/* Top metrics row */}
        {stops.length > 0 && (
          <div className="mt-3 flex gap-4 px-1 text-[11px] text-ink-500">
            <span>
              <span className="tp-num text-ink-900 font-semibold">{totalMiles.toFixed(1)}</span> mi
            </span>
            <span className="text-ink-300">·</span>
            <span>
              <span className="tp-num text-ink-900 font-semibold">
                {Math.round(totalMinutes / 60 * 10) / 10}
              </span>{" "}
              h est.
            </span>
            <span className="text-ink-300">·</span>
            <span>
              <span className="tp-num text-ink-900 font-semibold">{stops.length}</span> stops
            </span>
          </div>
        )}
      </div>

      {/* Stop list */}
      <div className="px-4 pb-6">
        {weekRoutesQuery.isLoading && (
          <div className="tp-card p-6 text-center text-sm text-ink-500">
            Loading route…
          </div>
        )}

        {!weekRoutesQuery.isLoading && stops.length === 0 && (
          <EmptyDay
            hasRoute={!!selectedRoute}
            onCreate={() => navigate("/plans/new")}
          />
        )}

        {stops.map((s, i) => (
          <div key={s.id}>
            {i > 0 && (
              <div className="flex items-center gap-1.5 py-1 pl-[34px] text-ink-400 text-[10.5px]">
                <Truck className="h-2.5 w-2.5" strokeWidth={1.8} />
                <span>
                  {s.drive_minutes_from_prev != null
                    ? `${s.drive_minutes_from_prev} min`
                    : "–"}
                  {s.drive_miles_from_prev != null
                    ? ` · ${Number(s.drive_miles_from_prev).toFixed(1)} mi`
                    : ""}
                </span>
              </div>
            )}
            <StopCard
              stop={s}
              skipOpen={skipForStopId === s.id}
              onMarkDone={() => markDoneMutation.mutate(s.id)}
              onOpenSkip={() => setSkipForStopId(s.id)}
              onCloseSkip={() => setSkipForStopId(null)}
              onPickReason={(reason) => skipStopMutation.mutate({ stopId: s.id, reason })}
              skipping={
                skipStopMutation.isPending && skipStopMutation.variables?.stopId === s.id
              }
              marking={markDoneMutation.isPending && markDoneMutation.variables === s.id}
            />
          </div>
        ))}

        {stops.length > 0 && (
          <div className="pt-3.5 pb-1 text-center text-xs text-ink-400">
            {counts.pending + counts.in_progress > 0
              ? `${counts.pending + counts.in_progress} stops left`
              : "All stops handled"}
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Stop card — pulled out for readability. Lives inline since it isn't
// reused elsewhere yet; lift into src/components/routes/ if it grows.
// =====================================================================
interface StopCardProps {
  stop: RouteStop;
  skipOpen: boolean;
  marking: boolean;
  skipping: boolean;
  onMarkDone: () => void;
  onOpenSkip: () => void;
  onCloseSkip: () => void;
  onPickReason: (r: SkipReason) => void;
}

function StopCard({
  stop,
  skipOpen,
  marking,
  skipping,
  onMarkDone,
  onOpenSkip,
  onCloseSkip,
  onPickReason,
}: StopCardProps) {
  const isActive = stop.status === "in_progress";
  const isDone = stop.status === "done";
  const isSkipped = stop.status === "skipped";
  const isPending = stop.status === "pending";

  return (
    <div
      className={cn(
        "rounded-[14px] border flex items-center gap-3 px-3 py-3 relative",
        isActive
          ? "bg-green-50 border-green-100 shadow-[0_4px_16px_-8px_hsl(148_65%_25%_/_0.4)]"
          : "bg-card border-ink-100 shadow-card",
        isDone && "opacity-65",
        isSkipped && "opacity-75",
      )}
    >
      {/* Drag handle — render markup only, real D&D library deferred. */}
      <button
        type="button"
        aria-label="Drag to reorder"
        // Wired to a no-op so the handle is keyboard-focusable but doesn't
        // misleadingly trigger anything until D&D lands.
        onPointerDown={() => {
          if (isPending) console.debug("[Routes] drag start placeholder", stop.id);
        }}
        className={cn(
          "-ml-1 p-0.5 text-ink-300 touch-none",
          !isPending && "invisible",
        )}
      >
        <GripVertical className="h-4 w-4" strokeWidth={1.8} />
      </button>

      {/* Status dot / stop number */}
      <StatusDot status={stop.status} number={stop.sort_order} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[14.5px] font-semibold text-ink-900 truncate">
            {stop.address_snapshot ?? "(no address)"}
          </div>
          <div
            className={cn(
              "tp-num text-[13.5px] font-bold whitespace-nowrap",
              isActive ? "text-bronze-600" : "text-ink-700",
            )}
          >
            ${stop.fee_cents != null ? Math.round(stop.fee_cents / 100) : "—"}
          </div>
        </div>
        <div className="text-[11.5px] text-ink-500 mt-px flex items-center gap-1.5">
          <span className="truncate">{stop.customer_name_snapshot ?? "—"}</span>
          {stop.services.length > 0 && (
            <>
              <span className="text-ink-300">·</span>
              <span className="truncate">{stop.services.join(" + ")}</span>
            </>
          )}
        </div>

        {(isActive || isSkipped) && (
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {isActive && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-bronze-100 text-[10.5px] font-semibold text-bronze-700">
                <span className="h-1 w-1 rounded-full bg-bronze-500" /> On site
              </span>
            )}
            {isSkipped && stop.skip_reason && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-ink-100 text-[10.5px] font-medium text-ink-700">
                <SkipForward className="h-2.5 w-2.5" /> {skipReasonLabel(stop.skip_reason)}
              </span>
            )}
          </div>
        )}

        {/* Inline skip-reason picker */}
        {skipOpen && (
          <div className="mt-2.5 rounded-[10px] border border-ink-200 bg-card p-2.5">
            <div className="text-[11px] font-semibold text-ink-700 mb-1.5 flex items-center justify-between">
              <span>Skip this week — why?</span>
              <button
                type="button"
                onClick={onCloseSkip}
                className="text-[11px] font-medium text-ink-500 hover:text-ink-700"
              >
                Cancel
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {SKIP_REASONS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  disabled={skipping}
                  onClick={() => onPickReason(value)}
                  className="flex flex-col items-center gap-1 py-2 rounded-lg bg-ink-100 hover:bg-ink-200 text-ink-700 text-[10.5px] font-semibold transition-colors disabled:opacity-60"
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action column — only for pending / in_progress */}
      {(isPending || isActive) && !skipOpen && (
        <div className="flex flex-col gap-1.5 ml-1">
          <button
            type="button"
            disabled={marking}
            onClick={onMarkDone}
            aria-label="Mark done"
            className="h-8 w-8 rounded-full bg-green-800 text-white grid place-items-center hover:bg-green-700 transition-colors disabled:opacity-60"
          >
            <Check className="h-4 w-4" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={onOpenSkip}
            aria-label="Skip this week"
            className="h-8 w-8 rounded-full border border-ink-200 text-ink-500 grid place-items-center hover:bg-ink-100 transition-colors"
          >
            <SkipForward className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

function StatusDot({ status, number }: { status: StopStatus; number: number }) {
  if (status === "done") {
    return (
      <div className="h-[30px] w-[30px] rounded-full bg-green-600 text-white grid place-items-center flex-shrink-0">
        <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
      </div>
    );
  }
  if (status === "in_progress") {
    return (
      <div className="h-[30px] w-[30px] rounded-full bg-bronze-500 text-white grid place-items-center flex-shrink-0 text-[13px] font-bold tp-num">
        {number}
      </div>
    );
  }
  if (status === "skipped") {
    return (
      <div className="h-[30px] w-[30px] rounded-full bg-ink-100 text-ink-400 grid place-items-center flex-shrink-0">
        <SkipForward className="h-3 w-3" strokeWidth={2} />
      </div>
    );
  }
  // pending
  return (
    <div className="h-[30px] w-[30px] rounded-full bg-card border-[1.5px] border-ink-300 text-ink-500 grid place-items-center flex-shrink-0 text-[13px] font-bold tp-num">
      {number}
    </div>
  );
}

function skipReasonLabel(r: SkipReason): string {
  return SKIP_REASONS.find((x) => x.value === r)?.label ?? r;
}

// Tiny icon + color helpers for the week-strip weather indicator. Kept module-
// level so the JSX above stays readable.
function weekStripIcon(fc: ForecastDay) {
  if (fc.derived_tone === "frost") return Snowflake;
  if (fc.derived_tone === "wind") return Wind;
  if (fc.condition === "rain") return CloudRain;
  if (fc.condition === "snow") return CloudSnow;
  if (fc.condition === "cloud") return Cloud;
  return Sun;
}
function weekStripIconColor(fc: ForecastDay): string {
  if (fc.derived_tone === "rain" || fc.condition === "rain") return "text-[hsl(var(--rain))]";
  if (fc.derived_tone === "drought") return "text-[hsl(var(--drought))]";
  if (fc.derived_tone === "wind" || fc.derived_tone === "frost") return "text-[hsl(var(--rain))]";
  if (fc.condition === "cloud") return "text-ink-400";
  if (fc.condition === "snow") return "text-[hsl(var(--rain))]";
  return "text-bronze-500";
}

// =====================================================================
// Empty state — surfaces when the operator hasn't built any plans yet.
// =====================================================================
function EmptyDay({ hasRoute, onCreate }: { hasRoute: boolean; onCreate: () => void }) {
  return (
    <div className="tp-card p-6 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-green-50 text-green-700 grid place-items-center mb-3">
        <Sprout className="h-5 w-5" strokeWidth={1.8} />
      </div>
      <div className="text-[15px] font-semibold text-ink-900">
        {hasRoute ? "No stops on this route yet" : "Nothing scheduled for this day"}
      </div>
      <p className="text-xs text-ink-500 mt-1.5 max-w-[260px] mx-auto">
        Recurring maintenance plans seed routes automatically by day-of-week. Add a plan to fill out this day.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-3.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-green-800 text-white text-[13px] font-bold hover:bg-green-700 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Create a plan
      </button>
    </div>
  );
}
