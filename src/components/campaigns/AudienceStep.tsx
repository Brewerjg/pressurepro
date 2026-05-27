import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// Step 2 of the wizard — operator picks who to blast.
//
// Filter shapes mirror what the send-campaign edge fn understands (see
// supabase/functions/send-campaign/index.ts resolveAudience). The dry-run
// recipient count we show here uses the SAME queries (in count-mode) so
// what the operator sees is what they get.
//
// `test_self` is the "send to my own email/phone for QA" option — it
// short-circuits the audience resolution and just targets the operator.

export type AudiencePreset =
  | "all"
  | "with_active_plan"
  | "without_active_plan"
  | "inactive_days"
  | "test_self";

export interface AudienceFilter {
  preset: AudiencePreset;
  days?: number;
}

interface Props {
  filter: AudienceFilter;
  onChange: (next: AudienceFilter) => void;
}

const PRESETS: {
  key: AudiencePreset;
  label: string;
  blurb: string;
}[] = [
  {
    key: "all",
    label: "All customers",
    blurb: "Every customer in your address book.",
  },
  {
    key: "with_active_plan",
    label: "Customers with an active plan",
    blurb: "Plan-enrolled folks — best for service-update news.",
  },
  {
    key: "without_active_plan",
    label: "Customers WITHOUT an active plan",
    blurb: "Lapsed list — highest conversion for restart / aeration pitches.",
  },
  {
    key: "inactive_days",
    label: "Haven't been visited in…",
    blurb: "Find customers gone quiet. Tune the days threshold below.",
  },
  {
    key: "test_self",
    label: "Test send to me only",
    blurb: "Send the rendered message to your own email/phone first.",
  },
];

export default function AudienceStep({ filter, onChange }: Props) {
  const { user } = useAuth();

  // Local state for the days slider — flushed to filter on change.
  const [daysInput, setDaysInput] = useState<number>(filter.days ?? 60);

  useEffect(() => {
    if (filter.preset === "inactive_days") {
      setDaysInput(filter.days ?? 60);
    }
  }, [filter.preset, filter.days]);

  // -----------------------------------------------------------------
  // Live recipient count — computed server-side via head/count queries
  // so we don't pull customer rows into the browser. Each preset has a
  // dedicated count query that the edge fn would also use at send time.
  // -----------------------------------------------------------------
  const { data: count, isLoading } = useQuery({
    queryKey: ["campaign-audience-count", user?.id, filter.preset, filter.days],
    enabled: !!user?.id,
    queryFn: async () => {
      if (filter.preset === "test_self") return 1;

      if (filter.preset === "all") {
        const { count: c, error } = await supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id);
        if (error) throw error;
        return c ?? 0;
      }

      if (filter.preset === "with_active_plan") {
        // Distinct customer_ids that have at least one active plan.
        const { data, error } = await supabase
          .from("maintenance_plans")
          .select("customer_id")
          .eq("user_id", user!.id)
          .eq("status", "active")
          .not("customer_id", "is", null);
        if (error) throw error;
        const ids = new Set(
          ((data ?? []) as { customer_id: string | null }[])
            .map((r) => r.customer_id)
            .filter((x): x is string => !!x),
        );
        return ids.size;
      }

      if (filter.preset === "without_active_plan") {
        const [{ count: totalCount }, { data: planRows }] = await Promise.all([
          supabase
            .from("customers")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user!.id),
          supabase
            .from("maintenance_plans")
            .select("customer_id")
            .eq("user_id", user!.id)
            .eq("status", "active")
            .not("customer_id", "is", null),
        ]);
        const total = totalCount ?? 0;
        const withPlan = new Set(
          ((planRows ?? []) as { customer_id: string | null }[])
            .map((r) => r.customer_id)
            .filter((x): x is string => !!x),
        );
        return Math.max(0, total - withPlan.size);
      }

      if (filter.preset === "inactive_days") {
        const days = Math.max(1, Math.min(365, filter.days ?? 60));
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
          .toISOString();
        const [{ count: totalCount }, { data: recentRows }] = await Promise.all([
          supabase
            .from("customers")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user!.id),
          supabase
            .from("route_stops")
            .select("customer_id")
            .eq("user_id", user!.id)
            .eq("status", "done")
            .gte("completed_at", cutoff)
            .not("customer_id", "is", null),
        ]);
        const total = totalCount ?? 0;
        const recent = new Set(
          ((recentRows ?? []) as { customer_id: string | null }[])
            .map((r) => r.customer_id)
            .filter((x): x is string => !!x),
        );
        return Math.max(0, total - recent.size);
      }

      return 0;
    },
  });

  return (
    <div className="space-y-4">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">
        2. Pick the audience
      </div>

      <div className="space-y-2">
        {PRESETS.map((p) => {
          const active = filter.preset === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange({ preset: p.key, days: p.key === "inactive_days" ? daysInput : undefined })}
              className={cn(
                "tp-card w-full text-left p-3 transition-all flex items-start gap-3",
                active ? "ring-2 ring-green-700 bg-green-50" : "hover:bg-ink-100/30",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 h-4 w-4 rounded-full border-2 shrink-0",
                  active ? "border-green-700 bg-green-700" : "border-ink-300",
                )}
              />
              <div className="min-w-0">
                <div className="font-semibold text-[13.5px] text-ink-900">
                  {p.label}
                </div>
                <div className="text-[11.5px] text-ink-500 leading-snug mt-0.5">
                  {p.blurb}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Days threshold — only meaningful for inactive_days preset */}
      {filter.preset === "inactive_days" && (
        <div className="tp-card p-3 bg-ink-100/30">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Days since last visit
          </label>
          <div className="flex items-center gap-3 mt-2">
            <input
              type="range"
              min={7}
              max={180}
              step={1}
              value={daysInput}
              onChange={(e) => setDaysInput(Number(e.target.value))}
              onMouseUp={() => onChange({ preset: "inactive_days", days: daysInput })}
              onTouchEnd={() => onChange({ preset: "inactive_days", days: daysInput })}
              className="flex-1"
            />
            <span className="tp-num font-bold text-[14px] text-ink-900 w-14 text-right">
              {daysInput}d
            </span>
          </div>
        </div>
      )}

      {/* Live count card */}
      <div className="tp-card p-3 flex items-center gap-3">
        <Users className="h-5 w-5 text-green-700 shrink-0" strokeWidth={2} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-ink-500 font-semibold">
            Recipients
          </div>
          <div className="tp-num font-bold text-[18px] text-ink-900">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin inline" />
            ) : (
              (count ?? 0).toLocaleString()
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
