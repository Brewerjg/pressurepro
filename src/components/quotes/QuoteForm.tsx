import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Save, Send, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import type { QuoteLine } from "./types";
import { defaultExpiresAt, lineTotal, quoteTotal } from "./types";
import { APP_ID } from "@/lib/app-context";

// Shared editor used by NewQuote (create) and QuoteDetail (edit). The form
// shape is identical — only the submit handler and "Cancel" target differ.
// Line-item math is per-visit flat fees from the service catalog (TurfPro's
// world is mostly one-off recurring-flavored work), unlike PressurePro which
// is sqft × rate × surface multiplier.

type Customer = Database["public"]["Tables"]["customers"]["Row"];
type Property = Database["public"]["Tables"]["properties"]["Row"];
type CatalogItem = Database["public"]["Tables"]["catalog_items"]["Row"];

export interface QuoteFormValues {
  customer_id: string;
  property_id: string;
  customer_name: string;
  phone: string;
  customer_email: string;
  address: string;
  lines: QuoteLine[];
  notes: string;
  deposit_percent: number; // 0..100 — converted to deposit_amount on submit
  expires_at: string;      // YYYY-MM-DD (empty string = no expiry)
}

export interface QuoteFormProps {
  initial?: Partial<QuoteFormValues>;
  // When the URL contains ?customer=<id> we want to pre-fill and auto-pick
  // the only-property if there's exactly one. NewQuote passes this through.
  preselectCustomerId?: string | null;
  busy?: boolean;
  submitMode: "create" | "edit";
  onCancel: () => void;
  onSubmit: (values: QuoteFormValues, action: "draft" | "send" | "save") => void;
  error?: string | null;
}

export default function QuoteForm({
  initial,
  preselectCustomerId,
  busy,
  submitMode,
  onCancel,
  onSubmit,
  error,
}: QuoteFormProps) {
  const { user } = useAuth();

  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [propertyId, setPropertyId] = useState(initial?.property_id ?? "");
  const [lines, setLines] = useState<QuoteLine[]>(initial?.lines ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [depositPercent, setDepositPercent] = useState<number>(
    initial?.deposit_percent ?? 0,
  );
  const [expiresAt, setExpiresAt] = useState<string>(
    initial?.expires_at ?? (submitMode === "create" ? defaultExpiresAt() : ""),
  );

  // Customers
  const { data: customers } = useQuery({
    queryKey: ["customers", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
    enabled: !!user,
  });

  // Properties for selected customer
  const { data: properties } = useQuery({
    queryKey: ["properties", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("customer_id", customerId)
        .order("address");
      if (error) throw error;
      return (data ?? []) as Property[];
    },
    enabled: !!customerId,
  });

  // Catalog (services only)
  const { data: catalog } = useQuery({
    queryKey: ["catalog", "service", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_items")
        .select("*")
        .eq("app", APP_ID)
        .eq("kind", "service")
        .eq("archived", false)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as CatalogItem[];
    },
    enabled: !!user,
  });

  // Apply the customer pre-select once data loads. We keep this defensive —
  // if `initial.customer_id` is already populated, leave it alone.
  useEffect(() => {
    if (preselectCustomerId && !customerId) {
      setCustomerId(preselectCustomerId);
    }
  }, [preselectCustomerId, customerId]);

  // Auto-pick the only property if the customer has just one. This is the
  // "skip property step" bit — operators starting from a customer page
  // shouldn't have to click through a one-option dropdown.
  useEffect(() => {
    if (!propertyId && properties && properties.length === 1) {
      setPropertyId(properties[0].id);
    }
  }, [properties, propertyId]);

  const selectedCustomer = useMemo(
    () => customers?.find((c) => c.id === customerId) ?? null,
    [customers, customerId],
  );
  const selectedProperty = useMemo(
    () => properties?.find((p) => p.id === propertyId) ?? null,
    [properties, propertyId],
  );

  const total = useMemo(() => quoteTotal(lines), [lines]);

  // When customer changes (after initial mount), clear the property selection
  // so we don't keep a dangling property_id from a different customer.
  useEffect(() => {
    // Only clear if the current selection doesn't belong to this customer.
    if (!properties) return;
    if (propertyId && !properties.find((p) => p.id === propertyId)) {
      setPropertyId("");
    }
  }, [properties, propertyId]);

  const addCatalogLine = (item: CatalogItem) => {
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        catalog_item_id: item.id,
        name: item.name,
        qty: 1,
        rate: Number(item.default_rate ?? 0),
        total: Number(item.default_rate ?? 0),
      },
    ]);
  };

  const addCustomLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: "Custom service",
        qty: 1,
        rate: 0,
        total: 0,
      },
    ]);
  };

  const updateLine = (id: string, patch: Partial<QuoteLine>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        next.total = lineTotal(next);
        return next;
      }),
    );
  };

  const removeLine = (id: string) =>
    setLines((prev) => prev.filter((l) => l.id !== id));

  const buildValues = (): QuoteFormValues => ({
    customer_id: customerId,
    property_id: propertyId,
    customer_name: selectedCustomer?.name ?? initial?.customer_name ?? "",
    phone: selectedCustomer?.phone ?? initial?.phone ?? "",
    customer_email: selectedCustomer?.email ?? initial?.customer_email ?? "",
    address:
      selectedProperty?.address ??
      selectedCustomer?.primary_address ??
      initial?.address ??
      "",
    lines,
    notes,
    deposit_percent: depositPercent,
    expires_at: expiresAt,
  });

  const handle = (action: "draft" | "send" | "save") => {
    onSubmit(buildValues(), action);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handle(submitMode === "create" ? "draft" : "save");
      }}
      className="px-4 space-y-3 pb-6"
    >
      {/* Customer + property */}
      <Section title="Customer" subtitle="Who is this quote for?">
        <Field label="Customer">
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="tp-input"
            required
          >
            <option value="">Select a customer…</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Property">
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="tp-input"
            disabled={!customerId}
          >
            <option value="">
              {customerId
                ? properties && properties.length === 0
                  ? "No properties on file"
                  : "Select a property…"
                : "Pick a customer first"}
            </option>
            {properties?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      {/* Line items */}
      <Section
        title="Line items"
        subtitle="Pick from your service catalog or add a custom row. Most one-offs are a single flat-fee line."
      >
        {/* Catalog quick-picker */}
        {catalog && catalog.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {catalog.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addCatalogLine(item)}
                className="px-3 py-1.5 rounded-full text-[12px] font-semibold border border-neutral-200 bg-card text-neutral-700 hover:border-brand-700 transition-colors inline-flex items-center gap-1"
              >
                <Plus className="h-3 w-3" strokeWidth={2.4} />
                {item.name}
                {item.default_rate ? (
                  <span className="text-neutral-500 ml-0.5 tp-num">
                    ${Number(item.default_rate).toFixed(0)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-neutral-500">
            No services in your catalog yet — add some under Settings, or just
            add a custom line below.
          </p>
        )}

        <button
          type="button"
          onClick={addCustomLine}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-200 py-2 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
          Add custom line
        </button>

        {lines.length > 0 && (
          <ul className="space-y-2 pt-1">
            {lines.map((l) => (
              <li
                key={l.id}
                className="rounded-xl border border-neutral-200 bg-card p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    value={l.name}
                    onChange={(e) =>
                      updateLine(l.id, { name: e.target.value })
                    }
                    placeholder="Line item name"
                    className="tp-input flex-1 font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(l.id)}
                    className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 flex items-center justify-center"
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Qty">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.5"
                      value={l.qty}
                      onChange={(e) =>
                        updateLine(l.id, { qty: Number(e.target.value) || 0 })
                      }
                      className="tp-input"
                    />
                  </Field>
                  <Field label="Rate ($)">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={l.rate}
                      onChange={(e) =>
                        updateLine(l.id, { rate: Number(e.target.value) || 0 })
                      }
                      className="tp-input"
                    />
                  </Field>
                  <Field label="Total">
                    <div className="tp-input bg-neutral-100 text-neutral-700 font-semibold tp-num">
                      ${l.total.toFixed(2)}
                    </div>
                  </Field>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Deposit + expiry */}
      <Section
        title="Terms"
        subtitle="Optional deposit and expiry — TurfPro defaults to 0% deposit and a 14-day window."
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label="Deposit %">
            <div className="relative">
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                step="1"
                value={depositPercent}
                onChange={(e) =>
                  setDepositPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                }
                className="tp-input pr-7"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">
                %
              </span>
            </div>
          </Field>
          <Field label="Expires">
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="tp-input"
            />
          </Field>
        </div>
        {depositPercent > 0 && total > 0 && (
          <div className="text-[11px] text-neutral-500 tp-num">
            Deposit ≈ ${((total * depositPercent) / 100).toFixed(2)}
          </div>
        )}
      </Section>

      {/* Notes */}
      <Section title="Notes" subtitle="Anything the customer should see on the printed quote.">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Gate code, access notes, scope clarifications…"
          className="tp-input resize-none"
        />
      </Section>

      {/* Summary card */}
      <div className="rounded-[18px] bg-gradient-hero-deep text-white p-[18px] relative overflow-hidden">
        <div className="text-[10px] font-semibold tracking-[1px] uppercase text-accent-400">
          Quote total
        </div>
        <div className="tp-display tp-num text-[38px] font-bold leading-none mt-1">
          ${total.toFixed(2)}
        </div>
        <div className="text-white/70 text-[12px] mt-2 tp-num">
          {lines.length} line{lines.length === 1 ? "" : "s"}
          {depositPercent > 0
            ? ` · $${((total * depositPercent) / 100).toFixed(2)} deposit`
            : ""}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-[hsl(var(--destructive-bg))] text-destructive text-[12.5px] font-semibold p-3">
          {error}
        </div>
      )}

      {/* Actions */}
      {submitMode === "create" ? (
        <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-neutral-200 bg-card text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-100 transition-colors inline-flex items-center justify-center gap-1.5"
          >
            <X className="h-3.5 w-3.5" /> Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handle("draft")}
            className="rounded-full bg-neutral-100 text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-200 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Draft
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handle("send")}
            className="rounded-full bg-accent-500 text-white font-bold text-[13px] py-3 shadow-accent hover:bg-accent-600 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Save &amp; send
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_2fr] gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-neutral-200 bg-card text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-100 transition-colors inline-flex items-center justify-center gap-1.5"
          >
            <X className="h-3.5 w-3.5" /> Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handle("save")}
            className="rounded-full bg-accent-500 text-white font-bold text-[13px] py-3 shadow-accent hover:bg-accent-600 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save changes
          </button>
        </div>
      )}

      {/* Local input styling — kept inline so we don't create a new ui file
          (matches NewPlan's approach). */}
      <style>{`
        .tp-input {
          width: 100%;
          background: hsl(var(--card));
          border: 1px solid hsl(var(--neutral-200));
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 14px;
          color: hsl(var(--neutral-900));
          font-family: inherit;
        }
        .tp-input:focus {
          outline: none;
          border-color: hsl(var(--brand-800));
          box-shadow: 0 0 0 3px hsl(var(--brand-100));
        }
        .tp-input:disabled {
          background: hsl(var(--neutral-100));
          color: hsl(var(--neutral-500));
          cursor: not-allowed;
        }
      `}</style>
    </form>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tp-card p-4 space-y-3">
      <div>
        <h2 className="text-[14px] font-semibold text-neutral-900">{title}</h2>
        {subtitle && (
          <p className="text-[11.5px] text-neutral-500 mt-0.5 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[10.5px] font-bold uppercase tracking-[0.4px] text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}

