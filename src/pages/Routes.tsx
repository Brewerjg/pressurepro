import { useEffect, useMemo, useState } from "react";
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
  Wand2,
  Loader2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useForecast, useUserZip, type ForecastDay } from "@/lib/weather";
import { optimizeRoute } from "@/lib/optimize-route";
import type { Route, RouteStop, SkipReason, StopStatus } from "@/components/routes/types";
import {
  SortableList,
  SortableStop,
  computeReorderedSortOrders,
} from "@/components/routes/SortableStops";
import WinterRoutesBanner from "@/components/season/WinterRoutesBanner";
import { useSeason } from "@/lib/season";
import { APP_ID } from "@/lib/app-context";

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
  // Crew filter — page-local state. "All" surfaces every route; a
  // selected crew narrows the week strip counts, day summary, and stop
  // list to routes whose crew_id matches. The Start-route mutation also
  // uses this selection when no explicit picker is shown.
  // -----------------------------------------------------------------
  const [selectedCrewId, setSelectedCrewId] = useState<string | "all">("all");
  const [crewPickerOpen, setCrewPickerOpen] = useState(false);

  const crewsQuery = useQuery({
    queryKey: ["crews", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Array<{ id: string; name: string; color: string }>> => {
      if (!user) return [];
      const { data, error } = await (supabase as any)
        .from("crews")
        .select("id, name, color")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; color: string }>;
    },
  });
  const crews = crewsQuery.data ?? [];

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

  // The week query returns every route the operator owns. When a crew
  // chip is active we narrow to routes whose crew_id matches; "all"
  // surfaces everything. Multiple routes per date are possible once
  // multi-crew is in use, but the day-summary still shows one — we pick
  // the filter-matched route (or the first one for "all").
  const routesByDate = useMemo(() => {
    const m = new Map<string, Route>();
    for (const r of weekRoutesQuery.data ?? []) {
      if (selectedCrewId !== "all" && r.crew_id !== selectedCrewId) continue;
      // First match wins. If the operator runs two crews on the same
      // day under "all" we still only render one — they should crew-
      // filter to see the second. Documented gap, not a v1 blocker.
      if (!m.has(r.date)) m.set(r.date, r);
    }
    return m;
  }, [weekRoutesQuery.data, selectedCrewId]);

  // Count per visible day = stops on that day's route (0 if no route).
  const dayCounts = weekDays.map((d) => {
    const r = routesByDate.get(ymd(d));
    return r?.route_stops?.length ?? 0;
  });

  const selectedRoute = routesByDate.get(ymd(selectedDate));
  const serverStops = useMemo(() => {
    const s = selectedRoute?.route_stops ?? [];
    return [...s].sort((a, b) => a.sort_order - b.sort_order);
  }, [selectedRoute]);

  // Local mirror of the stop list so drag-to-reorder can update the UI
  // optimistically before the bulk sort_order write completes. We
  // resync from the server snapshot whenever the route changes or the
  // server returns a new ordering.
  const [stops, setStops] = useState<RouteStop[]>(serverStops);
  useEffect(() => {
    setStops(serverStops);
  }, [serverStops]);

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

  // Bulk-renumber pending stops' sort_order to consecutive multiples of
  // 10 (10, 20, 30...). Pinned stops (done / in_progress / skipped)
  // keep their existing sort_order — the operator can't re-sequence
  // history. The drive-time legs cached on each row are NOT recomputed
  // here; they'll refresh from Google Routes on the next Start-route call.
  const reorderStopsMutation = useMutation({
    mutationFn: async (next: RouteStop[]) => {
      const newOrders = computeReorderedSortOrders(next);
      if (newOrders.size === 0) return;
      // One UPDATE per pending stop. Lawn-care routes are 8-15 stops,
      // so the round-trip count is tiny; we keep this simple instead
      // of a server-side bulk RPC.
      const writes = Array.from(newOrders.entries()).map(([id, sort_order]) =>
        (supabase as any)
          .from("route_stops")
          .update({ sort_order })
          .eq("id", id),
      );
      const results = await Promise.all(writes);
      const failed = results.find((r: any) => r?.error);
      if (failed?.error) throw failed.error;
    },
    onError: (err) => {
      console.error("[Routes] reorder failed; reverting", err);
      // Snap back to the server snapshot.
      setStops(serverStops);
      invalidate();
    },
    onSuccess: invalidate,
  });

  // Called when dnd-kit produces a new visual order. We optimistically
  // update local state (with the same 10/20/30... numbering we'll
  // persist) then fire the bulk update.
  function handleReorder(next: RouteStop[]) {
    const newOrders = computeReorderedSortOrders(next);
    const merged = next.map((s) =>
      newOrders.has(s.id) ? { ...s, sort_order: newOrders.get(s.id)! } : s,
    );
    setStops(merged);
    reorderStopsMutation.mutate(next);
  }

  // Tracks the most recently freshly-created route id, so we can show the
  // "Optimized for drive time" pill only on a route that *we* just built.
  // Routes that existed before this page load (planned / resumed) don't
  // get the pill, since their ordering may already reflect operator drags.
  const [justOptimizedRouteId, setJustOptimizedRouteId] = useState<string | null>(null);

  // Start / Resume: creates the route + stops if needed; otherwise flips status
  // and navigates into route-mode.
  const startRouteMutation = useMutation({
    mutationFn: async (input?: { crewId?: string | null }): Promise<{ id: string; freshlyCreated: boolean; wasOptimized: boolean }> => {
      if (!user) throw new Error("Not signed in");

      // Operator start/home address for round-trip optimization (null = fall
      // back to the first stop as the pivot).
      const { data: profileRow } = await (supabase as any)
        .from("profiles")
        .select("route_start_address")
        .eq("user_id", user.id)
        .maybeSingle();
      const startAddress: string | null = profileRow?.route_start_address ?? null;

      const existing = selectedRoute;
      const dateStr = ymd(selectedDate);

      // Already in_progress / complete -> just navigate.
      if (existing && existing.status === "in_progress") {
        return { id: existing.id, freshlyCreated: false, wasOptimized: false };
      }

      // Planned -> flip to in_progress.
      if (existing && existing.status === "planned") {
        const { error } = await (supabase as any)
          .from("routes")
          .update({ status: "in_progress", started_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
        return { id: existing.id, freshlyCreated: false, wasOptimized: false };
      }

      // Resolve which crew owns this freshly-created route, in priority order:
      //   1. explicit picker selection passed in via input.crewId
      //   2. the page's active crew filter (if not "all")
      //   3. the operator's only crew (if they have exactly one)
      //   4. null (legacy / single-operator mode)
      const crewId: string | null =
        input?.crewId !== undefined
          ? input.crewId
          : selectedCrewId !== "all"
            ? selectedCrewId
            : crews.length === 1
              ? crews[0].id
              : null;

      // No route yet -> build one from active plans for this weekday.
      // TODO(per-property crew assignment): once `properties.crew_id` lands,
      // narrow this query by crew. v1 seeds ALL active plans regardless of
      // crew — the operator can drag stops between crews later.
      const sqlDow = monIdxToSqlDow(selectedIdx);
      const { data: plans, error: plansErr } = await (supabase as any)
        .from("maintenance_plans")
        .select("id, customer_id, property_id, address, customer_name, services, amount, day_of_week, status")
        .eq("user_id", user.id)
        .eq("app", APP_ID)
        .eq("status", "active")
        .eq("day_of_week", sqlDow);
      if (plansErr) throw plansErr;

      const { data: routeRow, error: routeErr } = await (supabase as any)
        .from("routes")
        .insert({
          user_id: user.id,
          crew_id: crewId,
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
      let wasOptimized = false;
      if (plans && plans.length > 0) {
        // -------------------------------------------------------------
        // Google Routes optimization. Build waypoint addresses from each
        // plan's address, optimize between a pivot (operator start address
        // if set, else the first stop), and persist the returned order +
        // per-leg drive metrics. All failures are non-fatal — on error we
        // keep the plan order and leave drive times null.
        // -------------------------------------------------------------
        const addrOf = (p: any): string | null => (p.address ?? null);
        const pivot = (startAddress && startAddress.trim()) || null;

        // waypointPlans = the plans Google reorders. With a pivot (base) all
        // plans are waypoints; without one, the first plan is the fixed
        // start/end pivot and the rest are reordered.
        const firstPlan = plans[0];
        const waypointPlans: any[] = pivot ? plans : plans.slice(1);
        const originAddr = pivot ?? addrOf(firstPlan);
        const destAddr = originAddr;

        // legByPlanId: plan id -> { minutes, miles } drive arriving at it.
        const legByPlanId = new Map<string, { minutes: number; miles: number }>();
        let orderedPlans: any[] = plans;

        const waypointAddrs = waypointPlans.map(addrOf);
        const allHaveAddrs = originAddr != null && waypointAddrs.every((a) => !!a);

        if (originAddr && waypointPlans.length >= 1 && allHaveAddrs) {
          try {
            const { order, legs } = await optimizeRoute({
              origin: originAddr,
              destination: destAddr!,
              waypoints: waypointAddrs as string[],
            });
            // order permutes waypointPlans. legs[k] arrives at optimized
            // waypoint k (legs[0] = origin -> first waypoint).
            const orderedWaypoints = order.map((i) => waypointPlans[i]);
            // Defensive: if Google dropped/duplicated indices, fall back.
            if (orderedWaypoints.length === waypointPlans.length && orderedWaypoints.every(Boolean)) {
              orderedPlans = pivot ? orderedWaypoints : [firstPlan, ...orderedWaypoints];
              for (let k = 0; k < orderedWaypoints.length; k++) {
                const leg = legs[k];
                if (leg) legByPlanId.set(orderedWaypoints[k].id, leg);
              }
            }
          } catch (e) {
            console.warn("[Routes] optimize-route failed; keeping plan order", e);
          }
        }

        // Persist with sort_order in gaps of 10 (10, 20, 30...). Drive metrics
        // come from legByPlanId; the first stop has no arriving leg when there
        // is no pivot (base), matching the prior "–" convention.
        wasOptimized = orderedPlans !== plans;
        const stopRows = orderedPlans.map((p: any, i: number) => {
          const leg = legByPlanId.get(p.id) ?? null;
          return {
            user_id: user.id,
            route_id: routeId,
            plan_id: p.id,
            property_id: p.property_id,
            customer_id: p.customer_id,
            address_snapshot: p.address ?? null,
            customer_name_snapshot: p.customer_name ?? null,
            services: p.services ?? [],
            fee_cents: p.amount != null ? Math.round(Number(p.amount) * 100) : null,
            sort_order: (i + 1) * 10,
            status: "pending",
            drive_minutes_from_prev: leg ? leg.minutes : null,
            drive_miles_from_prev: leg ? leg.miles : null,
          };
        });
        const { error: stopsErr } = await (supabase as any)
          .from("route_stops")
          .insert(stopRows);
        if (stopsErr) throw stopsErr;
      }
      return { id: routeId, freshlyCreated: true, wasOptimized };
    },
    onSuccess: ({ id, freshlyCreated, wasOptimized }) => {
      if (freshlyCreated && wasOptimized) setJustOptimizedRouteId(id);
      invalidate();
      navigate(`/routes/run/${id}`);
    },
  });

  // -----------------------------------------------------------------
  // Re-optimize remaining (pending) stops on a planned route via Google
  // Routes. Done / skipped / in_progress stops stay pinned at their
  // existing sort_order — we only rewrite the pending tail. A snapshot of
  // the prior order is captured so the operator can Undo.
  // -----------------------------------------------------------------
  // Snapshot for Undo: previous (id -> {sort_order, drive cols}) before a re-optimize.
  const [undoOrder, setUndoOrder] = useState<
    Map<string, { sort_order: number; drive_minutes: number | null; drive_miles: number | null }> | null
  >(null);

  const reoptimizeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRoute) throw new Error("No route selected");
      // Only pending stops are reorderable.
      const pending = [...(selectedRoute.route_stops ?? [])]
        .filter((s: any) => s.status === "pending")
        .sort((a: any, b: any) => a.sort_order - b.sort_order);
      if (pending.length < 2) throw new Error("Need at least 2 pending stops to optimize");

      const { data: profileRow } = await (supabase as any)
        .from("profiles")
        .select("route_start_address")
        .eq("user_id", user!.id)
        .maybeSingle();
      const pivot: string | null = (profileRow?.route_start_address ?? "").trim() || null;

      const addrOf = (s: any): string | null => s.address_snapshot ?? null;
      const firstStop = pending[0];
      const waypointStops: any[] = pivot ? pending : pending.slice(1);
      const originAddr = pivot ?? addrOf(firstStop);
      const waypointAddrs = waypointStops.map(addrOf);
      if (!originAddr || !waypointAddrs.every(Boolean)) {
        throw new Error("Some stops are missing an address");
      }

      const { order, legs } = await optimizeRoute({
        origin: originAddr,
        destination: originAddr,
        waypoints: waypointAddrs as string[],
      });
      const orderedWaypoints = order.map((i) => waypointStops[i]);
      if (orderedWaypoints.length !== waypointStops.length || !orderedWaypoints.every(Boolean)) {
        throw new Error("Optimizer returned an inconsistent order");
      }
      const orderedStops = pivot ? orderedWaypoints : [firstStop, ...orderedWaypoints];

      // Snapshot prior order + drive metrics for Undo.
      const prev = new Map<string, { sort_order: number; drive_minutes: number | null; drive_miles: number | null }>();
      for (const s of pending) prev.set(s.id, {
        sort_order: s.sort_order,
        drive_minutes: s.drive_minutes_from_prev,
        drive_miles: s.drive_miles_from_prev,
      });

      // Persist new sort_order (gaps of 10) + drive metrics. Pending stops only.
      const results = await Promise.all(
        orderedStops.map((s: any, i: number) => {
          const leg = pivot ? legs[i] : i === 0 ? null : legs[i - 1];
          return (supabase as any)
            .from("route_stops")
            .update({
              sort_order: (i + 1) * 10,
              drive_minutes_from_prev: leg?.minutes ?? null,
              drive_miles_from_prev: leg?.miles ?? null,
            })
            .eq("id", s.id);
        }),
      );
      const failed = results.find((r: any) => r?.error);
      if (failed?.error) throw failed.error;
      return prev;
    },
    onSuccess: (prev) => {
      setUndoOrder(prev);
      invalidate();
    },
  });

  const undoReoptimize = useMutation({
    mutationFn: async () => {
      if (!undoOrder) return;
      const results = await Promise.all(
        Array.from(undoOrder.entries()).map(([id, snap]) =>
          (supabase as any).from("route_stops").update({
            sort_order: snap.sort_order,
            drive_minutes_from_prev: snap.drive_minutes,
            drive_miles_from_prev: snap.drive_miles,
          }).eq("id", id),
        ),
      );
      const failed = results.find((r: any) => r?.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      setUndoOrder(null);
      invalidate();
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
          <h1 className="tp-display text-[28px] font-bold text-ink-900 leading-tight flex items-center gap-2">
            Routes
            <span className="px-1.5 py-0.5 rounded-full bg-bronze-100 text-bronze-700 text-[10px] font-extrabold uppercase tracking-[0.06em] align-middle">
              Beta
            </span>
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

      {/* Crew filter chips — only render when the operator has at least
          one crew configured. Selection is page-local; "All" surfaces
          every route. Active chip uses green-800 to match the day-strip
          selection color. */}
      {crews.length > 0 && (
        <div className="px-4 pb-2.5">
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
            <button
              type="button"
              onClick={() => setSelectedCrewId("all")}
              className={cn(
                "shrink-0 px-3 py-1 rounded-full text-[11.5px] font-semibold border transition-colors",
                selectedCrewId === "all"
                  ? "bg-green-800 text-white border-green-800"
                  : "bg-card text-ink-700 border-ink-200 hover:bg-ink-100",
              )}
            >
              All crews
            </button>
            {crews.map((c) => {
              const on = selectedCrewId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCrewId(c.id)}
                  className={cn(
                    "shrink-0 px-3 py-1 rounded-full text-[11.5px] font-semibold border transition-colors inline-flex items-center gap-1.5",
                    on
                      ? "bg-green-800 text-white border-green-800"
                      : "bg-card text-ink-700 border-ink-200 hover:bg-ink-100",
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
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
        {/* "Optimized for drive time" pill — surfaces only when this
            specific route was freshly created (or re-optimized) in this
            session. We don't show it on resume/return visits because
            the order may already reflect operator drag adjustments. */}
        {selectedRoute && selectedRoute.id === justOptimizedRouteId && stops.length >= 3 && (
          <div className="mb-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-[10.5px] font-semibold text-green-800 border border-green-100">
              <Truck className="h-2.5 w-2.5" strokeWidth={2} />
              Optimized for drive time
            </span>
          </div>
        )}
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
          <div className="flex items-center gap-2">
            {selectedRoute?.status === "planned" && (
              <button
                type="button"
                onClick={() => reoptimizeMutation.mutate()}
                disabled={reoptimizeMutation.isPending}
                className="h-9 px-3 rounded-xl border border-ink-200 bg-card text-ink-700 text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {reoptimizeMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Re-optimize
              </button>
            )}
            <button
              type="button"
              disabled={startRouteMutation.isPending}
              onClick={() => {
                if (selectedRoute && selectedRoute.status === "in_progress") {
                  navigate(`/routes/run/${selectedRoute.id}`);
                  return;
                }
                // Multi-crew accounts with no active filter need to pick a crew
                // before we build the route. Otherwise we have a sensible
                // default (filter selection or only-crew); fire immediately.
                if (!selectedRoute && crews.length > 1 && selectedCrewId === "all") {
                  setCrewPickerOpen(true);
                  return;
                }
                startRouteMutation.mutate({});
              }}
              className="px-3.5 py-2 rounded-full bg-bronze-500 text-white text-[13px] font-bold inline-flex items-center gap-1.5 shadow-bronze hover:bg-bronze-600 transition-colors disabled:opacity-60"
            >
              <startButton.Icon className="h-3 w-3" strokeWidth={2.5} />
              {startRouteMutation.isPending ? "..." : startButton.label}
            </button>
          </div>
        </div>

        {undoOrder && (
          <div className="mx-4 mb-2 flex items-center justify-between rounded-xl bg-green-50 px-3 py-2 text-[12px] text-green-800">
            <span>Route re-optimized.</span>
            <button
              type="button"
              onClick={() => undoReoptimize.mutate()}
              disabled={undoReoptimize.isPending}
              className="font-bold underline disabled:opacity-60"
            >
              Undo
            </button>
          </div>
        )}
        {reoptimizeMutation.isError && (
          <p className="mx-4 mb-2 text-[12px] text-destructive">
            {reoptimizeMutation.error instanceof Error
              ? reoptimizeMutation.error.message
              : "Couldn't optimize the route."}
          </p>
        )}

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
          <div className="mt-3 flex gap-4 px-1 text-[11px] text-ink-500 items-center flex-wrap">
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

        <SortableList stops={stops} onReorder={handleReorder}>
          {stops.map((s, i) => (
            <SortableStop key={s.id} stop={s}>
              {(handle) => (
                <div>
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
                    dragHandle={handle}
                  />
                </div>
              )}
            </SortableStop>
          ))}
        </SortableList>

        {/* Reorders invalidate the cached drive matrix until the next
            Start-route call — drive_minutes_from_prev / _miles_from_prev
            on each row remain stale until then. */}
        {stops.length > 0 && (
          <div className="pt-3.5 pb-1 text-center text-xs text-ink-400">
            {counts.pending + counts.in_progress > 0
              ? `${counts.pending + counts.in_progress} stops left`
              : "All stops handled"}
            {reorderStopsMutation.isPending && (
              <span className="block mt-0.5 text-[10.5px] text-ink-300">
                Saving new order…
              </span>
            )}
          </div>
        )}
      </div>

      {/* Multi-crew picker — opens when an operator with 2+ crews taps
          Start route while filtered to "All". One tap picks the crew
          AND fires the mutation, no extra confirm step. */}
      {crewPickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setCrewPickerOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-card rounded-[16px] p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[15px] font-bold text-ink-900 mb-1">
              Which crew runs this?
            </div>
            <p className="text-[11.5px] text-ink-500 mb-3">
              Pick the crew that will own today's stops. You can re-assign later.
            </p>
            <div className="flex flex-col gap-1.5">
              {crews.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCrewPickerOpen(false);
                    startRouteMutation.mutate({ crewId: c.id });
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-ink-200 hover:bg-ink-100 text-left transition-colors"
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="text-[13.5px] font-semibold text-ink-900">
                    {c.name}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCrewPickerOpen(false)}
              className="mt-3 w-full text-center text-[12px] font-medium text-ink-500 hover:text-ink-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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
  /** dnd-kit handle props from SortableStop. Falsy props for pinned stops. */
  dragHandle?: {
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown>;
    setActivatorNodeRef: (node: HTMLElement | null) => void;
    isDragging: boolean;
  };
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
  dragHandle,
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
      {/* Drag handle — wired to dnd-kit when SortableStop has loaded the
          modules. For pinned (non-pending) stops the handle stays hidden
          since the operator can't re-sequence a stop that already
          happened. The {...attributes}/{...listeners} spread comes from
          useSortable; setActivatorNodeRef binds the activator so only the
          grip (not the whole card) starts a drag. */}
      <button
        ref={(node) => dragHandle?.setActivatorNodeRef(node)}
        type="button"
        aria-label="Drag to reorder"
        className={cn(
          "-ml-1 p-0.5 text-ink-300 touch-none",
          !isPending && "invisible",
          dragHandle?.isDragging && "text-bronze-500",
        )}
        {...(dragHandle?.attributes ?? {})}
        {...(dragHandle?.listeners ?? {})}
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
