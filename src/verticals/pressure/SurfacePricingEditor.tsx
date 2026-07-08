import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Droplets, Zap, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { APP_ID } from "@/lib/app-context";
import { vertical } from "@/vertical";
import type { Database } from "@/integrations/supabase/types";

type SurfacePricingRow = Database["public"]["Tables"]["surface_pricing"]["Row"];
type JobMode = "soft" | "power";
type SurfaceKey = "concrete" | "siding" | "roof" | "deck" | "fence" | "driveway" | "house";

const SURFACE_META: Record<SurfaceKey, { label: string; emoji: string }> = {
  house: { label: "House Wash", emoji: "🏠" },
  siding: { label: "Siding", emoji: "🧱" },
  roof: { label: "Roof", emoji: "🛖" },
  driveway: { label: "Driveway", emoji: "🛣️" },
  concrete: { label: "Concrete", emoji: "🧊" },
  deck: { label: "Deck", emoji: "🪵" },
  fence: { label: "Fence", emoji: "🚧" },
};
const SURFACE_ORDER: SurfaceKey[] = ["house", "roof", "siding", "driveway", "concrete", "deck", "fence"];

function ModeToggle({ value, onChange }: { value: JobMode; onChange: (m: JobMode) => void }) {
  const isSoft = value === "soft";
  const btn = (active: boolean) =>
    `relative z-10 flex items-center gap-1 px-3 py-1 font-semibold rounded-full text-[12px] ${
      active ? "text-brand-800" : "text-neutral-500"
    }`;
  return (
    <div className="relative inline-flex items-center rounded-full bg-neutral-100 p-1 select-none">
      <span
        aria-hidden
        className={`absolute top-1 bottom-1 w-1/2 rounded-full bg-card shadow-card transition-transform duration-200 ${
          isSoft ? "translate-x-0" : "translate-x-full"
        }`}
      />
      <button type="button" onClick={() => onChange("soft")} className={btn(isSoft)}>
        <Droplets className="h-3.5 w-3.5" /> Soft
      </button>
      <button type="button" onClick={() => onChange("power")} className={btn(!isSoft)}>
        <Zap className="h-3.5 w-3.5" /> Power
      </button>
    </div>
  );
}

export default function SurfacePricingEditor() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeMode, setActiveMode] = useState<JobMode>("soft");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["surface_pricing", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surface_pricing")
        .select("*")
        .eq("user_id", user!.id)
        .order("surface_type");
      if (error) throw error;
      return (data ?? []) as SurfacePricingRow[];
    },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { default_rate?: number; min_charge?: number } }) => {
      const { error } = await supabase.from("surface_pricing").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["surface_pricing", user?.id] });
      qc.invalidateQueries({ queryKey: ["catalog", "service", user?.id] });
    },
  });

  const seedMut = useMutation({
    mutationFn: async () => {
      if (!user) return;
      await vertical.catalog.seed(user.id, APP_ID);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["surface_pricing", user?.id] }),
  });

  if (isLoading) {
    return (
      <div className="text-sm text-neutral-500 py-2 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="tp-card p-4 text-center space-y-3">
        <p className="text-sm text-neutral-500">{vertical.catalog.copy.emptyStateHint}</p>
        <button
          type="button"
          onClick={() => seedMut.mutate()}
          disabled={seedMut.isPending}
          className="h-10 px-4 rounded-xl bg-brand-800 text-white font-semibold text-sm disabled:opacity-60"
        >
          {seedMut.isPending ? "Seeding…" : vertical.catalog.copy.seedButtonLabel}
        </button>
      </div>
    );
  }

  const rowFor = (s: SurfaceKey): SurfacePricingRow | undefined =>
    rows.find((r) => r.surface_type === s && r.mode === activeMode) ??
    rows.find((r) => r.surface_type === s);

  return (
    <div className="tp-card p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold">Pricing matrix</h3>
        <ModeToggle value={activeMode} onChange={setActiveMode} />
      </div>
      <p className="text-xs text-neutral-500 mb-3">{vertical.catalog.copy.editorDescription}</p>
      <ul className="space-y-3">
        {SURFACE_ORDER.map((s) => {
          const row = rowFor(s);
          if (!row) return null;
          const unitLabel = row.unit === "linear_ft" ? "lin ft" : row.unit === "flat" ? "flat" : "sqft";
          return (
            <li key={s} className="flex items-center gap-2">
              <span className="text-xl">{SURFACE_META[s].emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate">{SURFACE_META[s].label}</span>
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">${"/"}{unitLabel}</span>
              </span>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">$</span>
                <input
                  key={`${row.id}-rate`}
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  defaultValue={row.default_rate}
                  onBlur={(e) => updateMut.mutate({ id: row.id, patch: { default_rate: Number(e.target.value) || 0 } })}
                  className="tp-input w-20 pl-5"
                />
              </div>
              <div className="relative">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-neutral-500 text-[9px] font-bold">MIN</span>
                <input
                  key={`${row.id}-min`}
                  type="number"
                  step="1"
                  inputMode="numeric"
                  defaultValue={row.min_charge}
                  onBlur={(e) => updateMut.mutate({ id: row.id, patch: { min_charge: Number(e.target.value) || 0 } })}
                  className="tp-input w-20 pl-9"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
