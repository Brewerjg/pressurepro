import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Navigation,
  Check,
  SkipForward,
  Pause,
  Lock,
  PawPrint,
  Mountain,
  Leaf,
  Clock,
  Truck,
  Loader2,
  CloudRain,
  Sun,
  Plane,
  EyeOff,
  HelpCircle,
  DollarSign,
  Mail,
  Camera,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { sendCompleted, sendOnTheWay } from "@/lib/customer-email";
import { sendCompletedSms, sendOnTheWaySms } from "@/lib/customer-sms";
import { openExternalUrl } from "@/lib/native-maps";
import type {
  Route,
  RouteStop,
  SkipReason,
} from "@/components/routes/types";

// =====================================================================
// route_stops join with properties — extends the base RouteStop shape
// with the four operator-relevant flags from the joined properties row.
// We don't redeclare RouteStop; we widen it locally.
// =====================================================================
interface PropertyFlags {
  gate_code: string | null;
  dog_warning: string | null;
  slope_warning: boolean | null;
  pet_safe_only: boolean | null;
  irrigation_present: boolean | null;
}
type RouteStopWithProperty = RouteStop & {
  properties: PropertyFlags | null;
};
type RouteWithStops = Route & {
  route_stops?: RouteStopWithProperty[];
};

const SKIP_REASONS: { value: SkipReason; label: string; Icon: typeof CloudRain }[] = [
  { value: "rain",            label: "Rain",          Icon: CloudRain },
  { value: "drought",         label: "Drought",       Icon: Sun },
  { value: "customer_travel", label: "Customer away", Icon: Plane },
  { value: "gate_locked",     label: "Gate locked",   Icon: Lock },
  { value: "no_show",         label: "No show",       Icon: EyeOff },
  { value: "other",           label: "Other",         Icon: HelpCircle },
];

// =====================================================================
// Main page
// =====================================================================
export default function RouteMode() {
  const { routeId } = useParams<{ routeId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);

  // Live-tick the elapsed clock once a minute. Stored in state so React
  // re-renders the "Elapsed" pill without us having to thread refs through.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // -----------------------------------------------------------------
  // Fetch the route + stops + joined property flags. One query covers
  // everything the operator screen needs.
  // -----------------------------------------------------------------
  const routeQuery = useQuery({
    queryKey: ["route-mode", routeId],
    enabled: !!routeId,
    queryFn: async (): Promise<RouteWithStops | null> => {
      if (!routeId) return null;
      const { data, error } = await (supabase as any)
        .from("routes")
        .select(
          `*,
           route_stops (
             *,
             properties (gate_code, dog_warning, slope_warning, pet_safe_only, irrigation_present)
           )`,
        )
        .eq("id", routeId)
        .single();
      if (error) throw error;
      return data as RouteWithStops;
    },
  });

  const route = routeQuery.data ?? null;

  // -----------------------------------------------------------------
  // Customer messaging preferences. user_settings holds the email
  // booleans (0005_email_log.sql) and the SMS booleans (0008_sms.sql).
  // We fetch once on mount.
  //
  // Defaults differ per channel: email defaults TRUE (opt-out) — the
  // column default in 0005 — and SMS defaults FALSE (opt-in) — the
  // column default in 0008. The fallbacks here mirror that.
  // -----------------------------------------------------------------
  const messagingPrefs = useQuery({
    queryKey: ["user-settings-messaging-routemode", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_settings")
        .select(
          [
            "send_on_the_way_email",
            "send_completed_email",
            "send_review_request_email",
            "send_on_the_way_sms",
            "send_completed_sms",
            "send_review_request_sms",
          ].join(", "),
        )
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as {
        send_on_the_way_email?: boolean | null;
        send_completed_email?: boolean | null;
        send_review_request_email?: boolean | null;
        send_on_the_way_sms?: boolean | null;
        send_completed_sms?: boolean | null;
        send_review_request_sms?: boolean | null;
      } | null;
    },
  });

  // Email default-true fallbacks — NULL on an older row is treated as ON.
  const emailToggles = useMemo(
    () => ({
      onTheWay: messagingPrefs.data?.send_on_the_way_email !== false,
      completed: messagingPrefs.data?.send_completed_email !== false,
      reviewRequest: messagingPrefs.data?.send_review_request_email !== false,
    }),
    [messagingPrefs.data],
  );

  // SMS default-FALSE fallbacks — NULL or missing means "not opted in yet".
  // We require an explicit `=== true` so older rows without the columns
  // don't accidentally start texting customers.
  const smsToggles = useMemo(
    () => ({
      onTheWay: messagingPrefs.data?.send_on_the_way_sms === true,
      completed: messagingPrefs.data?.send_completed_sms === true,
      reviewRequest: messagingPrefs.data?.send_review_request_sms === true,
    }),
    [messagingPrefs.data],
  );

  // Inline status banner for the "Send on the way" button on the active
  // stop card. { kind: 'success' | 'error', message } — auto-clears after
  // a few seconds so it doesn't linger between stops.
  const [onTheWayStatus, setOnTheWayStatus] = useState<
    null | { kind: "success" | "error" | "sending"; message: string }
  >(null);

  // -----------------------------------------------------------------
  // If we land on a 'planned' route, flip it to 'in_progress' once.
  // We guard with a ref so React StrictMode (which double-mounts in
  // dev) doesn't fire two updates.
  // -----------------------------------------------------------------
  const flippedRef = useRef(false);
  const flipToInProgressMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("routes")
        .update({ status: "in_progress", started_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });
  useEffect(() => {
    if (!route || flippedRef.current) return;
    if (route.status === "planned") {
      flippedRef.current = true;
      flipToInProgressMutation.mutate(route.id);
    }
    // We deliberately don't include the mutation in deps — it's stable per
    // queryClient and including it would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id, route?.status]);

  // -----------------------------------------------------------------
  // Stop math — sort by sort_order, find the active stop (lowest order
  // that isn't done/skipped), compute totals for the summary card.
  // -----------------------------------------------------------------
  const stops = useMemo<RouteStopWithProperty[]>(() => {
    const s = route?.route_stops ?? [];
    return [...s].sort((a, b) => a.sort_order - b.sort_order);
  }, [route]);

  const counts = useMemo(() => {
    const c = { done: 0, in_progress: 0, pending: 0, skipped: 0 };
    for (const s of stops) c[s.status]++;
    return c;
  }, [stops]);

  const activeStop = useMemo<RouteStopWithProperty | null>(() => {
    return stops.find((s) => s.status !== "done" && s.status !== "skipped") ?? null;
  }, [stops]);

  const activeIndex = activeStop
    ? stops.findIndex((s) => s.id === activeStop.id)
    : -1;

  const collectedCents = stops
    .filter((s) => s.status === "done")
    .reduce((sum, s) => sum + (s.fee_cents ?? 0), 0);

  const totalMiles = stops.reduce(
    (sum, s) => sum + Number(s.drive_miles_from_prev ?? 0),
    0,
  );

  const elapsedMinutes = useMemo(() => {
    if (!route?.started_at) return 0;
    const start = new Date(route.started_at).getTime();
    return Math.max(0, Math.round((Date.now() - start) / 60_000));
  }, [route?.started_at]);

  const allResolved =
    stops.length > 0 && counts.done + counts.skipped === stops.length;

  // -----------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["route-mode", routeId] });

  function scrollToTop() {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  const markDoneMutation = useMutation({
    mutationFn: async (stopId: string) => {
      const { error } = await (supabase as any)
        .from("route_stops")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", stopId);
      if (error) throw error;
      return stopId;
    },
    onSuccess: async (stopId) => {
      setSkipOpen(false);
      // Fire completed-channel side-effects AFTER the DB write succeeds.
      // Intentionally non-blocking on BOTH channels — we don't await
      // either so the operator can move to the next stop while Resend
      // and/or Twilio are still in-flight. Errors are logged but never
      // surfaced; they keep moving. If both email AND SMS toggles are
      // on, BOTH fire (duplex by design).
      const snapshot = stops.find((s) => s.id === stopId);
      if (snapshot) {
        if (emailToggles.completed) {
          void sendCompleted(snapshot).then((res) => {
            if (!res.ok) console.warn("sendCompleted failed:", res.error);
          });
        }
        if (smsToggles.completed) {
          void sendCompletedSms(snapshot).then((res) => {
            if (!res.ok) console.warn("sendCompletedSms failed:", res.error);
          });
        }
      }
      await qc.invalidateQueries({ queryKey: ["route-mode", routeId] });
      scrollToTop();
    },
  });

  const skipStopMutation = useMutation({
    mutationFn: async ({ stopId, reason }: { stopId: string; reason: SkipReason }) => {
      const { error } = await (supabase as any)
        .from("route_stops")
        .update({ status: "skipped", skip_reason: reason })
        .eq("id", stopId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setSkipOpen(false);
      await qc.invalidateQueries({ queryKey: ["route-mode", routeId] });
      scrollToTop();
    },
  });

  const pauseRouteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("routes")
        .update({ status: "planned" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      navigate("/routes");
    },
  });

  const completeRouteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Snapshot the aggregate fields so historical reports don't have to
      // re-aggregate against route_stops later.
      const totalMinutes = route?.started_at
        ? Math.max(
            0,
            Math.round((Date.now() - new Date(route.started_at).getTime()) / 60_000),
          )
        : 0;
      const { error } = await (supabase as any)
        .from("routes")
        .update({
          status: "complete",
          completed_at: new Date().toISOString(),
          total_stops: stops.length,
          completed_stops: counts.done,
          total_miles: Number(totalMiles.toFixed(1)),
          total_minutes: totalMinutes,
          total_collected_cents: collectedCents,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      navigate("/routes");
    },
  });

  // =================================================================
  // Render branches
  // =================================================================

  // --- Loading ---
  if (routeQuery.isLoading) {
    return (
      <FullBleedShell>
        <div className="min-h-screen grid place-items-center">
          <Loader2 className="h-8 w-8 text-bronze-400 animate-spin" />
        </div>
      </FullBleedShell>
    );
  }

  // --- Missing route / error ---
  if (!route) {
    return (
      <FullBleedShell>
        <div className="min-h-screen grid place-items-center px-6 text-center">
          <div>
            <div className="text-xs font-semibold tracking-[2px] uppercase text-bronze-400 mb-3">
              Route not found
            </div>
            <p className="text-sm text-white/70 mb-5">
              We couldn't load this route. It may have been deleted.
            </p>
            <Link
              to="/routes"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-bronze-500 text-white text-sm font-bold hover:bg-bronze-600 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Back to routes
            </Link>
          </div>
        </div>
      </FullBleedShell>
    );
  }

  // --- Already complete, or operator finished every stop in this session ---
  if (route.status === "complete" || allResolved) {
    return (
      <FullBleedShell>
        <SummaryView
          route={route}
          stops={stops}
          counts={counts}
          collectedCents={collectedCents}
          totalMiles={totalMiles}
          elapsedMinutes={elapsedMinutes}
          alreadyComplete={route.status === "complete"}
          onComplete={() => completeRouteMutation.mutate(route.id)}
          completing={completeRouteMutation.isPending}
        />
      </FullBleedShell>
    );
  }

  // --- Active-stop UI ---
  // We hand-pick an activeStop above. If none, that's the allResolved branch.
  if (!activeStop) {
    return (
      <FullBleedShell>
        <div className="min-h-screen grid place-items-center">
          <Loader2 className="h-8 w-8 text-bronze-400 animate-spin" />
        </div>
      </FullBleedShell>
    );
  }

  const stopNumber = activeIndex + 1;
  const flags = activeStop.properties;

  return (
    <FullBleedShell scrollRef={scrollRef}>
      <div className="relative z-10 flex min-h-screen flex-col">
        {/* ----- Top bar: back, stop counter, elapsed pill ----- */}
        <header className="px-5 pt-12 pb-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Link
              to="/routes"
              aria-label="Exit route mode"
              className="h-10 w-10 rounded-full bg-white/10 grid place-items-center hover:bg-white/15 transition-colors"
            >
              <ArrowLeft className="h-[18px] w-[18px] text-white" strokeWidth={1.8} />
            </Link>
            <div>
              <div className="text-[10px] font-semibold tracking-[0.8px] uppercase text-bronze-400">
                Stop
              </div>
              <div className="tp-num text-[15px] font-bold text-white">
                {stopNumber} of {stops.length}
              </div>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-[11.5px] font-semibold text-[#cfead8]">
            <Clock className="h-3 w-3 text-bronze-400" strokeWidth={2} />
            {counts.done} done · {counts.skipped} skipped
          </div>
        </header>

        {/* ----- Mini progress segments ----- */}
        <div className="flex gap-[3px] px-5 pt-3.5">
          {stops.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                "flex-1 h-[3px] rounded-[2px]",
                s.status === "done" && "bg-green-500",
                s.status === "skipped" && "bg-ink-300/40",
                s.status === "in_progress" && "bg-bronze-500",
                s.status === "pending" && i === activeIndex && "bg-bronze-500",
                s.status === "pending" && i !== activeIndex && "bg-white/10",
              )}
            />
          ))}
        </div>

        {/* ----- Body ----- */}
        <div className="px-6 pt-6 flex-1 flex flex-col">
          <div className="text-[12px] font-semibold tracking-[0.8px] uppercase text-bronze-400 mb-2">
            Current stop
          </div>
          <h1 className="tp-display text-[44px] font-bold leading-[1.05] tracking-[-0.02em] text-white">
            {activeStop.address_snapshot ?? "(no address)"}
          </h1>
          <div className="text-[15px] font-medium text-[#cfead8] mt-2">
            {activeStop.customer_name_snapshot ?? "—"}
          </div>

          {/* Service chips + fee */}
          <div className="flex flex-wrap gap-2 mt-4">
            {activeStop.services?.map((svc) => (
              <span
                key={svc}
                className="px-3.5 py-2 rounded-full bg-white/10 text-[13px] font-semibold text-white inline-flex items-center gap-1.5"
              >
                <Leaf className="h-3.5 w-3.5 text-bronze-400" strokeWidth={2} />
                {svc}
              </span>
            ))}
            {activeStop.fee_cents != null && (
              <span className="px-3.5 py-2 rounded-full bg-white/10 text-[13px] font-bold text-bronze-400 inline-flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" strokeWidth={2.2} />
                <span className="tp-num">
                  {Math.round(activeStop.fee_cents / 100)}
                </span>
              </span>
            )}
          </div>

          {/* Property flag pills */}
          {flags && <PropertyFlagPills flags={flags} />}

          <div className="flex-1" />

          {/* ----- Action buttons ----- */}
          {/* Navigate + On-the-way email — paired side-by-side so the
              "tell the customer we're inbound" tap is one thumb away
              from the maps handoff. Email is gated behind the operator's
              user_settings.send_on_the_way_email toggle. */}
          <div className="flex gap-2.5 mb-3.5 mt-6">
            <button
              type="button"
              onClick={() => openInMaps(activeStop.address_snapshot)}
              disabled={!activeStop.address_snapshot}
              className="flex-1 py-4 px-3.5 rounded-2xl bg-white/10 border border-white/15 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 hover:bg-white/15 transition-colors disabled:opacity-50"
            >
              <Navigation className="h-[18px] w-[18px]" strokeWidth={2} />
              Navigate
            </button>
            {(emailToggles.onTheWay || smsToggles.onTheWay) && (
              <button
                type="button"
                onClick={async () => {
                  // Fire both channels in parallel when both are on.
                  // Copy stays "On the way" — operator doesn't have to
                  // think about which channel, they just hit the button.
                  setOnTheWayStatus({ kind: "sending", message: "Sending…" });
                  const results = await Promise.all([
                    emailToggles.onTheWay
                      ? sendOnTheWay(activeStop)
                      : Promise.resolve({ ok: true } as const),
                    smsToggles.onTheWay
                      ? sendOnTheWaySms(activeStop)
                      : Promise.resolve({ ok: true } as const),
                  ]);
                  const [emailRes, smsRes] = results;
                  const failures = results.filter((r) => !r.ok);
                  if (failures.length === 0) {
                    // Success message reflects what actually fired.
                    const channels: string[] = [];
                    if (emailToggles.onTheWay) channels.push("email");
                    if (smsToggles.onTheWay) channels.push("SMS");
                    setOnTheWayStatus({
                      kind: "success",
                      message: `On-the-way ${channels.join(" + ")} sent`,
                    });
                  } else {
                    // Surface whichever error we hit — prefer the more
                    // actionable one (SMS deferred-for-quiet-hours, then
                    // any explicit error message).
                    const firstErr =
                      ("error" in smsRes && smsRes.error) ||
                      ("error" in emailRes && emailRes.error) ||
                      "Couldn't send";
                    setOnTheWayStatus({
                      kind: "error",
                      message: firstErr,
                    });
                  }
                  window.setTimeout(() => setOnTheWayStatus(null), 3500);
                }}
                disabled={onTheWayStatus?.kind === "sending"}
                className="flex-1 py-4 px-3.5 rounded-2xl bg-white/10 border border-white/15 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 hover:bg-white/15 transition-colors disabled:opacity-50"
              >
                {onTheWayStatus?.kind === "sending" ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" />
                ) : (
                  <Mail className="h-[18px] w-[18px]" strokeWidth={2} />
                )}
                On the way
              </button>
            )}
          </div>

          {/* Capture before/after for this stop — route_stop_id links the
              pair back to the stop for later reports. */}
          {activeStop.property_id && (
            <Link
              to={`/photos/new?property_id=${activeStop.property_id}&route_stop_id=${activeStop.id}`}
              className="mb-3 inline-flex items-center gap-1.5 self-start px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/85 text-[12.5px] font-semibold hover:bg-white/10 transition-colors"
            >
              <Camera className="h-3.5 w-3.5 text-bronze-400" strokeWidth={2} />
              + Capture photo
            </Link>
          )}

          {/* Inline feedback for the on-the-way email button. Auto-clears
              after a few seconds (set in the onClick handler above). */}
          {onTheWayStatus && onTheWayStatus.kind !== "sending" && (
            <div
              className={cn(
                "mb-3 px-3.5 py-2 rounded-xl text-[12.5px] font-semibold inline-flex items-center gap-2 self-start",
                onTheWayStatus.kind === "success"
                  ? "bg-green-600/20 text-green-300 border border-green-600/30"
                  : "bg-red-500/20 text-red-200 border border-red-500/30",
              )}
            >
              <Mail className="h-3.5 w-3.5" strokeWidth={2} />
              {onTheWayStatus.message}
            </div>
          )}

          {/* Mark done — the biggest tappable surface besides the address */}
          <button
            type="button"
            disabled={markDoneMutation.isPending}
            onClick={() => markDoneMutation.mutate(activeStop.id)}
            className="py-[22px] rounded-[20px] bg-bronze-500 text-white font-bold text-[20px] tracking-[0.2px] inline-flex items-center justify-center gap-2.5 shadow-bronze hover:bg-bronze-600 transition-colors disabled:opacity-70"
          >
            {markDoneMutation.isPending ? (
              <Loader2 className="h-[22px] w-[22px] animate-spin" />
            ) : (
              <Check className="h-[22px] w-[22px]" strokeWidth={2.4} />
            )}
            Mark done
          </button>

          {/* Skip / Pause */}
          <div className="flex gap-2.5 mt-3">
            <button
              type="button"
              onClick={() => setSkipOpen((v) => !v)}
              className={cn(
                "flex-1 py-3 rounded-2xl border text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors",
                skipOpen
                  ? "bg-white/15 border-white/25 text-white"
                  : "bg-white/5 border-white/15 text-white/85 hover:bg-white/10",
              )}
            >
              <SkipForward className="h-4 w-4" strokeWidth={2} />
              Skip stop
            </button>
            <button
              type="button"
              disabled={pauseRouteMutation.isPending}
              onClick={() => pauseRouteMutation.mutate(route.id)}
              className="flex-1 py-3 rounded-2xl bg-white/5 border border-white/15 text-white/85 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-white/10 transition-colors disabled:opacity-60"
            >
              <Pause className="h-4 w-4" strokeWidth={2} />
              Pause route
            </button>
          </div>

          {/* Inline skip-reason picker */}
          {skipOpen && (
            <div className="mt-3 rounded-2xl border border-white/15 bg-black/30 p-3.5">
              <div className="text-[12px] font-semibold text-white/85 mb-2 flex items-center justify-between">
                <span>Why are we skipping this stop?</span>
                <button
                  type="button"
                  onClick={() => setSkipOpen(false)}
                  className="text-[11px] font-medium text-white/60 hover:text-white"
                >
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {SKIP_REASONS.map(({ value, label, Icon }) => {
                  const isPending =
                    skipStopMutation.isPending &&
                    skipStopMutation.variables?.reason === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={skipStopMutation.isPending}
                      onClick={() =>
                        skipStopMutation.mutate({ stopId: activeStop.id, reason: value })
                      }
                      className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[11px] font-semibold transition-colors disabled:opacity-60"
                    >
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Icon className="h-4 w-4" strokeWidth={1.8} />
                      )}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="pt-4 pb-8" />
        </div>
      </div>
    </FullBleedShell>
  );
}

// =====================================================================
// Property-flag pills — only render the ones that are truthy.
// =====================================================================
function PropertyFlagPills({ flags }: { flags: PropertyFlags }) {
  const items: { key: string; node: React.ReactNode; tone: "neutral" | "warn" }[] = [];

  if (flags.gate_code) {
    items.push({
      key: "gate",
      tone: "neutral",
      node: (
        <>
          <Lock className="h-3.5 w-3.5 text-bronze-400" strokeWidth={2} />
          <span>
            Gate <b className="tp-num font-bold">{flags.gate_code}</b>
          </span>
        </>
      ),
    });
  }
  if (flags.dog_warning) {
    items.push({
      key: "dog",
      tone: "warn",
      node: (
        <>
          <PawPrint className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="truncate max-w-[160px]">{flags.dog_warning}</span>
        </>
      ),
    });
  }
  if (flags.slope_warning) {
    items.push({
      key: "slope",
      tone: "warn",
      node: (
        <>
          <Mountain className="h-3.5 w-3.5" strokeWidth={2} />
          <span>Slope</span>
        </>
      ),
    });
  }
  if (flags.pet_safe_only) {
    items.push({
      key: "pet-safe",
      tone: "warn",
      node: (
        <>
          <Leaf className="h-3.5 w-3.5" strokeWidth={2} />
          <span>Pet-safe chem only</span>
        </>
      ),
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-3.5">
      {items.map(({ key, node, tone }) => (
        <span
          key={key}
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[12px] font-semibold",
            tone === "warn"
              ? "bg-[hsl(36_80%_30%)] text-white"
              : "bg-white/10 text-white",
          )}
        >
          {node}
        </span>
      ))}
    </div>
  );
}

// =====================================================================
// End-of-route summary view
// =====================================================================
interface SummaryProps {
  route: RouteWithStops;
  stops: RouteStopWithProperty[];
  counts: { done: number; in_progress: number; pending: number; skipped: number };
  collectedCents: number;
  totalMiles: number;
  elapsedMinutes: number;
  alreadyComplete: boolean;
  onComplete: () => void;
  completing: boolean;
}
function SummaryView({
  route,
  stops,
  counts,
  collectedCents,
  totalMiles,
  elapsedMinutes,
  alreadyComplete,
  onComplete,
  completing,
}: SummaryProps) {
  // When the route was previously completed (status='complete'), use the
  // snapshotted fields if present — they're the source of truth after the
  // route closes. Falls back to live computed values otherwise.
  const displayedDone = alreadyComplete
    ? route.completed_stops ?? counts.done
    : counts.done;
  const displayedTotal = alreadyComplete
    ? route.total_stops ?? stops.length
    : stops.length;
  const displayedCollected = alreadyComplete
    ? route.total_collected_cents ?? collectedCents
    : collectedCents;
  const displayedMiles = alreadyComplete
    ? Number(route.total_miles ?? totalMiles)
    : totalMiles;
  const displayedMinutes = alreadyComplete
    ? route.total_minutes ?? elapsedMinutes
    : elapsedMinutes;

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      <header className="px-5 pt-12 pb-1 flex items-center justify-between">
        <Link
          to="/routes"
          aria-label="Exit route mode"
          className="h-10 w-10 rounded-full bg-white/10 grid place-items-center hover:bg-white/15 transition-colors"
        >
          <ArrowLeft className="h-[18px] w-[18px] text-white" strokeWidth={1.8} />
        </Link>
        <div className="text-[10px] font-semibold tracking-[0.8px] uppercase text-bronze-400">
          {alreadyComplete ? "Route closed" : "Route wrapped"}
        </div>
        <div className="w-10" />
      </header>

      <div className="flex-1 flex flex-col px-6 pt-10 pb-8">
        <div className="text-[12px] font-semibold tracking-[0.8px] uppercase text-bronze-400 mb-2">
          Nice work
        </div>
        <h1 className="tp-display text-[40px] font-bold leading-[1.05] tracking-[-0.02em] text-white">
          {displayedDone === displayedTotal
            ? "All stops handled"
            : `${displayedDone} of ${displayedTotal} done`}
        </h1>
        <div className="text-[15px] font-medium text-[#cfead8] mt-2">
          {counts.skipped > 0
            ? `${counts.skipped} skipped this run`
            : "Clean run — nothing skipped"}
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-3 mt-7">
          <SummaryStat
            icon={<Check className="h-4 w-4" strokeWidth={2.2} />}
            label="Stops done"
            value={String(displayedDone)}
          />
          <SummaryStat
            icon={<DollarSign className="h-4 w-4" strokeWidth={2.2} />}
            label="Collected"
            value={`$${Math.round(displayedCollected / 100)}`}
          />
          <SummaryStat
            icon={<Truck className="h-4 w-4" strokeWidth={2.2} />}
            label="Drive miles"
            value={Number(displayedMiles).toFixed(1)}
          />
          <SummaryStat
            icon={<Clock className="h-4 w-4" strokeWidth={2.2} />}
            label="Elapsed"
            value={formatDuration(displayedMinutes)}
          />
        </div>

        {counts.skipped > 0 && (
          <div className="mt-5 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 text-[12.5px] font-semibold text-white/85 self-start">
            <SkipForward className="h-3.5 w-3.5 text-bronze-400" strokeWidth={2} />
            {counts.skipped} stop{counts.skipped === 1 ? "" : "s"} skipped
          </div>
        )}

        <div className="flex-1" />

        {alreadyComplete ? (
          <Link
            to="/routes"
            className="py-[22px] rounded-[20px] bg-bronze-500 text-white font-bold text-[18px] tracking-[0.2px] inline-flex items-center justify-center gap-2.5 shadow-bronze hover:bg-bronze-600 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
            Back to routes
          </Link>
        ) : (
          <button
            type="button"
            disabled={completing}
            onClick={onComplete}
            className="py-[22px] rounded-[20px] bg-bronze-500 text-white font-bold text-[18px] tracking-[0.2px] inline-flex items-center justify-center gap-2.5 shadow-bronze hover:bg-bronze-600 transition-colors disabled:opacity-70"
          >
            {completing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Check className="h-5 w-5" strokeWidth={2.4} />
            )}
            {completing ? "Closing…" : "Complete route"}
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-white/8 border border-white/10 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-bronze-400 mb-1.5">
        {icon}
        <div className="text-[10.5px] font-semibold tracking-[0.6px] uppercase">
          {label}
        </div>
      </div>
      <div className="tp-display tp-num text-[26px] font-bold leading-none text-white">
        {value}
      </div>
    </div>
  );
}

// =====================================================================
// Full-bleed shell — dark deep-green gradient + subtle 45° hatch texture,
// matches the mockup. Holds the scrollable area; child gets full height.
// =====================================================================
function FullBleedShell({
  children,
  scrollRef,
}: {
  children: React.ReactNode;
  scrollRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={scrollRef}
      className="min-h-screen w-full bg-gradient-hero-deep text-white relative overflow-y-auto"
    >
      {/* Subtle hatch texture — taken from mockup, kept very low opacity so
          numerals stay legible in direct sunlight (which is the use case). */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 18px)",
        }}
      />
      {children}
    </div>
  );
}

// =====================================================================
// Helpers
// =====================================================================

// Default to Google Maps directions URL — spec lets us pick one. iOS Safari
// will still open the Apple-Maps URL handler if installed; using Google's
// universal URL keeps Android + web in the same path.
//
// On native we route through `openExternalUrl`, which calls
// `@capacitor/app`'s `App.openUrl({ url })` so the OS hands the URL to
// the user's actual Maps app instead of opening it inside a Capacitor
// in-app browser. See src/lib/native-maps.ts.
function openInMaps(address: string | null) {
  if (!address) return;
  const encoded = encodeURIComponent(address);
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
  void openExternalUrl(url);
}

function formatDuration(minutes: number): string {
  if (!minutes || minutes < 1) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
