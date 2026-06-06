import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Repeat,
  FileText,
  Home as HomeIcon,
  Pencil,
  Save,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Trash2,
  AlertTriangle,
  Plus,
  Activity,
} from "lucide-react";
import { NotesTimeline } from "@/components/customers/NotesTimeline";

// Ported from pressure-pro-quoter/src/pages/CustomerDetail.tsx with two key
// TurfPro changes:
//   1. Plans section is visually first — recurring is the lawn-care default.
//      (PressurePro buried plans beneath quotes because quotes were primary.)
//   2. Quotes section is collapsed by default — secondary in TurfPro.
// Theming swapped: navy/yellow -> green/bronze. AppShell is applied in App.tsx.

const DAY_LABELS: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  primary_address: string | null;
  notes: string | null;
  created_at: string;
}

interface PropertyRow {
  id: string;
  address: string;
  surface_notes: string | null;
  dog_warning: boolean;
  created_at: string;
}

interface PlanRow {
  id: string;
  status: string;
  amount: number;
  interval_months: number;
  address: string;
  // Below fields are added in supabase/migrations/0001_turfpro_lawn_care.sql
  // but not in the generated types yet — cast at point of use.
  day_of_week?: number | null;
  frequency?: string | null;
}

interface QuoteRow {
  id: string;
  status: string;
  total: number;
  created_at: string;
  address: string;
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [quotesOpen, setQuotesOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["customer-detail", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing id");
      const [{ data: c }, { data: props }, { data: plans }, { data: quotes }] = await Promise.all([
        supabase
          .from("customers")
          .select("id, name, phone, email, primary_address, notes, created_at")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("properties")
          .select("id, address, surface_notes, dog_warning, created_at")
          .eq("customer_id", id)
          .order("created_at", { ascending: false }),
        // day_of_week + frequency aren't in generated types yet — cast to any
        // so we can request the extra columns. See migration 0001.
        (supabase as any)
          .from("maintenance_plans")
          .select("id, status, amount, interval_months, address, day_of_week, frequency")
          .eq("customer_id", id),
        supabase
          .from("quotes")
          .select("id, status, total, created_at, address")
          .eq("customer_id", id)
          .order("created_at", { ascending: false }),
      ]);

      return {
        customer: (c as CustomerRow | null) ?? null,
        properties: (props ?? []) as PropertyRow[],
        plans: (plans ?? []) as PlanRow[],
        quotes: (quotes ?? []) as QuoteRow[],
      };
    },
    enabled: !!id,
  });

  const customer = data?.customer;

  // Initialize edit form when entering edit mode.
  const beginEdit = () => {
    if (!customer) return;
    setEditName(customer.name);
    setEditPhone(customer.phone ?? "");
    setEditEmail(customer.email ?? "");
    setEditAddress(customer.primary_address ?? "");
    setEditNotes(customer.notes ?? "");
    setSaveError(null);
    setEditing(true);
  };

  const saveCustomer = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Missing id");
      if (!editName.trim()) throw new Error("Name is required");
      const { error } = await supabase
        .from("customers")
        .update({
          name: editName.trim(),
          phone: editPhone.trim() || null,
          email: editEmail.trim() || null,
          primary_address: editAddress.trim() || null,
          notes: editNotes.trim() || null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditing(false);
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ["customer-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const deleteCustomer = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Missing id");
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      navigate("/customers");
    },
  });

  if (isLoading) {
    return <div className="pt-6 px-[22px] text-sm text-ink-500">Loading…</div>;
  }
  if (!customer) {
    return (
      <div className="pt-6 px-[22px]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-ink-500 inline-flex items-center gap-1.5 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="tp-card p-5 text-sm text-ink-700">Customer not found.</div>
      </div>
    );
  }

  const activePlans = data!.plans.filter((p) => p.status === "active");

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
              Customer · #{customer.id.slice(0, 4).toUpperCase()}
            </div>
            <h1 className="tp-display text-[26px] font-bold text-ink-900 mt-0.5 leading-tight">
              {customer.name}
            </h1>
            {customer.primary_address && (
              <div className="text-sm text-ink-500 mt-1 flex items-start gap-1.5">
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span className="truncate">{customer.primary_address}</span>
              </div>
            )}
          </div>
          {!editing && (
            <button
              type="button"
              onClick={beginEdit}
              className="h-10 px-3.5 rounded-[14px] border border-ink-200 bg-card text-ink-700 text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> Edit
            </button>
          )}
        </div>
      </header>

      {editing ? (
        /* Edit form */
        <section className="mx-4 mb-4">
          <div className="tp-card p-4 space-y-3">
            <EditField label="Name">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="tp-input"
              />
            </EditField>
            <EditField label="Phone">
              <input
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                inputMode="tel"
                className="tp-input"
              />
            </EditField>
            <EditField label="Email">
              <input
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                inputMode="email"
                className="tp-input"
              />
            </EditField>
            <EditField label="Primary address">
              <input
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                className="tp-input"
              />
            </EditField>
            <EditField label="Notes">
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                className="tp-input resize-none"
              />
            </EditField>
            {saveError && (
              <div className="text-xs font-semibold text-destructive">{saveError}</div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setSaveError(null);
                }}
                className="flex-1 h-11 rounded-[14px] bg-ink-100 text-ink-700 font-bold text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveCustomer.mutate()}
                disabled={saveCustomer.isPending}
                className="flex-1 h-11 rounded-[14px] bg-bronze-500 text-white font-bold text-sm shadow-bronze hover:bg-bronze-600 inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saveCustomer.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        /* Contact card */
        <section className="mx-4 mb-4">
          <div className="tp-card p-4 space-y-2">
            {customer.phone && (
              <a
                href={`tel:${customer.phone}`}
                className="flex items-center gap-2.5 text-sm active:bg-ink-100 rounded-lg -mx-1 px-1 py-1"
              >
                <div className="h-8 w-8 rounded-lg bg-green-100 text-green-800 flex items-center justify-center">
                  <Phone className="h-[16px] w-[16px]" />
                </div>
                <span className="font-semibold text-ink-900">{customer.phone}</span>
              </a>
            )}
            {customer.email && (
              <a
                href={`mailto:${customer.email}`}
                className="flex items-center gap-2.5 text-sm active:bg-ink-100 rounded-lg -mx-1 px-1 py-1"
              >
                <div className="h-8 w-8 rounded-lg bg-green-100 text-green-800 flex items-center justify-center">
                  <Mail className="h-[16px] w-[16px]" />
                </div>
                <span className="font-semibold text-ink-900 truncate">{customer.email}</span>
              </a>
            )}
            {!customer.phone && !customer.email && (
              <div className="text-sm text-ink-500">No contact info on file.</div>
            )}
            {customer.notes && (
              <p className="text-sm text-ink-700 leading-snug pt-1 border-t border-ink-200 mt-2">
                {customer.notes}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── PLANS (primary, first) ───────────────────────────────────────── */}
      <section className="mx-4 mb-4">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="tp-display text-[15px] font-bold text-ink-900 inline-flex items-center gap-1.5">
            <Repeat className="h-4 w-4 text-green-800" strokeWidth={2.2} />
            Plans
            <span className="text-ink-500 font-semibold text-xs ml-0.5">
              ({activePlans.length} active)
            </span>
          </h2>
          <Link
            to="/plans/new"
            className="text-xs font-bold text-green-800 inline-flex items-center gap-1"
          >
            <Plus className="h-3 w-3" strokeWidth={2.4} /> New
          </Link>
        </div>
        {data!.plans.length === 0 ? (
          <div className="tp-card p-4 text-sm text-ink-500">
            No plans yet. Recurring service is the TurfPro default — add a plan to put this
            customer on a route.
          </div>
        ) : (
          <div className="space-y-2">
            {data!.plans.map((p) => {
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
                    <div className="text-[11px] text-ink-500 truncate mt-0.5">
                      {p.address || "—"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="tp-display tp-num text-base font-bold text-ink-900">
                      {fmtUSD(Number(p.amount))}
                    </div>
                    <div className="text-[10px] text-ink-500">
                      every {p.interval_months} mo
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-400 shrink-0" strokeWidth={2.2} />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── PROPERTIES ───────────────────────────────────────────────────── */}
      <section className="mx-4 mb-4">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="tp-display text-[15px] font-bold text-ink-900 inline-flex items-center gap-1.5">
            <HomeIcon className="h-4 w-4 text-green-800" strokeWidth={2.2} />
            Properties
            <span className="text-ink-500 font-semibold text-xs ml-0.5">
              ({data!.properties.length})
            </span>
          </h2>
        </div>
        {data!.properties.length === 0 ? (
          <div className="tp-card p-4 text-sm text-ink-500">No properties yet.</div>
        ) : (
          <div className="space-y-2">
            {data!.properties.map((p) => (
              <Link
                key={p.id}
                to={`/properties/${p.id}`}
                className="tp-card p-3.5 flex items-center gap-3 active:bg-ink-100 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-ink-900 truncate">{p.address}</div>
                  {p.surface_notes && (
                    <div className="text-[11px] text-ink-500 truncate mt-0.5">
                      {p.surface_notes}
                    </div>
                  )}
                </div>
                {p.dog_warning && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-destructive/10 text-destructive px-2 py-0.5 rounded-full">
                    <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.4} /> Dog
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-ink-400 shrink-0" strokeWidth={2.2} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── QUOTES (collapsed by default — secondary in TurfPro) ─────────── */}
      <section className="mx-4 mb-4">
        <button
          type="button"
          onClick={() => setQuotesOpen((o) => !o)}
          className="w-full flex items-center justify-between px-1 pb-2 text-left"
          aria-expanded={quotesOpen}
        >
          <h2 className="tp-display text-[15px] font-bold text-ink-900 inline-flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-bronze-600" strokeWidth={2.2} />
            Quotes
            <span className="text-ink-500 font-semibold text-xs ml-0.5">
              ({data!.quotes.length})
            </span>
          </h2>
          <div className="inline-flex items-center gap-3">
            <Link
              to={`/quotes/new?customer=${customer.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-bold text-bronze-600 inline-flex items-center gap-1"
            >
              <Plus className="h-3 w-3" strokeWidth={2.4} /> New quote
            </Link>
            {quotesOpen ? (
              <ChevronUp className="h-4 w-4 text-ink-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-ink-500" />
            )}
          </div>
        </button>
        {quotesOpen &&
          (data!.quotes.length === 0 ? (
            <div className="tp-card p-4 text-sm text-ink-500">No quotes yet.</div>
          ) : (
            <div className="space-y-2">
              {data!.quotes.slice(0, 10).map((q) => (
                <div
                  key={q.id}
                  className="tp-card p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink-900">
                      {new Date(q.created_at).toLocaleDateString()}
                    </div>
                    <div className="text-[11px] text-ink-500 truncate">
                      {q.address || "—"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="tp-display tp-num text-base font-bold text-ink-900">
                      {fmtUSD(Number(q.total))}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-ink-500">
                      {q.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </section>

      {/* ── ACTIVITY (unified notes timeline) ───────────────────────────── */}
      <section className="mx-4 mb-4">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="tp-display text-[15px] font-bold text-ink-700 inline-flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-green-800" strokeWidth={2.2} />
            Activity
          </h2>
        </div>
        <NotesTimeline customer_id={customer.id} />
      </section>

      <button
        type="button"
        onClick={() => {
          if (confirm("Delete this customer? This cannot be undone.")) {
            deleteCustomer.mutate();
          }
        }}
        className="mx-4 mt-2 mb-6 w-[calc(100%-2rem)] text-destructive text-sm font-semibold py-3 flex items-center justify-center gap-2"
      >
        <Trash2 className="h-4 w-4" /> Delete customer
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

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

