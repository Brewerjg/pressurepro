import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUp,
  ArrowDown,
  Gauge,
  Users,
  AlertTriangle,
  Repeat,
  Wrench,
  Calendar as CalendarIcon,
  Split,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Route, RouteStop } from "@/components/routes/types";
import { cn } from "@/lib/utils";

// Reports — TurfPro operator KPIs (v2). MRR is the headline (recurring is the
// lawn-care default per TURFPRO_SPEC.md). v1 windows are still 30/60/90 day;
// v2 adds longer-horizon strategic views (52-week seasonality, lifetime
// customer totals) on top.
//
// Data layer notes:
//  - We run ONE master useQuery that fans out to parallel reads (plans,
//    routes 52w, recent stops joined for skips, stops 90d for service-mix,
//    lifetime stops for LTV, crews, recent quotes). Reporting isn't real-time
//    and the volume is bounded (single operator), so the extra request count
//    is cheaper than the maintenance cost of independent queries.
//  - Cached 5 minutes via staleTime.
//  - `routes` and `route_stops` aren't in the generated Database types yet
//    (they ship in supabase/migrations/0001_turfpro_lawn_care.sql); cast at
//    the boundary using the hand-rolled types from components/routes/types.ts.
//
// v2 query-size handling:
//  - Routes pulled 52 weeks back instead of 60d. For a 7-day-a-week operator
//    that's ~364 rows of `routes` (one per crew-day) — trivially within
//    Supabase's default 1000-row cap.
//  - Lifetime stops query selects ONLY the columns we need (id, customer_id,
//    customer_name_snapshot, address_snapshot, fee_cents, status, created_at,
//    completed_at) and filters status='done' server-side so the wire payload
//    stays small even for multi-year operators (~25k rows max). We page in
//    1000-row chunks if needed via .range().
//
// Approximations called out in the report-back:
//  - Churn: there's no plan_status_history table, so canceled plans are
//    detected by `status='canceled' AND updated_at` falling in-window.
//  - Drive-time: total_minutes - (stops * 25) is a heuristic with the
//    industry-standard 25-min/stop average.

type PlanRow = Database["public"]["Tables"]["maintenance_plans"]["Row"];
type CrewRow = Database["public"]["Tables"]["crews"]["Row"];
type QuoteRow = Database["public"]["Tables"]["quotes"]["Row"];

const AVG_VISIT_MINUTES = 25;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

// Lightweight stop shape for the lifetime query — we only project the
// columns we actually aggregate on so the wire payload stays small even for
// multi-year operators.
interface LifetimeStop {
  id: string;
  customer_id: string | null;
  customer_name_snapshot: string | null;
  address_snapshot: string | null;
  fee_cents: number | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  plan_id: string | null;
}

// TurfPro palette pulled by hand — recharts can't resolve CSS vars at draw time.
const PALETTE = {
  green700: "hsl(145 55% 28%)",
  green500: "hsl(138 45% 48%)",
  green200: "hsl(140 30% 88%)",
  bronze500: "hsl(30 70% 48%)",
  bronze400: "hsl(32 75% 58%)",
  ink300: "hsl(150 6% 78%)",
} as const;

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const fmtPct = (n: number, digits = 1) =>
  `${n >= 0 ? "" : ""}${n.toFixed(digits)}%`;

// Plans store amount in dollars; interval_months is the billing cadence.
// Per-month value of an active plan = amount / interval_months.
const monthlyValue = (plan: PlanRow): number => {
  if (!plan.amount || !plan.interval_months) return 0;
  return Number(plan.amount) / Number(plan.interval_months);
};

interface ReportData {
  plans: PlanRow[];
  routes: Route[]; // 52-week window — feeds seasonality + 30d-derived crew/$/drive
  stops: RouteStop[]; // 60d joined + 90d flat — feeds service mix + skip log
  crews: CrewRow[];
  quotes: QuoteRow[]; // last 90d, used for quote-vs-plan revenue split
  lifetimeStops: LifetimeStop[]; // ALL done stops — feeds true-lifetime totals
}

async function fetchReportData(): Promise<ReportData> {
  const now = Date.now();
  const ninetyAgo = new Date(now - 90 * MS_PER_DAY).toISOString();
  const sixtyAgoDate = new Date(now - 60 * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  // 52 weeks back for seasonality. 364 days keeps it inside Supabase's default
  // row cap (a 7-day operator yields ~364 routes) and still gives a clean
  // year-over-year rhythm for the line chart.
  const fiftyTwoWeeksAgoDate = new Date(now - 52 * MS_PER_WEEK)
    .toISOString()
    .slice(0, 10);

  const [
    plansRes,
    routesRes,
    stopsRes,
    crewsRes,
    quotesRes,
  ] = await Promise.all([
    supabase.from("maintenance_plans").select("*"),
    // routes table isn't in generated types — cast via `from` as any-keyed
    // call. Window widened to 52 weeks for the seasonality chart; KPIs that
    // are 30d-scoped (drive-time, crew $/hr) filter further client-side.
    (supabase.from("routes" as never) as never as ReturnType<typeof supabase.from>)
      .select("*")
      .gte("date", fiftyTwoWeeksAgoDate),
    (supabase.from("route_stops" as never) as never as ReturnType<typeof supabase.from>)
      .select("*, routes!inner(date, status)")
      .gte("routes.date", sixtyAgoDate),
    supabase.from("crews").select("*"),
    // Quotes for the quote-vs-plan split. Only accepted/paid count as
    // "won" one-off revenue; we pre-filter the status server-side. RLS scopes
    // to the current operator.
    supabase
      .from("quotes")
      .select("id, status, total, created_at")
      .in("status", ["accepted", "paid"])
      .gte("created_at", ninetyAgo),
  ]);

  if (plansRes.error) throw plansRes.error;
  if (routesRes.error) throw routesRes.error;
  if (stopsRes.error) throw stopsRes.error;
  if (crewsRes.error) throw crewsRes.error;
  if (quotesRes.error) throw quotesRes.error;

  // Stops carry an embedded `routes` join; keep that around for the aging
  // skip log which needs route.date for the 60d window.
  const joinedStops = (stopsRes.data ?? []) as unknown as Array<
    RouteStop & { routes?: { date: string; status: string } }
  >;

  // Pull 90d worth of stops too (service mix uses 90d). The previous request
  // capped at 60d via the join; do a second pull without the join to cover
  // the full 90d window for service-mix.
  const stops90Res = await (
    supabase.from("route_stops" as never) as never as ReturnType<typeof supabase.from>
  )
    .select("*")
    .gte("created_at", ninetyAgo);
  if (stops90Res.error) throw stops90Res.error;

  // Lifetime stops — narrow projection, page through 1000-row chunks so we
  // don't truncate silently for operators with multi-year histories.
  const LIFETIME_COLUMNS =
    "id, customer_id, customer_name_snapshot, address_snapshot, fee_cents, status, created_at, completed_at, plan_id";
  const lifetimeStops: LifetimeStop[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await (
      supabase.from("route_stops" as never) as never as ReturnType<typeof supabase.from>
    )
      .select(LIFETIME_COLUMNS)
      .eq("status", "done")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as LifetimeStop[];
    lifetimeStops.push(...rows);
    if (rows.length < PAGE) break;
    // Defensive ceiling — even 5 years of weekly visits caps near 25k.
    if (offset > 50_000) break;
  }

  return {
    plans: (plansRes.data ?? []) as PlanRow[],
    routes: (routesRes.data ?? []) as unknown as Route[],
    stops: [
      ...joinedStops,
      ...((stops90Res.data ?? []) as unknown as RouteStop[]),
    ],
    crews: (crewsRes.data ?? []) as CrewRow[],
    quotes: (quotesRes.data ?? []) as QuoteRow[],
    lifetimeStops,
  };
}

interface Derived {
  // MRR
  mrr: number;
  mrrPrior: number;
  mrrDeltaPct: number;
  activePlans: number;
  // Churn
  churnPct: number;
  churnedCount: number;
  // Quote-vs-plan revenue split (90d)
  quoteVsPlan: {
    planRevenue: number; // recurring (plan-tied stops) $
    quoteRevenue: number; // one-off (accepted/paid quotes) $
    planPct: number;
    quotePct: number;
  };
  // 52-week seasonality
  seasonality: Array<{
    weekIndex: number; // 0..51, 51 = current week
    label: string; // e.g. "May 4"
    revenue: number;
    isCurrent: boolean;
  }>;
  seasonalityMedian: number;
  // Drive-time
  driveData: { drivePct: number; driveMinutes: number; totalMinutes: number; routeCount: number } | null;
  // Crew $/hr
  crewBars: Array<{ name: string; perHour: number; hours: number }>;
  // Top services (90d, replaces v1 service mix pie)
  topServices: Array<{ name: string; revenue: number; visits: number; pct: number }>;
  // Top customers — lifetime totals
  topCustomers: Array<{ id: string; name: string; address: string | null; total: number }>;
  // Lifetime stats
  lifetime: {
    avgLtv: number;
    avgTenureMonths: number;
    overOneYear: number;
    customerCount: number;
  };
  // Aging skips
  agingSkips: Array<{
    propertyId: string;
    address: string;
    count: number;
    atRisk: boolean;
  }>;
}

function deriveKPIs(data: ReportData): Derived {
  const now = Date.now();
  const thirtyAgo = now - 30 * MS_PER_DAY;
  const sixtyAgo = now - 60 * MS_PER_DAY;
  const ninetyAgo = now - 90 * MS_PER_DAY;

  // --- 1. MRR ---
  const activePlans = data.plans.filter((p) => p.status === "active");
  const mrr = activePlans.reduce((s, p) => s + monthlyValue(p), 0);

  // Plans active "30 days ago" = created before cutoff AND not canceled
  // before cutoff. We approximate the canceled-before-cutoff piece by looking
  // at canceled plans whose updated_at is before the cutoff (best guess
  // without a status history table).
  const priorActive = data.plans.filter((p) => {
    const createdMs = new Date(p.created_at).getTime();
    if (createdMs > thirtyAgo) return false;
    if (p.status === "canceled") {
      const updMs = new Date(p.updated_at).getTime();
      if (updMs < thirtyAgo) return false; // canceled before window — not active then
    }
    return true;
  });
  const mrrPrior = priorActive.reduce((s, p) => s + monthlyValue(p), 0);
  const mrrDeltaPct = mrrPrior > 0 ? ((mrr - mrrPrior) / mrrPrior) * 100 : 0;

  // --- 2. Churn (30d) ---
  // Approx: count plans whose status is canceled AND updated_at falls in the
  // last 30 days. Denominator is plans active at the start of that window.
  const churnedCount = data.plans.filter((p) => {
    if (p.status !== "canceled") return false;
    const updMs = new Date(p.updated_at).getTime();
    return updMs >= thirtyAgo;
  }).length;
  const churnDenominator = priorActive.length;
  const churnPct =
    churnDenominator > 0 ? (churnedCount / churnDenominator) * 100 : 0;

  // --- 3. Drive-time efficiency ---
  const recentRoutes = data.routes.filter((r) => {
    if (r.status !== "complete") return false;
    const dt = new Date(r.date).getTime();
    return dt >= thirtyAgo;
  });
  let driveData: Derived["driveData"] = null;
  if (recentRoutes.length > 0) {
    let totalMinutes = 0;
    let driveMinutes = 0;
    for (const r of recentRoutes) {
      const mins = Number(r.total_minutes ?? 0);
      const stops = Number(r.total_stops ?? 0);
      if (mins <= 0 || stops <= 0) continue;
      totalMinutes += mins;
      driveMinutes += Math.max(0, mins - stops * AVG_VISIT_MINUTES);
    }
    if (totalMinutes > 0) {
      driveData = {
        drivePct: (driveMinutes / totalMinutes) * 100,
        driveMinutes,
        totalMinutes,
        routeCount: recentRoutes.length,
      };
    }
  }

  // --- 4. Crew $/hr (last 30d, completed routes with crew + collected) ---
  const crewTotals = new Map<string, { collected: number; minutes: number }>();
  for (const r of recentRoutes) {
    if (!r.crew_id) continue;
    const collected = Number(r.total_collected_cents ?? 0) / 100;
    const minutes = Number(r.total_minutes ?? 0);
    if (collected <= 0 || minutes <= 0) continue;
    const cur = crewTotals.get(r.crew_id) ?? { collected: 0, minutes: 0 };
    cur.collected += collected;
    cur.minutes += minutes;
    crewTotals.set(r.crew_id, cur);
  }
  const crewBars = Array.from(crewTotals.entries())
    .map(([crewId, { collected, minutes }]) => {
      const crew = data.crews.find((c) => c.id === crewId);
      return {
        name: crew?.name ?? "Crew",
        perHour: minutes > 0 ? (collected / minutes) * 60 : 0,
        hours: minutes / 60,
      };
    })
    .sort((a, b) => b.perHour - a.perHour)
    .slice(0, 5);

  // --- 5. Top services (last 90d, done stops, primary service = services[0]) ---
  // Vertical bar list, ranked. We track both $ revenue and visit counts so
  // the operator can spot high-frequency / low-margin vs low-frequency /
  // high-margin services at a glance.
  const serviceAgg = new Map<string, { revenue: number; visits: number }>();
  for (const stop of data.stops) {
    if (stop.status !== "done") continue;
    const createdMs = new Date(
      (stop as { created_at?: string }).created_at ?? 0,
    ).getTime();
    if (createdMs < ninetyAgo) continue;
    const primary = (stop.services ?? [])[0];
    if (!primary) continue;
    const fee = Number(stop.fee_cents ?? 0) / 100;
    if (fee <= 0) continue;
    const cur = serviceAgg.get(primary) ?? { revenue: 0, visits: 0 };
    cur.revenue += fee;
    cur.visits += 1;
    serviceAgg.set(primary, cur);
  }
  const serviceRows = Array.from(serviceAgg.entries()).map(
    ([name, v]) => ({ name, revenue: v.revenue, visits: v.visits }),
  );
  const serviceTotal = serviceRows.reduce((s, x) => s + x.revenue, 0);
  // Deterministic ordering: by revenue desc, then name asc for tied ties.
  const topServices = serviceRows
    .map((r) => ({
      ...r,
      pct: serviceTotal > 0 ? (r.revenue / serviceTotal) * 100 : 0,
    }))
    .sort((a, b) =>
      b.revenue !== a.revenue
        ? b.revenue - a.revenue
        : a.name.localeCompare(b.name),
    )
    .slice(0, 8);

  // --- 6. Top customers — TRUE lifetime totals (all-time done stops) ---
  // v1 used a 90d proxy; v2 reads from the dedicated lifetime fetch which
  // pages through every done stop the operator has logged.
  const customerLifetime = new Map<
    string,
    {
      name: string;
      address: string | null;
      total: number;
      first: number;
      last: number;
    }
  >();
  for (const stop of data.lifetimeStops) {
    if (stop.status !== "done") continue;
    if (!stop.customer_id) continue;
    const fee = Number(stop.fee_cents ?? 0) / 100;
    if (fee <= 0) continue;
    const ts = new Date(stop.completed_at ?? stop.created_at).getTime();
    const cur = customerLifetime.get(stop.customer_id) ?? {
      name: stop.customer_name_snapshot ?? "Customer",
      address: stop.address_snapshot,
      total: 0,
      first: ts,
      last: ts,
    };
    cur.total += fee;
    if (ts < cur.first) cur.first = ts;
    if (ts > cur.last) cur.last = ts;
    // Refresh name/address from the most recent snapshot so renames flow through.
    if (ts === cur.last) {
      cur.name = stop.customer_name_snapshot ?? cur.name;
      cur.address = stop.address_snapshot ?? cur.address;
    }
    customerLifetime.set(stop.customer_id, cur);
  }
  const topCustomers = Array.from(customerLifetime.entries())
    .map(([id, v]) => ({
      id,
      name: v.name,
      address: v.address,
      total: v.total,
    }))
    .sort((a, b) =>
      b.total !== a.total ? b.total - a.total : a.name.localeCompare(b.name),
    )
    .slice(0, 10);

  // Lifetime stats — averages across customers with at least one done stop.
  const customerSummaries = Array.from(customerLifetime.values());
  const customerCount = customerSummaries.length;
  const avgLtv =
    customerCount > 0
      ? customerSummaries.reduce((s, c) => s + c.total, 0) / customerCount
      : 0;
  const tenureMonths = (first: number, last: number) =>
    Math.max(0, (last - first) / (MS_PER_DAY * 30.4375));
  const totalTenure = customerSummaries.reduce(
    (s, c) => s + tenureMonths(c.first, c.last),
    0,
  );
  const avgTenureMonths = customerCount > 0 ? totalTenure / customerCount : 0;
  const overOneYear = customerSummaries.filter(
    (c) => tenureMonths(c.first, c.last) >= 12,
  ).length;
  const lifetime = {
    avgLtv,
    avgTenureMonths,
    overOneYear,
    customerCount,
  };

  // --- 8. Quote-vs-plan revenue split (last 90d) ---
  // Plan revenue = stops with a plan_id attached (recurring). Quote revenue =
  // accepted/paid one-off quotes. We deliberately read plan revenue from the
  // 90d stops set (not lifetimeStops) so the time window matches the quote
  // window exactly.
  let planRevenue = 0;
  for (const stop of data.stops as Array<
    RouteStop & {
      routes?: { date: string; status: string };
      plan_id?: string | null;
      created_at?: string;
    }
  >) {
    if (stop.status !== "done") continue;
    if (!stop.plan_id) continue;
    // Only count stops whose parent route is complete. When the join is
    // present we use it; the 90d flat pull doesn't carry the join, so fall
    // back to the stop's own done status (already filtered above).
    if (stop.routes && stop.routes.status !== "complete") continue;
    const ts = new Date(stop.created_at ?? 0).getTime();
    if (ts < ninetyAgo) continue;
    planRevenue += Number(stop.fee_cents ?? 0) / 100;
  }
  let quoteRevenue = 0;
  for (const q of data.quotes) {
    const ts = new Date(q.created_at).getTime();
    if (ts < ninetyAgo) continue;
    quoteRevenue += Number(q.total ?? 0);
  }
  const splitTotal = planRevenue + quoteRevenue;
  const quoteVsPlan = {
    planRevenue,
    quoteRevenue,
    planPct: splitTotal > 0 ? (planRevenue / splitTotal) * 100 : 0,
    quotePct: splitTotal > 0 ? (quoteRevenue / splitTotal) * 100 : 0,
  };

  // --- 9. 52-week seasonality ---
  // Bucket completed routes into 52 ordered weekly buckets, oldest first.
  // weekIndex 51 = current week. We label each bucket with the *Monday* of
  // the week for tooltip readability.
  const WEEKS = 52;
  const today = new Date(now);
  // Anchor on the Monday of the current week — keeps weeks aligned regardless
  // of when the user opens the report.
  const todayDow = today.getDay(); // 0 = Sun .. 6 = Sat
  const daysSinceMonday = (todayDow + 6) % 7;
  const currentWeekStart = new Date(today);
  currentWeekStart.setHours(0, 0, 0, 0);
  currentWeekStart.setDate(currentWeekStart.getDate() - daysSinceMonday);
  const currentWeekStartMs = currentWeekStart.getTime();
  const weekBuckets = new Array<number>(WEEKS).fill(0);
  for (const r of data.routes) {
    if (r.status !== "complete") continue;
    const collected = Number(r.total_collected_cents ?? 0) / 100;
    if (collected <= 0) continue;
    const dt = new Date(r.date + "T00:00:00").getTime();
    if (isNaN(dt)) continue;
    const weeksAgo = Math.floor((currentWeekStartMs - dt) / MS_PER_WEEK);
    if (weeksAgo < 0 || weeksAgo >= WEEKS) continue;
    const idx = WEEKS - 1 - weeksAgo;
    weekBuckets[idx] += collected;
  }
  const monthFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });
  const seasonality = weekBuckets.map((revenue, i) => {
    const start = new Date(currentWeekStartMs - (WEEKS - 1 - i) * MS_PER_WEEK);
    return {
      weekIndex: i,
      label: monthFmt.format(start),
      revenue,
      isCurrent: i === WEEKS - 1,
    };
  });
  const nonZeroWeeks = weekBuckets.filter((v) => v > 0).sort((a, b) => a - b);
  const seasonalityMedian =
    nonZeroWeeks.length > 0
      ? nonZeroWeeks[Math.floor(nonZeroWeeks.length / 2)]
      : 0;

  // --- 7. Aging skip log (last 60d, status='skipped') ---
  // Use the embedded route.date filter we pulled earlier. Stops without an
  // attached `routes` join (the 90d pull) have undefined route info, so we
  // fall back to created_at.
  const skipCounts = new Map<string, { address: string; count: number }>();
  for (const stop of data.stops as Array<
    RouteStop & { routes?: { date: string } }
  >) {
    if (stop.status !== "skipped") continue;
    const dateStr = stop.routes?.date;
    const dt = dateStr
      ? new Date(dateStr).getTime()
      : new Date((stop as { created_at?: string }).created_at ?? 0).getTime();
    if (dt < sixtyAgo) continue;
    if (!stop.property_id) continue;
    const cur = skipCounts.get(stop.property_id) ?? {
      address: stop.address_snapshot ?? "Property",
      count: 0,
    };
    cur.count += 1;
    skipCounts.set(stop.property_id, cur);
  }
  const agingSkips = Array.from(skipCounts.entries())
    .map(([propertyId, v]) => ({
      propertyId,
      address: v.address,
      count: v.count,
      atRisk: v.count >= 3,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    mrr,
    mrrPrior,
    mrrDeltaPct,
    activePlans: activePlans.length,
    churnPct,
    churnedCount,
    quoteVsPlan,
    seasonality,
    seasonalityMedian,
    driveData,
    crewBars,
    topServices,
    topCustomers,
    lifetime,
    agingSkips,
  };
}

export default function Reports() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports"],
    queryFn: fetchReportData,
    staleTime: 5 * 60 * 1000,
  });

  const k = useMemo(() => (data ? deriveKPIs(data) : null), [data]);

  return (
    <div className="pt-3 pb-8">
      {/* Header — same shape as Plans.tsx */}
      <header className="px-[22px] pb-[18px]">
        <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
          Last 30 days
        </div>
        <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5">
          Reports
        </h1>
      </header>

      {error ? (
        <div className="mx-4 tp-card p-6 text-center">
          <p className="text-sm text-destructive">Couldn't load reports.</p>
          <p className="text-xs text-ink-500 mt-1">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      ) : (
        <>
          {/* MRR hero — matches Home.tsx visual treatment */}
          <MrrHero
            loading={isLoading || !k}
            mrr={k?.mrr ?? 0}
            activePlans={k?.activePlans ?? 0}
            deltaPct={k?.mrrDeltaPct ?? 0}
          />

          {/* Churn — own row (drive-time sits below the new strategic cards) */}
          <section className="mx-4 mb-3">
            <SectionHeader>Health</SectionHeader>
            <ChurnCard
              loading={isLoading || !k}
              churnPct={k?.churnPct ?? 0}
              churnedCount={k?.churnedCount ?? 0}
            />
          </section>

          {/* Quote vs plan revenue split — strategic mix */}
          <section className="mx-4 mb-3">
            <SectionHeader>Quote vs plan revenue · last 90d</SectionHeader>
            <QuoteVsPlanCard
              loading={isLoading || !k}
              split={k?.quoteVsPlan ?? null}
            />
          </section>

          {/* Seasonality — 52 week line */}
          <section className="mx-4 mb-3">
            <SectionHeader>Seasonality · last 52 weeks</SectionHeader>
            <SeasonalityCard
              loading={isLoading || !k}
              weeks={k?.seasonality ?? []}
              median={k?.seasonalityMedian ?? 0}
            />
          </section>

          {/* Drive-time — back in single-card form */}
          <section className="mx-4 mb-3">
            <SectionHeader>Drive-time efficiency · last 30d</SectionHeader>
            <DriveCard loading={isLoading || !k} drive={k?.driveData ?? null} />
          </section>

          {/* Crew $/hr */}
          <section className="mx-4 mb-3">
            <SectionHeader>$/hr by crew · last 30d</SectionHeader>
            <CrewBars loading={isLoading || !k} bars={k?.crewBars ?? []} />
          </section>

          {/* Top services ranked — replaces v1 service-mix pie */}
          <section className="mx-4 mb-3">
            <SectionHeader>Top services · last 90d</SectionHeader>
            <TopServices
              loading={isLoading || !k}
              rows={k?.topServices ?? []}
            />
          </section>

          {/* Customer lifetime stats */}
          <section className="mx-4 mb-3">
            <SectionHeader>Customer lifetime</SectionHeader>
            <LifetimeStatsCard
              loading={isLoading || !k}
              stats={k?.lifetime ?? null}
            />
          </section>

          {/* Top customers — true lifetime totals */}
          <section className="mx-4 mb-3">
            <SectionHeader>Top customers · lifetime</SectionHeader>
            <TopCustomers
              loading={isLoading || !k}
              customers={k?.topCustomers ?? []}
            />
          </section>

          {/* Aging skip log */}
          <section className="mx-4 mb-3">
            <SectionHeader>Aging skip log · last 60d</SectionHeader>
            <SkipLog loading={isLoading || !k} skips={k?.agingSkips ?? []} />
          </section>
        </>
      )}
    </div>
  );
}

// =====================================================================
// Section header
// =====================================================================
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[13px] font-semibold text-ink-700 tracking-[0.2px] px-1 pb-2">
      {children}
    </h2>
  );
}

// =====================================================================
// MRR hero card — matches Home.tsx visual treatment
// =====================================================================
function MrrHero({
  loading,
  mrr,
  activePlans,
  deltaPct,
}: {
  loading: boolean;
  mrr: number;
  activePlans: number;
  deltaPct: number;
}) {
  const positive = deltaPct >= 0;
  return (
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
          {!loading && (
            <div
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full",
                positive
                  ? "text-[#cfead8] bg-white/10"
                  : "text-[#f0c5b8] bg-white/10",
              )}
            >
              {positive ? (
                <ArrowUp className="h-3 w-3" strokeWidth={2.2} />
              ) : (
                <ArrowDown className="h-3 w-3" strokeWidth={2.2} />
              )}
              {fmtPct(deltaPct)} 30d
            </div>
          )}
        </div>
        {loading ? (
          <div className="h-[48px] w-40 rounded-md bg-white/10 animate-pulse" />
        ) : (
          <div className="tp-display tp-num text-[48px] font-bold leading-none tracking-[-0.04em]">
            {fmtUSD(mrr)}
            <span className="text-lg text-bronze-400 font-semibold ml-1">
              /mo
            </span>
          </div>
        )}
        <div className="flex gap-6 mt-4 pt-3.5 border-t border-white/10">
          <HeroStat
            value={loading ? "—" : String(activePlans)}
            label="Active plans"
          />
          <HeroStat
            value={
              loading
                ? "—"
                : activePlans > 0
                  ? fmtUSD(mrr / activePlans)
                  : "—"
            }
            label="Avg/customer"
          />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="tp-num text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-[#a8c9b7] mt-px">{label}</div>
    </div>
  );
}

// =====================================================================
// Churn card
// =====================================================================
function ChurnCard({
  loading,
  churnPct,
  churnedCount,
}: {
  loading: boolean;
  churnPct: number;
  churnedCount: number;
}) {
  if (loading) {
    return <div className="tp-card p-3.5 h-[104px] animate-pulse bg-ink-100" />;
  }
  // Industry rule of thumb: <2% monthly is healthy lawn-care churn.
  const healthy = churnPct < 2;
  return (
    <div className="tp-card p-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Repeat className="h-3.5 w-3.5 text-ink-500" strokeWidth={2} />
        <div className="text-[11px] font-semibold tracking-[0.3px] uppercase text-ink-500">
          Churn 30d
        </div>
      </div>
      <div
        className={cn(
          "tp-num tp-display text-[26px] font-bold leading-none flex items-baseline gap-1",
          healthy ? "text-ink-900" : "text-destructive",
        )}
      >
        {churnPct.toFixed(1)}
        <span className="text-sm opacity-60">%</span>
        {!healthy && (
          <ArrowUp className="h-4 w-4 text-destructive ml-0.5" strokeWidth={2.4} />
        )}
      </div>
      <div className="text-[11px] text-ink-500 mt-1.5">
        {churnedCount} canceled · target &lt; 2%
      </div>
    </div>
  );
}

// =====================================================================
// Drive-time card
// =====================================================================
function DriveCard({
  loading,
  drive,
}: {
  loading: boolean;
  drive: Derived["driveData"];
}) {
  if (loading) {
    return <div className="tp-card p-3.5 h-[104px] animate-pulse bg-ink-100" />;
  }
  if (!drive) {
    return (
      <div className="tp-card p-3.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Gauge className="h-3.5 w-3.5 text-ink-500" strokeWidth={2} />
          <div className="text-[11px] font-semibold tracking-[0.3px] uppercase text-ink-500">
            Drive-time
          </div>
        </div>
        <div className="text-[13px] text-ink-500 mt-2">
          No completed routes yet.
        </div>
      </div>
    );
  }
  const efficient = drive.drivePct < 25;
  return (
    <div className="tp-card p-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Gauge className="h-3.5 w-3.5 text-ink-500" strokeWidth={2} />
        <div className="text-[11px] font-semibold tracking-[0.3px] uppercase text-ink-500">
          Drive-time
        </div>
      </div>
      <div
        className={cn(
          "tp-num tp-display text-[26px] font-bold leading-none flex items-baseline gap-1",
          efficient ? "text-ink-900" : "text-bronze-600",
        )}
      >
        {drive.drivePct.toFixed(0)}
        <span className="text-sm opacity-60">%</span>
      </div>
      <div className="text-[11px] text-ink-500 mt-1.5">
        Good &lt; 25% · {drive.routeCount} route
        {drive.routeCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}

// =====================================================================
// Crew $/hr — recharts horizontal bar
// =====================================================================
function CrewBars({
  loading,
  bars,
}: {
  loading: boolean;
  bars: Derived["crewBars"];
}) {
  if (loading) {
    return <div className="tp-card p-3.5 h-[180px] animate-pulse bg-ink-100" />;
  }
  if (bars.length === 0) {
    return (
      <div className="tp-card p-5 text-center">
        <p className="text-[13px] text-ink-500">
          No completed routes with crew + revenue yet.
        </p>
      </div>
    );
  }
  // Slightly taller per bar; cap to keep it scannable on mobile.
  const height = Math.max(120, 28 * bars.length + 40);
  return (
    <div className="tp-card p-3.5">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={bars}
            layout="vertical"
            margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
          >
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: "hsl(150 6% 45%)" }}
              tickFormatter={(v: number) => `$${Math.round(v)}`}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "hsl(150 8% 22%)" }}
              width={80}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "hsl(150 6% 90% / 0.3)" }}
              formatter={(v: number) => [`${fmtUSD(v)}/hr`, "Rate"]}
              labelFormatter={(name: string) => name}
              contentStyle={{
                fontSize: 11,
                borderRadius: 8,
                border: "1px solid hsl(150 6% 88%)",
              }}
            />
            <Bar
              dataKey="perHour"
              fill={PALETTE.green700}
              radius={[0, 6, 6, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// =====================================================================
// Quote-vs-plan revenue split card
// =====================================================================
// Strategic mix: how much of the operator's 90d revenue comes from recurring
// plans (the predictable book of business) vs one-off accepted quotes (the
// project pipeline). Rendered as two stacked horizontal bars rather than a
// pie so the relative magnitude is read at a glance.
function QuoteVsPlanCard({
  loading,
  split,
}: {
  loading: boolean;
  split: Derived["quoteVsPlan"] | null;
}) {
  if (loading || !split) {
    return <div className="tp-card p-3.5 h-[140px] animate-pulse bg-ink-100" />;
  }
  const { planRevenue, quoteRevenue, planPct, quotePct } = split;
  const total = planRevenue + quoteRevenue;

  if (total <= 0) {
    return (
      <div className="tp-card p-5 text-center">
        <Split
          className="h-6 w-6 mx-auto text-ink-400"
          strokeWidth={1.6}
        />
        <p className="text-[13px] text-ink-500 mt-2">
          No completed revenue in the last 90 days.
        </p>
      </div>
    );
  }

  const planFlex = Math.max(planRevenue, 0.0001);
  const quoteFlex = Math.max(quoteRevenue, 0.0001);
  const maxVal = Math.max(planFlex, quoteFlex);

  return (
    <div className="tp-card p-3.5">
      <div className="flex items-baseline justify-between mb-3">
        <div className="tp-num tp-display text-[22px] font-bold text-ink-900">
          {fmtUSD(total)}
        </div>
        <div className="text-[11px] text-ink-500">total 90d</div>
      </div>

      <div className="flex flex-col gap-3">
        <SplitBar
          label="Recurring plans"
          value={planRevenue}
          pct={planPct}
          color={PALETTE.green700}
          widthPct={(planFlex / maxVal) * 100}
        />
        <SplitBar
          label="One-off quotes"
          value={quoteRevenue}
          pct={quotePct}
          color={PALETTE.bronze500}
          widthPct={(quoteFlex / maxVal) * 100}
        />
      </div>

      {quoteRevenue <= 0 && (
        <p className="text-[11px] text-ink-500 mt-3">
          No one-off jobs accepted in this window.
        </p>
      )}
    </div>
  );
}

function SplitBar({
  label,
  value,
  pct,
  color,
  widthPct,
}: {
  label: string;
  value: number;
  pct: number;
  color: string;
  widthPct: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[12px] font-semibold text-ink-700">{label}</span>
        <span className="tp-num text-[12px] text-ink-900">
          <span className="font-semibold">{fmtUSD(value)}</span>
          <span className="text-ink-500 ml-1.5">{pct.toFixed(0)}%</span>
        </span>
      </div>
      <div className="h-[10px] rounded-full bg-ink-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.max(2, widthPct)}%`, background: color }}
        />
      </div>
    </div>
  );
}

// =====================================================================
// Seasonality — 52-week line chart
// =====================================================================
// Shows weekly collected $ over a full year, with the current week emphasized
// via a darker dot, and a faint median reference line so the operator can
// see whether they're in a peak/trough week relative to typical performance.
function SeasonalityCard({
  loading,
  weeks,
  median,
}: {
  loading: boolean;
  weeks: Derived["seasonality"];
  median: number;
}) {
  if (loading) {
    return <div className="tp-card p-3.5 h-[220px] animate-pulse bg-ink-100" />;
  }
  const hasData = weeks.some((w) => w.revenue > 0);
  if (!hasData) {
    return (
      <div className="tp-card p-5 text-center">
        <CalendarIcon
          className="h-6 w-6 mx-auto text-ink-400"
          strokeWidth={1.6}
        />
        <p className="text-[13px] text-ink-500 mt-2">
          Not enough history yet — check back after a few visits.
        </p>
      </div>
    );
  }
  const peak = weeks.reduce((m, w) => Math.max(m, w.revenue), 0);
  const currentWeek = weeks[weeks.length - 1];

  return (
    <div className="tp-card p-3.5">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="tp-num tp-display text-[22px] font-bold text-ink-900">
            {fmtUSD(currentWeek?.revenue ?? 0)}
          </div>
          <div className="text-[11px] text-ink-500">this week</div>
        </div>
        <div className="text-right">
          <div className="tp-num text-[14px] font-semibold text-ink-700">
            {fmtUSD(median)}
          </div>
          <div className="text-[11px] text-ink-500">52w median</div>
        </div>
      </div>

      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={weeks}
            margin={{ top: 8, right: 6, bottom: 4, left: 0 }}
          >
            <XAxis
              dataKey="weekIndex"
              tick={{ fontSize: 10, fill: "hsl(150 6% 45%)" }}
              tickFormatter={(v: number) => {
                // Show ~5 evenly-spaced labels for legibility.
                if (v === 0) return weeks[0]?.label ?? "";
                if (v === Math.floor(weeks.length / 4)) return weeks[Math.floor(weeks.length / 4)]?.label ?? "";
                if (v === Math.floor(weeks.length / 2)) return weeks[Math.floor(weeks.length / 2)]?.label ?? "";
                if (v === Math.floor((3 * weeks.length) / 4)) return weeks[Math.floor((3 * weeks.length) / 4)]?.label ?? "";
                if (v === weeks.length - 1) return "Now";
                return "";
              }}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(150 6% 45%)" }}
              tickFormatter={(v: number) =>
                v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`
              }
              axisLine={false}
              tickLine={false}
              width={42}
              domain={[0, peak * 1.1]}
            />
            <Tooltip
              cursor={{ stroke: "hsl(150 6% 80%)", strokeDasharray: "3 3" }}
              formatter={(v: number) => [fmtUSD(v), "Collected"]}
              labelFormatter={(idx: number) => weeks[idx]?.label ?? ""}
              contentStyle={{
                fontSize: 11,
                borderRadius: 8,
                border: "1px solid hsl(150 6% 88%)",
              }}
            />
            {median > 0 && (
              <ReferenceLine
                y={median}
                stroke={PALETTE.ink300}
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            )}
            <Line
              type="monotone"
              dataKey="revenue"
              stroke={PALETTE.green700}
              strokeWidth={2}
              isAnimationActive={false}
              dot={(props: {
                cx?: number;
                cy?: number;
                payload?: { isCurrent?: boolean };
                index?: number;
              }) => {
                const { cx, cy, payload, index } = props;
                if (typeof cx !== "number" || typeof cy !== "number") {
                  return <g key={index} />;
                }
                if (payload?.isCurrent) {
                  return (
                    <circle
                      key={`dot-${index}`}
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill={PALETTE.green700}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  );
                }
                return <g key={`dot-${index}`} />;
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// =====================================================================
// Top services — ranked vertical bar list (replaces v1 pie)
// =====================================================================
// More scannable than a pie for a 1–2 person operator: each row shows
// service name, $ revenue, visit count, and % of total. Bar width is
// normalized to the top service so visual weight maps to revenue.
function TopServices({
  loading,
  rows,
}: {
  loading: boolean;
  rows: Derived["topServices"];
}) {
  if (loading) {
    return <div className="tp-card p-3.5 h-[220px] animate-pulse bg-ink-100" />;
  }
  if (rows.length === 0) {
    return (
      <div className="tp-card p-5 text-center">
        <Wrench
          className="h-6 w-6 mx-auto text-ink-400"
          strokeWidth={1.6}
        />
        <p className="text-[13px] text-ink-500 mt-2">
          No completed services yet.
        </p>
      </div>
    );
  }
  const top = rows[0]?.revenue ?? 1;
  return (
    <div className="tp-card p-3.5">
      <ul className="flex flex-col gap-2.5">
        {rows.map((r) => {
          const widthPct = top > 0 ? Math.max(4, (r.revenue / top) * 100) : 0;
          return (
            <li key={r.name}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[13px] font-semibold text-ink-900 truncate pr-2">
                  {r.name}
                </span>
                <span className="tp-num text-[12px] shrink-0">
                  <span className="font-semibold text-ink-900">
                    {fmtUSD(r.revenue)}
                  </span>
                  <span className="text-ink-500 ml-1.5">
                    {r.visits} visit{r.visits === 1 ? "" : "s"}
                  </span>
                  <span className="text-ink-500 ml-1.5">
                    {r.pct.toFixed(0)}%
                  </span>
                </span>
              </div>
              <div className="h-[8px] rounded-full bg-ink-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    background: PALETTE.green700,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// =====================================================================
// Customer lifetime stats — 3 side-by-side mini stats
// =====================================================================
function LifetimeStatsCard({
  loading,
  stats,
}: {
  loading: boolean;
  stats: Derived["lifetime"] | null;
}) {
  if (loading || !stats) {
    return <div className="tp-card p-3.5 h-[100px] animate-pulse bg-ink-100" />;
  }
  if (stats.customerCount === 0) {
    return (
      <div className="tp-card p-5 text-center">
        <Users className="h-6 w-6 mx-auto text-ink-400" strokeWidth={1.6} />
        <p className="text-[13px] text-ink-500 mt-2">
          No completed customer visits yet.
        </p>
      </div>
    );
  }
  return (
    <div className="tp-card p-3.5">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Avg LTV" value={fmtUSD(stats.avgLtv)} />
        <MiniStat
          label="Avg tenure"
          value={`${stats.avgTenureMonths.toFixed(1)} mo`}
        />
        <MiniStat
          label="≥ 1 yr"
          value={`${stats.overOneYear}`}
          sub={`of ${stats.customerCount}`}
        />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold tracking-[0.3px] uppercase text-ink-500">
        {label}
      </div>
      <div className="tp-num tp-display text-[20px] font-bold leading-tight text-ink-900 mt-0.5">
        {value}
      </div>
      {sub && <div className="text-[10.5px] text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// =====================================================================
// Top customers
// =====================================================================
function TopCustomers({
  loading,
  customers,
}: {
  loading: boolean;
  customers: Derived["topCustomers"];
}) {
  if (loading) {
    return (
      <ul className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="tp-card p-3 h-[54px] animate-pulse bg-ink-100"
          />
        ))}
      </ul>
    );
  }
  if (customers.length === 0) {
    return (
      <div className="tp-card p-5 text-center">
        <Users className="h-6 w-6 mx-auto text-ink-400" strokeWidth={1.6} />
        <p className="text-[13px] text-ink-500 mt-2">
          No paid stops yet.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {customers.map((c, i) => (
        <li key={c.id}>
          <Link
            to={`/customers/${c.id}`}
            className="tp-card flex items-center gap-3 px-3 py-2.5 active:scale-[0.99] transition-transform"
          >
            <div className="tp-num tp-display text-[15px] font-bold text-bronze-600 w-6 text-center">
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[13.5px] text-ink-900 truncate">
                {c.name}
              </div>
              {c.address && (
                <div className="text-[11px] text-ink-500 truncate">
                  {c.address}
                </div>
              )}
            </div>
            <div className="tp-num font-bold text-[14px] text-ink-900 shrink-0">
              {fmtUSD(c.total)}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// =====================================================================
// Aging skip log
// =====================================================================
function SkipLog({
  loading,
  skips,
}: {
  loading: boolean;
  skips: Derived["agingSkips"];
}) {
  if (loading) {
    return <div className="tp-card p-3.5 h-[120px] animate-pulse bg-ink-100" />;
  }
  if (skips.length === 0) {
    return (
      <div className="tp-card p-5 text-center">
        <p className="text-[13px] text-ink-500">
          No skipped stops — nice work.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {skips.map((s) => (
        <li key={s.propertyId}>
          <Link
            to={`/properties/${s.propertyId}`}
            className={cn(
              "tp-card flex items-center gap-3 px-3 py-2.5 active:scale-[0.99] transition-transform",
              s.atRisk && "border-destructive/40",
            )}
          >
            {s.atRisk ? (
              <AlertTriangle
                className="h-4 w-4 text-destructive shrink-0"
                strokeWidth={2}
              />
            ) : (
              <div className="h-4 w-4 rounded-full bg-ink-200 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div
                className={cn(
                  "font-semibold text-[13px] truncate",
                  s.atRisk ? "text-destructive" : "text-ink-900",
                )}
              >
                {s.address}
              </div>
              {s.atRisk && (
                <div className="text-[10.5px] text-destructive/80 mt-px">
                  At-risk customer
                </div>
              )}
            </div>
            <div className="tp-num text-[13px] font-bold text-ink-700 shrink-0">
              {s.count}× skip{s.count === 1 ? "" : "s"}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
