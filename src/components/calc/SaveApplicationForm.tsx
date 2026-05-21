import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wind, Thermometer, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// Shared "Save to chemical log" form. Lifted out of ApplicationCalc so the
// Chemical Log "+ Add application" button can render the same form without
// duplicating the regulatory-record field set or the mutation.
//
// The chemical_applications table isn't in src/integrations/supabase/types.ts
// (it ships in supabase/migrations/0001_turfpro_lawn_care.sql), so every I/O
// boundary against it uses `(supabase as any)` casts.

export type ApplicationType =
  | "fertilizer"
  | "herbicide"
  | "pesticide"
  | "fungicide"
  | "lime"
  | "other";

export const APPLICATION_TYPES: { value: ApplicationType; label: string }[] = [
  { value: "fertilizer", label: "Fertilizer" },
  { value: "herbicide", label: "Herbicide" },
  { value: "pesticide", label: "Pesticide" },
  { value: "fungicide", label: "Fungicide" },
  { value: "lime", label: "Lime" },
  { value: "other", label: "Other" },
];

// Rate/total/area come pre-filled from the calculator. The form accepts the
// computed numbers as defaults; the user can still override before saving.
export interface PrefillRate {
  rate_amount?: number | null;
  rate_unit?: string | null;
  total_amount?: number | null;
  total_unit?: string | null;
  area_sqft?: number | null;
}

interface PropertyLite {
  id: string;
  address: string;
  customer_id: string | null;
  pet_safe_only?: boolean | null;
}

interface Props {
  // If supplied, hides the property picker.
  propertyId?: string | null;
  // Calculator's current outputs — wired into the rate/total/area fields.
  prefill?: PrefillRate;
  // Default application type (the calculator's current mode usually maps to one).
  defaultType?: ApplicationType;
  // Default product name (e.g. carry over from the calc input).
  defaultProductName?: string;
  // Called after the row is inserted; the calc just clears its dirty flag,
  // the log invalidates its list query.
  onSaved?: (id: string) => void;
  // Optional cancel/close handler for embedded modal usage.
  onCancel?: () => void;
  // Visual variant — the calc embeds it under the result card; the log opens
  // it as an inline drawer. Same fields either way.
  variant?: "embedded" | "inline";
}

export default function SaveApplicationForm({
  propertyId,
  prefill,
  defaultType = "fertilizer",
  defaultProductName = "",
  onSaved,
  onCancel,
  variant = "embedded",
}: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [type, setType] = useState<ApplicationType>(defaultType);
  const [productName, setProductName] = useState(defaultProductName);
  const [epa, setEpa] = useState("");
  const [activeIngredient, setActiveIngredient] = useState("");
  const [applicatorName, setApplicatorName] = useState("");
  const [applicatorLicense, setApplicatorLicense] = useState("");
  const [tempF, setTempF] = useState("");
  const [windMph, setWindMph] = useState("");
  const [conditions, setConditions] = useState("");
  const [customerNotified, setCustomerNotified] = useState(false);
  const [signsPosted, setSignsPosted] = useState(false);
  const [notes, setNotes] = useState("");
  const [chosenPropertyId, setChosenPropertyId] = useState<string | null>(
    propertyId ?? null,
  );
  const [err, setErr] = useState<string | null>(null);

  // Keep type in sync if the parent (calc) flips modes after mount.
  useEffect(() => {
    setType(defaultType);
  }, [defaultType]);
  useEffect(() => {
    if (defaultProductName) setProductName(defaultProductName);
  }, [defaultProductName]);
  useEffect(() => {
    if (propertyId) setChosenPropertyId(propertyId);
  }, [propertyId]);

  // Properties — only fetched when the user actually needs the picker, i.e.
  // no deep-linked property_id. Lightweight select (no joins).
  const propsQuery = useQuery({
    queryKey: ["properties-lite", user?.id],
    enabled: !!user && !propertyId,
    queryFn: async (): Promise<PropertyLite[]> => {
      const { data, error } = await (supabase as any)
        .from("properties")
        .select("id, address, customer_id, pet_safe_only")
        .order("address", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PropertyLite[];
    },
  });

  // Weather fields are regulated for spray applications in most states but
  // irrelevant for granular fert / lime — hide them to keep the form short.
  const needsWeather =
    type === "herbicide" || type === "pesticide" || type === "fungicide";
  // Customer-notification + signs-posted are only required for true pesticide
  // categories (herbicide & pesticide). Fungicide rules vary by state so we
  // surface the toggles for it via the weather block but skip notification.
  const needsNotification = type === "herbicide" || type === "pesticide";

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!productName.trim()) throw new Error("Product name required");

      // Look up customer_id from the chosen property so the row joins back.
      let customerId: string | null = null;
      if (chosenPropertyId) {
        const list = propsQuery.data;
        const match = list?.find((p) => p.id === chosenPropertyId);
        if (match) {
          customerId = match.customer_id;
        } else {
          // Property was supplied via deep-link — fetch its customer_id.
          const { data } = await (supabase as any)
            .from("properties")
            .select("customer_id")
            .eq("id", chosenPropertyId)
            .maybeSingle();
          customerId = (data?.customer_id as string | null) ?? null;
        }
      }

      const payload: Record<string, unknown> = {
        user_id: user.id,
        property_id: chosenPropertyId,
        customer_id: customerId,
        applied_at: new Date().toISOString(),
        applicator_name: applicatorName.trim() || null,
        applicator_license: applicatorLicense.trim() || null,
        product_name: productName.trim(),
        epa_reg_number: epa.trim() || null,
        active_ingredient: activeIngredient.trim() || null,
        application_type: type,
        rate_amount: prefill?.rate_amount ?? null,
        rate_unit: prefill?.rate_unit ?? null,
        total_amount: prefill?.total_amount ?? null,
        total_unit: prefill?.total_unit ?? null,
        area_sqft: prefill?.area_sqft ?? null,
        temperature_f: needsWeather && tempF ? Number(tempF) : null,
        wind_mph: needsWeather && windMph ? Number(windMph) : null,
        conditions: needsWeather && conditions.trim() ? conditions.trim() : null,
        customer_notified: needsNotification ? customerNotified : false,
        signs_posted: needsNotification ? signsPosted : false,
        notes: notes.trim() || null,
      };

      const { data, error } = await (supabase as any)
        .from("chemical_applications")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["chemical-applications"] });
      onSaved?.(id);
    },
    onError: (e) => {
      setErr(e instanceof Error ? e.message : "Save failed");
    },
  });

  // Reset error when the user edits anything material.
  useEffect(() => {
    if (err) setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productName, type, chosenPropertyId]);

  const propertyName = useMemo(() => {
    if (!chosenPropertyId) return null;
    return propsQuery.data?.find((p) => p.id === chosenPropertyId)?.address ?? null;
  }, [chosenPropertyId, propsQuery.data]);

  return (
    <div
      className={cn(
        variant === "embedded" ? "tp-card" : "rounded-[16px] border border-ink-100 bg-card",
        "p-4",
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-bronze-600">
            Compliance record
          </div>
          <h3 className="tp-display text-[16px] font-bold text-ink-900 mt-0.5">
            Save to chemical log
          </h3>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-[12px] font-semibold text-ink-500 hover:text-ink-700"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {/* Property picker — hidden when supplied by parent */}
        {!propertyId && (
          <Field label="Property">
            {propsQuery.isLoading ? (
              <div className="text-[12px] text-ink-500">Loading properties…</div>
            ) : (
              <select
                value={chosenPropertyId ?? ""}
                onChange={(e) => setChosenPropertyId(e.target.value || null)}
                className="w-full bg-card border border-ink-200 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-900"
              >
                <option value="">— No property —</option>
                {(propsQuery.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.address}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        {propertyId && propertyName && (
          <div className="text-[11.5px] text-ink-500">
            Logging against{" "}
            <span className="text-ink-900 font-semibold">{propertyName}</span>
          </div>
        )}

        {/* Type chips */}
        <Field label="Application type">
          <div className="flex flex-wrap gap-1.5">
            {APPLICATION_TYPES.map((t) => {
              const on = type === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors",
                    on
                      ? "bg-green-800 text-white"
                      : "bg-ink-100 text-ink-700 hover:bg-ink-200",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-3">
          <Field label="Product name">
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Lesco Pro 24-0-11"
              className="w-full bg-card border border-ink-200 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-900"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="EPA reg #" hint="optional">
              <input
                type="text"
                value={epa}
                onChange={(e) => setEpa(e.target.value)}
                placeholder="e.g. 538-298"
                className="w-full bg-card border border-ink-200 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-900 tp-num"
              />
            </Field>
            <Field label="Active ingredient" hint="optional">
              <input
                type="text"
                value={activeIngredient}
                onChange={(e) => setActiveIngredient(e.target.value)}
                placeholder="e.g. 2,4-D"
                className="w-full bg-card border border-ink-200 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-900"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Applicator" hint="optional">
              <input
                type="text"
                value={applicatorName}
                onChange={(e) => setApplicatorName(e.target.value)}
                placeholder="Name"
                className="w-full bg-card border border-ink-200 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-900"
              />
            </Field>
            <Field label="License #" hint="optional">
              <input
                type="text"
                value={applicatorLicense}
                onChange={(e) => setApplicatorLicense(e.target.value)}
                placeholder="State license"
                className="w-full bg-card border border-ink-200 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-900 tp-num"
              />
            </Field>
          </div>
        </div>

        {/* Prefill summary — read-only echo so the user sees what's being saved */}
        {(prefill?.rate_amount != null ||
          prefill?.total_amount != null ||
          prefill?.area_sqft != null) && (
          <div className="rounded-[12px] bg-ink-100 px-3 py-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-700">
            {prefill?.rate_amount != null && (
              <span>
                <span className="text-ink-500">Rate</span>{" "}
                <span className="tp-num font-semibold text-ink-900">
                  {prefill.rate_amount}
                </span>{" "}
                {prefill.rate_unit ?? ""}
              </span>
            )}
            {prefill?.total_amount != null && (
              <span>
                <span className="text-ink-500">Total</span>{" "}
                <span className="tp-num font-semibold text-ink-900">
                  {prefill.total_amount}
                </span>{" "}
                {prefill.total_unit ?? ""}
              </span>
            )}
            {prefill?.area_sqft != null && (
              <span>
                <span className="text-ink-500">Area</span>{" "}
                <span className="tp-num font-semibold text-ink-900">
                  {prefill.area_sqft.toLocaleString()}
                </span>{" "}
                ft²
              </span>
            )}
          </div>
        )}

        {/* Weather — spray apps only */}
        {needsWeather && (
          <div className="rounded-[12px] border border-ink-100 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-ink-500 mb-2">
              Weather at application
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    <Thermometer className="h-3 w-3" /> Temp °F
                  </span>
                }
              >
                <input
                  type="number"
                  inputMode="decimal"
                  value={tempF}
                  onChange={(e) => setTempF(e.target.value)}
                  placeholder="72"
                  className="w-full bg-card border border-ink-200 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-900 tp-num"
                />
              </Field>
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    <Wind className="h-3 w-3" /> Wind mph
                  </span>
                }
              >
                <input
                  type="number"
                  inputMode="decimal"
                  value={windMph}
                  onChange={(e) => setWindMph(e.target.value)}
                  placeholder="5"
                  className="w-full bg-card border border-ink-200 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-900 tp-num"
                />
              </Field>
            </div>
            <div className="mt-2.5">
              <Field label="Conditions">
                <input
                  type="text"
                  value={conditions}
                  onChange={(e) => setConditions(e.target.value)}
                  placeholder="e.g. clear, light breeze"
                  className="w-full bg-card border border-ink-200 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-900"
                />
              </Field>
            </div>
          </div>
        )}

        {/* Notification toggles — herbicide / pesticide only */}
        {needsNotification && (
          <div className="flex flex-col gap-1.5">
            <Toggle
              label="Customer notified"
              checked={customerNotified}
              onChange={setCustomerNotified}
            />
            <Toggle
              label="Signs posted at property"
              checked={signsPosted}
              onChange={setSignsPosted}
            />
          </div>
        )}

        <Field label="Notes" hint="optional">
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything else worth recording"
            className="w-full bg-card border border-ink-200 rounded-[10px] px-3 py-2 text-[13.5px] text-ink-900 resize-none"
          />
        </Field>

        {err && (
          <div className="text-[12px] text-destructive font-medium">{err}</div>
        )}

        <div className="flex gap-2.5">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-3 rounded-[14px] bg-card border border-ink-200 text-ink-900 font-semibold text-[13.5px]"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={save.isPending || !productName.trim()}
            onClick={() => save.mutate()}
            className={cn(
              "flex-[2] py-3 rounded-[14px] font-bold text-[14px] text-white inline-flex items-center justify-center gap-2 transition-colors",
              save.isPending || !productName.trim()
                ? "bg-green-800/60"
                : "bg-green-800 hover:bg-green-700",
            )}
          >
            <Check className="h-4 w-4" strokeWidth={2.4} />
            {save.isPending ? "Saving…" : "Save to chemical log"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.4px] text-ink-500">
          {label}
        </span>
        {hint && <span className="text-[10.5px] text-ink-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center justify-between px-3 py-2.5 rounded-[12px] border transition-colors",
        checked
          ? "bg-green-50 border-green-100"
          : "bg-card border-ink-100 hover:border-ink-200",
      )}
    >
      <span
        className={cn(
          "text-[13px] font-semibold",
          checked ? "text-green-800" : "text-ink-700",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "h-5 w-9 rounded-full relative transition-colors",
          checked ? "bg-green-700" : "bg-ink-200",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
