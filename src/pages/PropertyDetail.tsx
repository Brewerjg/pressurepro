import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { APP_ID } from "@/lib/app-context";
import {
  ArrowLeft,
  MapPin,
  KeyRound,
  AlertTriangle,
  Mountain,
  Pencil,
  Save,
  Trash2,
  Repeat,
  Leaf,
  ChevronRight,
  Droplets,
  Scissors,
  PawPrint,
  Beaker,
  Trees,
} from "lucide-react";

// Ported from pressure-pro-quoter/src/pages/PropertyDetail.tsx. Removes the
// surface picker (concrete/siding/roof/etc) which doesn't apply to lawn care;
// adds a "Lawn details" section for the columns introduced in
// supabase/migrations/0001_turfpro_lawn_care.sql:
//   turf_sqft, grass_type, mow_height_in,
//   pet_safe_only, irrigation_present, slope_warning, bag_clippings
// Those columns aren't in the generated types yet, so we cast at I/O boundaries.

const COMMON_GRASS_TYPES = [
  "Bermuda",
  "Fescue",
  "Zoysia",
  "Kentucky Bluegrass",
  "St. Augustine",
  "Centipede",
  "Ryegrass",
  "Buffalo",
  "mixed",
];

const DAY_LABELS: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

// Base + lawn-care additions to the properties row.
interface PropertyRow {
  id: string;
  customer_id: string;
  address: string;
  lat: number | null;
  lng: number | null;
  sqft: number | null;
  surface_notes: string | null;
  gate_code: string | null;
  dog_warning: boolean;
  created_at: string;
  // Lawn-care additions — not in generated types until regen
  turf_sqft?: number | null;
  grass_type?: string | null;
  mow_height_in?: number | null;
  pet_safe_only?: boolean | null;
  irrigation_present?: boolean | null;
  slope_warning?: boolean | null;
  bag_clippings?: boolean | null;
}

interface PlanRow {
  id: string;
  status: string;
  amount: number;
  interval_months: number;
  day_of_week?: number | null;
  frequency?: string | null;
}

interface ChemAppRow {
  id: string;
  product_name: string;
  applied_at: string;
  area_sqft: number | null;
  application_type?: string | null;
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface EditState {
  address: string;
  sqft: string;
  turf_sqft: string;
  gate_code: string;
  dog_warning: boolean;
  slope_warning: boolean;
  grass_type: string;
  mow_height_in: string;
  pet_safe_only: boolean;
  irrigation_present: boolean;
  bag_clippings: boolean;
}

const emptyEdit: EditState = {
  address: "",
  sqft: "",
  turf_sqft: "",
  gate_code: "",
  dog_warning: false,
  slope_warning: false,
  grass_type: "",
  mow_height_in: "",
  pet_safe_only: false,
  irrigation_present: false,
  bag_clippings: false,
};

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<EditState>(emptyEdit);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["property-detail", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing id");
      // properties + joined customer name. Lawn-care columns come back even
      // though they're not in types — we just don't get type-narrowing for them.
      const { data: p, error } = await supabase
        .from("properties")
        .select("*, customers(name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!p) return null;

      const customerName =
        ((p as { customers?: { name: string } | null }).customers?.name) ?? "";

      // Plans for this property. day_of_week + frequency from migration 0001.
      const { data: plans } = await (supabase as any)
        .from("maintenance_plans")
        .select("id, status, amount, interval_months, day_of_week, frequency")
        .eq("property_id", id)
        .eq("app", APP_ID);

      // chemical_applications isn't in generated types (added in migration 0001).
      const { data: chems } = await (supabase as any)
        .from("chemical_applications")
        .select("id, product_name, applied_at, area_sqft, application_type")
        .eq("property_id", id)
        .order("applied_at", { ascending: false })
        .limit(5);

      return {
        property: p as unknown as PropertyRow,
        customerName,
        plans: (plans ?? []) as PlanRow[],
        chems: (chems ?? []) as ChemAppRow[],
      };
    },
    enabled: !!id,
  });

  // Hydrate the edit form whenever the underlying property loads/changes.
  useEffect(() => {
    if (!data?.property) return;
    const p = data.property;
    setEdit({
      address: p.address ?? "",
      sqft: p.sqft != null ? String(p.sqft) : "",
      turf_sqft: p.turf_sqft != null ? String(p.turf_sqft) : "",
      gate_code: p.gate_code ?? "",
      dog_warning: !!p.dog_warning,
      slope_warning: !!p.slope_warning,
      grass_type: p.grass_type ?? "",
      mow_height_in: p.mow_height_in != null ? String(p.mow_height_in) : "",
      pet_safe_only: !!p.pet_safe_only,
      irrigation_present: !!p.irrigation_present,
      bag_clippings: !!p.bag_clippings,
    });
  }, [data?.property]);

  const saveProperty = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Missing id");
      if (!edit.address.trim()) throw new Error("Address is required");
      const sqft = edit.sqft.trim() ? Number(edit.sqft) : null;
      const turfSqft = edit.turf_sqft.trim() ? Number(edit.turf_sqft) : null;
      const mowHeight = edit.mow_height_in.trim() ? Number(edit.mow_height_in) : null;
      if (sqft != null && !Number.isFinite(sqft)) throw new Error("Lot sqft must be a number");
      if (turfSqft != null && !Number.isFinite(turfSqft)) throw new Error("Turf sqft must be a number");
      if (mowHeight != null && !Number.isFinite(mowHeight)) throw new Error("Mow height must be a number");

      // Cast the payload — lawn-care columns aren't in the generated Update type.
      const payload: Record<string, unknown> = {
        address: edit.address.trim(),
        sqft,
        gate_code: edit.gate_code.trim() || null,
        dog_warning: edit.dog_warning,
        // Lawn-care additions
        turf_sqft: turfSqft,
        grass_type: edit.grass_type.trim() || null,
        mow_height_in: mowHeight,
        pet_safe_only: edit.pet_safe_only,
        irrigation_present: edit.irrigation_present,
        slope_warning: edit.slope_warning,
        bag_clippings: edit.bag_clippings,
      };
      const { error } = await (supabase as any)
        .from("properties")
        .update(payload)
        .eq("id", id);
      if (error) throw error as Error;
    },
    onSuccess: () => {
      setEditing(false);
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ["property-detail", id] });
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const deleteProperty = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Missing id");
      const { error } = await supabase.from("properties").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      navigate(-1);
    },
  });

  if (isLoading) {
    return <div className="pt-6 px-[22px] text-sm text-ink-500">Loading…</div>;
  }
  if (!data?.property) {
    return (
      <div className="pt-6 px-[22px]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-ink-500 inline-flex items-center gap-1.5 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="tp-card p-5 text-sm text-ink-700">Property not found.</div>
      </div>
    );
  }

  const { property, customerName, plans, chems } = data;

  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.4px] uppercase text-ink-500 mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold tracking-[0.4px] uppercase text-bronze-600">
              Property
            </div>
            <h1 className="tp-display text-[24px] font-bold text-ink-900 mt-0.5 leading-tight">
              {property.address}
            </h1>
            {customerName && (
              <Link
                to={`/customers/${property.customer_id}`}
                className="text-sm text-green-800 font-semibold mt-1 inline-flex items-center gap-1"
              >
                For {customerName}
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </Link>
            )}
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setSaveError(null);
                setEditing(true);
              }}
              className="h-10 px-3.5 rounded-[14px] border border-ink-200 bg-card text-ink-700 text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> Edit
            </button>
          )}
        </div>
      </header>

      {editing ? (
        /* ── Edit form ─────────────────────────────────────────────────── */
        <section className="mx-4 mb-4 space-y-3">
          {/* Property details */}
          <div className="tp-card p-4 space-y-3">
            <SectionLabel>Property</SectionLabel>
            <Field label="Address">
              <input
                value={edit.address}
                onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                className="tp-input"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lot sqft">
                <input
                  type="number"
                  inputMode="numeric"
                  value={edit.sqft}
                  onChange={(e) => setEdit({ ...edit, sqft: e.target.value })}
                  className="tp-input"
                />
              </Field>
              <Field label="Turf sqft">
                <input
                  type="number"
                  inputMode="numeric"
                  value={edit.turf_sqft}
                  onChange={(e) => setEdit({ ...edit, turf_sqft: e.target.value })}
                  className="tp-input"
                />
              </Field>
            </div>
            <Field label="Gate code">
              <input
                value={edit.gate_code}
                onChange={(e) => setEdit({ ...edit, gate_code: e.target.value })}
                className="tp-input"
              />
            </Field>
            <ToggleRow
              label="Dog on property"
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              checked={edit.dog_warning}
              onChange={(v) => setEdit({ ...edit, dog_warning: v })}
            />
            <ToggleRow
              label="Slope warning"
              icon={<Mountain className="h-3.5 w-3.5" />}
              checked={edit.slope_warning}
              onChange={(v) => setEdit({ ...edit, slope_warning: v })}
            />
          </div>

          {/* Lawn details — NEW for TurfPro */}
          <div className="tp-card p-4 space-y-3">
            <SectionLabel accent="green">Lawn details</SectionLabel>
            <Field label="Grass type">
              <input
                list="grass-types"
                value={edit.grass_type}
                onChange={(e) => setEdit({ ...edit, grass_type: e.target.value })}
                placeholder="e.g. Bermuda, Fescue, Zoysia…"
                className="tp-input"
              />
              <datalist id="grass-types">
                {COMMON_GRASS_TYPES.map((g) => (
                  <option value={g} key={g} />
                ))}
              </datalist>
            </Field>
            <Field label="Mow height (in)">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={edit.mow_height_in}
                onChange={(e) => setEdit({ ...edit, mow_height_in: e.target.value })}
                placeholder="e.g. 3.5"
                className="tp-input"
              />
            </Field>
            <ToggleRow
              label="Pet-safe chems only"
              icon={<PawPrint className="h-3.5 w-3.5" />}
              checked={edit.pet_safe_only}
              onChange={(v) => setEdit({ ...edit, pet_safe_only: v })}
            />
            <ToggleRow
              label="Irrigation present"
              icon={<Droplets className="h-3.5 w-3.5" />}
              checked={edit.irrigation_present}
              onChange={(v) => setEdit({ ...edit, irrigation_present: v })}
            />
            <ToggleRow
              label="Bag clippings"
              icon={<Scissors className="h-3.5 w-3.5" />}
              checked={edit.bag_clippings}
              onChange={(v) => setEdit({ ...edit, bag_clippings: v })}
            />
          </div>

          {saveError && (
            <div className="tp-card p-3 text-xs font-semibold text-destructive">
              {saveError}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                // Reset edit state from source so cancel discards.
                if (data?.property) {
                  const p = data.property;
                  setEdit({
                    address: p.address ?? "",
                    sqft: p.sqft != null ? String(p.sqft) : "",
                    turf_sqft: p.turf_sqft != null ? String(p.turf_sqft) : "",
                    gate_code: p.gate_code ?? "",
                    dog_warning: !!p.dog_warning,
                    slope_warning: !!p.slope_warning,
                    grass_type: p.grass_type ?? "",
                    mow_height_in: p.mow_height_in != null ? String(p.mow_height_in) : "",
                    pet_safe_only: !!p.pet_safe_only,
                    irrigation_present: !!p.irrigation_present,
                    bag_clippings: !!p.bag_clippings,
                  });
                }
                setSaveError(null);
                setEditing(false);
              }}
              className="flex-1 h-11 rounded-[14px] bg-ink-100 text-ink-700 font-bold text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => saveProperty.mutate()}
              disabled={saveProperty.isPending}
              className="flex-1 h-11 rounded-[14px] bg-bronze-500 text-white font-bold text-sm shadow-bronze hover:bg-bronze-600 inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saveProperty.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      ) : (
        /* ── Read view ─────────────────────────────────────────────────── */
        <section className="mx-4 mb-4 space-y-3">
          {/* Property details */}
          <div className="tp-card p-4 space-y-3">
            <SectionLabel>Property</SectionLabel>
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-green-800 shrink-0" strokeWidth={2.2} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-ink-900">{property.address}</div>
                {property.lat != null && property.lng != null && (
                  <a
                    href={`https://www.google.com/maps?q=${property.lat},${property.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-green-800 underline font-semibold"
                  >
                    Open in Maps
                  </a>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Stat
                label="Lot sqft"
                value={property.sqft != null ? property.sqft.toLocaleString() : "—"}
              />
              <Stat
                label="Turf sqft"
                value={property.turf_sqft != null ? property.turf_sqft.toLocaleString() : "—"}
              />
            </div>
            {property.gate_code && (
              <InfoRow icon={<KeyRound className="h-4 w-4" />} label={`Gate: ${property.gate_code}`} />
            )}
            {property.dog_warning && (
              <InfoRow
                icon={<AlertTriangle className="h-4 w-4" />}
                label="Dog on property"
                tone="destructive"
              />
            )}
            {property.slope_warning && (
              <InfoRow
                icon={<Mountain className="h-4 w-4" />}
                label="Slope warning — crew safety"
                tone="warning"
              />
            )}
          </div>

          {/* Lawn details */}
          <div className="tp-card p-4 space-y-3">
            <SectionLabel accent="green">
              <Leaf className="h-3.5 w-3.5 inline -mt-0.5 mr-1" strokeWidth={2.2} />
              Lawn details
            </SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Grass type" value={property.grass_type || "—"} />
              <Stat
                label="Mow height"
                value={
                  property.mow_height_in != null ? `${property.mow_height_in}"` : "—"
                }
              />
            </div>
            <div className="grid grid-cols-1 gap-1.5 pt-1">
              {property.pet_safe_only && (
                <Pill icon={<PawPrint className="h-3 w-3" />} tone="green">
                  Pet-safe chems only
                </Pill>
              )}
              {property.irrigation_present && (
                <Pill icon={<Droplets className="h-3 w-3" />} tone="rain">
                  Irrigation present
                </Pill>
              )}
              {property.bag_clippings && (
                <Pill icon={<Scissors className="h-3 w-3" />} tone="bronze">
                  Bag clippings
                </Pill>
              )}
              {!property.pet_safe_only &&
                !property.irrigation_present &&
                !property.bag_clippings && (
                  <div className="text-xs text-ink-500">
                    No lawn-care flags set. Edit to record grass type, mow height,
                    irrigation, etc.
                  </div>
                )}
            </div>
          </div>
        </section>
      )}

      {/* ── Plans for this property ──────────────────────────────────── */}
      <section className="mx-4 mb-4">
        <h2 className="tp-display text-[15px] font-bold text-ink-900 inline-flex items-center gap-1.5 px-1 pb-2">
          <Repeat className="h-4 w-4 text-green-800" strokeWidth={2.2} />
          Plans for this property
          <span className="text-ink-500 font-semibold text-xs ml-0.5">({plans.length})</span>
        </h2>
        {plans.length === 0 ? (
          <div className="tp-card p-4 text-sm text-ink-500">No plans yet for this property.</div>
        ) : (
          <div className="space-y-2">
            {plans.map((p) => {
              const day =
                p.day_of_week !== undefined && p.day_of_week !== null
                  ? DAY_LABELS[p.day_of_week]
                  : null;
              const freq = p.frequency ?? "weekly";
              const isActive = p.status === "active";
              return (
                <Link
                  key={p.id}
                  to={`/plans/${p.id}`}
                  className="tp-card p-3.5 flex items-center justify-between gap-3 active:bg-ink-100 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-bold text-ink-900 capitalize">
                        {freq.replace("_", " ")}
                      </span>
                      {day && (
                        <span className="text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-800 px-1.5 py-0.5 rounded-full">
                          {day}
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                          isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-ink-100 text-ink-700"
                        }`}
                      >
                        {p.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      every {p.interval_months} mo
                    </div>
                  </div>
                  <div className="tp-display tp-num text-base font-bold text-ink-900 shrink-0">
                    {fmtUSD(Number(p.amount))}
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-400 shrink-0" strokeWidth={2.2} />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Recent applications ──────────────────────────────────────── */}
      <section className="mx-4 mb-4">
        <h2 className="tp-display text-[15px] font-bold text-ink-900 inline-flex items-center gap-1.5 px-1 pb-2">
          <Beaker className="h-4 w-4 text-bronze-600" strokeWidth={2.2} />
          Recent applications
          <span className="text-ink-500 font-semibold text-xs ml-0.5">({chems.length})</span>
        </h2>
        {chems.length === 0 ? (
          <div className="tp-card p-4 text-sm text-ink-500">
            <Trees className="h-4 w-4 inline -mt-0.5 mr-1 text-ink-400" strokeWidth={1.8} />
            No chemical applications logged yet for this property.
          </div>
        ) : (
          <div className="tp-card p-0 overflow-hidden">
            {chems.map((c, i) => (
              <div
                key={c.id}
                className={`p-3.5 flex items-center justify-between gap-3 ${
                  i ? "border-t border-ink-200" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink-900 truncate">
                    {c.product_name}
                  </div>
                  <div className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-1.5">
                    <span>{new Date(c.applied_at).toLocaleDateString()}</span>
                    {c.application_type && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="capitalize">{c.application_type}</span>
                      </>
                    )}
                  </div>
                </div>
                {c.area_sqft != null && (
                  <div className="text-right shrink-0">
                    <div className="tp-num text-sm font-bold text-ink-900">
                      {c.area_sqft.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-ink-500">sqft</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={() => {
          if (confirm("Delete this property?")) deleteProperty.mutate();
        }}
        className="mx-4 mt-2 mb-6 w-[calc(100%-2rem)] text-destructive text-sm font-semibold py-3 flex items-center justify-center gap-2"
      >
        <Trash2 className="h-4 w-4" /> Delete property
      </button>

      <style>{`
        .tp-input {
          width: 100%;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1.5px solid hsl(var(--ink-200));
          background: hsl(var(--card));
          color: hsl(var(--ink-900));
          font-size: 14px;
          font-weight: 500;
          outline: none;
          transition: border-color 0.15s;
        }
        .tp-input:focus { border-color: hsl(var(--green-800)); }
      `}</style>
    </div>
  );
}

function SectionLabel({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: "green" | "bronze";
}) {
  const tone =
    accent === "green" ? "text-green-800" : accent === "bronze" ? "text-bronze-600" : "text-ink-500";
  return (
    <div className={`text-[10px] font-bold uppercase tracking-[0.1em] ${tone}`}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500 mb-0.5">
        {label}
      </div>
      <div className="tp-num text-sm font-bold text-ink-900">{value}</div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "destructive" | "warning";
}) {
  const cls =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
      ? "text-bronze-700"
      : "text-ink-700";
  return (
    <div className={`flex items-center gap-2 text-sm font-semibold ${cls}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function Pill({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: "green" | "bronze" | "rain";
  children: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? "bg-green-100 text-green-800"
      : tone === "bronze"
      ? "bg-bronze-100 text-bronze-700"
      : "bg-[hsl(var(--rain-bg))] text-[hsl(var(--rain))]";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full self-start ${cls}`}
    >
      {icon}
      {children}
    </span>
  );
}

function ToggleRow({
  label,
  icon,
  checked,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-900">
        {icon && <span className="text-ink-500">{icon}</span>}
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-10 rounded-full transition-colors ${
          checked ? "bg-green-700" : "bg-ink-200"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}
