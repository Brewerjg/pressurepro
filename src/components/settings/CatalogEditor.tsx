import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  Edit3,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { APP_ID } from "@/lib/app-context";
import { vertical } from "@/vertical";
import { seedDefaultCatalog } from "@/components/onboarding/seedCatalog";

// Catalog editor — edits public.catalog_items rows where kind='service' and
// archived=false for the current user. Lawn-care services are almost always
// flat-fee per visit (a $45 weekly mow, $85 fert step), so we default `unit`
// to 'flat' on insert and don't expose the sqft/linear_ft surface-pricing
// dimension that PressurePro shows. Operators who want per-sqft can still
// override unit via the per-row edit form.
//
// PressurePro also exposes kind='chemical' rows (SH, surfactant) — those are
// not in TurfPro's seed and not in lawn-care UX, so we hide that tab. The DB
// column still allows chemical rows; they just don't show in this UI.

type CatalogRow = Database["public"]["Tables"]["catalog_items"]["Row"];
type CatalogInsert = Database["public"]["Tables"]["catalog_items"]["Insert"];
type PricingUnit = Database["public"]["Enums"]["pricing_unit"];

const UNIT_LABEL: Record<PricingUnit, string> = {
  flat: "flat",
  sqft: "/sqft",
  linear_ft: "/lin ft",
};

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);

export default function CatalogEditor() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const queryKey = ["catalog_items", user?.id];

  const { data: items, isLoading } = useQuery({
    queryKey,
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_items")
        .select("*")
        .eq("user_id", user!.id)
        .eq("app", APP_ID)
        .eq("kind", vertical.catalog.serviceKind)
        .eq("archived", false)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CatalogRow[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (input: NewItemInput) => {
      if (!user) throw new Error("Not signed in");
      const nextSort =
        (items && items.length > 0
          ? Math.max(...items.map((i) => i.sort_order))
          : 0) + 10;
      // `app` field added in migration 0022; generated types may not include
      // it yet — widen and cast.
      const payload = {
        user_id: user.id,
        kind: vertical.catalog.serviceKind,
        name: input.name,
        unit: input.unit,
        default_rate: input.default_rate,
        min_charge: input.min_charge,
        sort_order: nextSort,
        app: APP_ID,
      } as unknown as CatalogInsert;
      const { error } = await supabase.from("catalog_items").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setAdding(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<
        Pick<
          CatalogRow,
          "name" | "default_rate" | "min_charge" | "unit" | "sort_order"
        >
      >;
    }) => {
      const { error } = await supabase
        .from("catalog_items")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEditingId(null);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("catalog_items")
        .update({ archived: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Re-order: swap sort_order with neighbour.
  const reorder = (id: string, direction: -1 | 1) => {
    if (!items) return;
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const a = items[idx];
    const b = items[swapIdx];
    updateMutation.mutate({ id: a.id, patch: { sort_order: b.sort_order } });
    updateMutation.mutate({ id: b.id, patch: { sort_order: a.sort_order } });
  };

  const seedMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      await seedDefaultCatalog(user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const isEmpty = !!items && items.length === 0;

  return (
    <div className="tp-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-neutral-500">
          {vertical.catalog.copy.editorDescription}
        </p>
        <button
          type="button"
          onClick={() => {
            setAdding((a) => !a);
            setEditingId(null);
          }}
          className="text-[12px] font-semibold bg-brand-800 text-white rounded-full px-3 py-1.5 flex items-center gap-1 hover:bg-brand-900 transition-colors shrink-0"
        >
          <Plus className="h-3 w-3" /> {adding ? "Close" : "New"}
        </button>
      </div>

      {adding && (
        <NewItemForm
          defaultUnit={vertical.catalog.defaultUnit}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => addMutation.mutate(input)}
          submitting={addMutation.isPending}
          error={
            addMutation.isError
              ? addMutation.error instanceof Error
                ? addMutation.error.message
                : "Couldn't add"
              : null
          }
        />
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading catalog…
        </div>
      ) : isEmpty ? (
        <div className="rounded-xl border border-dashed border-neutral-200 p-4 text-center">
          <p className="text-sm font-semibold text-neutral-900">
            No services in your catalog yet.
          </p>
          <p className="text-[11px] text-neutral-500 mt-1 max-w-[280px] mx-auto">
            {vertical.catalog.copy.emptyStateHint}
          </p>
          <button
            type="button"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            className="inline-flex items-center gap-1.5 mt-3 px-3.5 py-2 rounded-full bg-accent-500 text-white text-[13px] font-semibold shadow-accent hover:bg-accent-600 transition-colors disabled:opacity-60"
          >
            {seedMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
            {vertical.catalog.copy.seedButtonLabel}
          </button>
          {seedMutation.isError && (
            <p className="text-[11px] font-semibold text-destructive flex items-center justify-center gap-1 mt-2">
              <AlertCircle className="h-3 w-3" />
              {seedMutation.error instanceof Error
                ? seedMutation.error.message
                : "Couldn't seed"}
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {items!.map((item, idx) => (
            <li key={item.id}>
              {editingId === item.id ? (
                <EditItemForm
                  item={item}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(patch) =>
                    updateMutation.mutate({ id: item.id, patch })
                  }
                  submitting={updateMutation.isPending}
                />
              ) : (
                <CatalogRow
                  item={item}
                  isFirst={idx === 0}
                  isLast={idx === items!.length - 1}
                  onEdit={() => {
                    setEditingId(item.id);
                    setAdding(false);
                  }}
                  onArchive={() => {
                    if (!window.confirm(`Archive "${item.name}"?`)) return;
                    archiveMutation.mutate(item.id);
                  }}
                  onMove={(dir) => reorder(item.id, dir)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CatalogRow({
  item,
  isFirst,
  isLast,
  onEdit,
  onArchive,
  onMove,
}: {
  item: CatalogRow;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const unit = item.unit ?? "flat";
  return (
    <div className="flex items-center gap-2 rounded-xl border border-neutral-100 p-2.5">
      <div className="flex flex-col gap-px shrink-0">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={isFirst}
          className="h-4 w-4 grid place-items-center text-neutral-500 hover:text-neutral-900 disabled:opacity-30"
          aria-label="Move up"
        >
          <ChevronDown className="h-3 w-3 rotate-180" strokeWidth={2.4} />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={isLast}
          className="h-4 w-4 grid place-items-center text-neutral-500 hover:text-neutral-900 disabled:opacity-30"
          aria-label="Move down"
        >
          <ChevronDown className="h-3 w-3" strokeWidth={2.4} />
        </button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-neutral-900 truncate">
          {item.name}
        </div>
        <div className="text-[10.5px] uppercase tracking-wider text-neutral-500 tp-num">
          {fmtUSD(item.default_rate)} {UNIT_LABEL[unit]}
          {item.min_charge > 0 ? ` · min ${fmtUSD(item.min_charge)}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="h-8 w-8 rounded-lg text-neutral-700 hover:bg-neutral-100 flex items-center justify-center"
        aria-label={`Edit ${item.name}`}
      >
        <Edit3 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onArchive}
        className="h-8 w-8 rounded-lg text-destructive hover:bg-[hsl(var(--destructive-bg))] flex items-center justify-center"
        aria-label={`Archive ${item.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

type NewItemInput = {
  name: string;
  unit: PricingUnit;
  default_rate: number;
  min_charge: number;
};

function NewItemForm({
  defaultUnit,
  onCancel,
  onSubmit,
  submitting,
  error,
}: {
  defaultUnit: PricingUnit;
  onCancel: () => void;
  onSubmit: (input: NewItemInput) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<PricingUnit>(defaultUnit);
  const [rate, setRate] = useState(0);
  const [minCharge, setMinCharge] = useState(0);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) {
      setLocalErr("Name is required");
      return;
    }
    setLocalErr(null);
    onSubmit({
      name: name.trim(),
      unit,
      default_rate: rate,
      min_charge: minCharge,
    });
  };

  return (
    <div className="rounded-xl border border-brand-700/30 bg-brand-50 p-3 space-y-2">
      <input
        autoFocus
        placeholder="Weekly mow"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={formInput}
      />
      <div className="grid grid-cols-3 gap-2">
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as PricingUnit)}
          className={formInput}
        >
          <option value="flat">flat</option>
          <option value="sqft">$ / sqft</option>
          <option value="linear_ft">$ / lin ft</option>
        </select>
        <input
          type="number"
          step="0.01"
          placeholder="Rate"
          value={rate || ""}
          onChange={(e) => setRate(Number(e.target.value) || 0)}
          className={formInput}
          inputMode="decimal"
        />
        <input
          type="number"
          step="1"
          placeholder="Min $"
          value={minCharge || ""}
          onChange={(e) => setMinCharge(Number(e.target.value) || 0)}
          className={formInput}
          inputMode="numeric"
        />
      </div>
      {(localErr || error) && (
        <p className="text-[11px] font-semibold text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {localErr || error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-neutral-100 text-neutral-700 rounded-full py-2 text-xs font-bold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className={cn(
            "flex-1 bg-accent-500 text-white rounded-full py-2 text-xs font-bold flex items-center justify-center gap-1.5 shadow-accent hover:bg-accent-600 transition-colors disabled:opacity-60",
          )}
        >
          {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}

function EditItemForm({
  item,
  onCancel,
  onSubmit,
  submitting,
}: {
  item: CatalogRow;
  onCancel: () => void;
  onSubmit: (
    patch: Partial<
      Pick<CatalogRow, "name" | "default_rate" | "min_charge" | "unit">
    >,
  ) => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(item.name);
  const [unit, setUnit] = useState<PricingUnit>(item.unit ?? "flat");
  const [rate, setRate] = useState(item.default_rate);
  const [minCharge, setMinCharge] = useState(item.min_charge);

  const submit = () => {
    onSubmit({
      name: name.trim() || item.name,
      unit,
      default_rate: rate,
      min_charge: minCharge,
    });
  };

  return (
    <div className="rounded-xl border border-brand-700/30 bg-brand-50 p-3 space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={formInput}
      />
      <div className="grid grid-cols-3 gap-2">
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as PricingUnit)}
          className={formInput}
        >
          <option value="flat">flat</option>
          <option value="sqft">$ / sqft</option>
          <option value="linear_ft">$ / lin ft</option>
        </select>
        <input
          type="number"
          step="0.01"
          value={rate}
          onChange={(e) => setRate(Number(e.target.value) || 0)}
          className={formInput}
          inputMode="decimal"
        />
        <input
          type="number"
          step="1"
          value={minCharge}
          onChange={(e) => setMinCharge(Number(e.target.value) || 0)}
          className={formInput}
          inputMode="numeric"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-neutral-100 text-neutral-700 rounded-full py-2 text-xs font-bold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="flex-1 bg-brand-800 text-white rounded-full py-2 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-brand-900 transition-colors disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          Save changes
        </button>
      </div>
    </div>
  );
}

const formInput =
  "w-full h-9 rounded-lg border border-neutral-200 bg-card px-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-700/30 focus:border-brand-700";
