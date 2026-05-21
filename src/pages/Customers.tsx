import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Plus,
  Users as UsersIcon,
  Search,
  Phone,
  MapPin,
  X,
  ChevronRight,
  Repeat,
  FileText,
} from "lucide-react";

// Ported from pressure-pro-quoter/src/pages/Customers.tsx and rethemed for
// TurfPro (fairway green + bronze). AppShell is provided by App.tsx, so this
// page just renders its own content. Per-row counts show ACTIVE plans first
// (plans are the primary unit in TurfPro) and quotes second.

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  primary_address: string | null;
  created_at: string;
}

interface CustomerWithCounts extends CustomerRow {
  activePlans: number;
  activeQuotes: number;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
}

export default function Customers() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async (): Promise<CustomerWithCounts[]> => {
      const { data: rows, error: customersErr } = await supabase
        .from("customers")
        .select("id, name, phone, email, primary_address, created_at")
        .order("name");
      if (customersErr) throw customersErr;
      const list = (rows ?? []) as CustomerRow[];
      if (list.length === 0) return [];

      const ids = list.map((c) => c.id);

      // Two count queries. We pull customer_id + status and aggregate client-side
      // to avoid N+1 — small lists (typical operator has <500 customers).
      const [{ data: planRows }, { data: quoteRows }] = await Promise.all([
        supabase
          .from("maintenance_plans")
          .select("customer_id, status")
          .in("customer_id", ids),
        supabase
          .from("quotes")
          .select("customer_id, status")
          .in("customer_id", ids),
      ]);

      const planCounts = new Map<string, number>();
      for (const p of (planRows ?? []) as { customer_id: string | null; status: string }[]) {
        if (!p.customer_id) continue;
        if (p.status !== "active") continue;
        planCounts.set(p.customer_id, (planCounts.get(p.customer_id) ?? 0) + 1);
      }
      const quoteCounts = new Map<string, number>();
      for (const q of (quoteRows ?? []) as { customer_id: string | null; status: string }[]) {
        if (!q.customer_id) continue;
        // "active" quotes = anything not paid/declined/expired. Operator cares
        // about open business: sent / draft / accepted (pre-payment).
        if (["paid", "declined", "expired", "void", "cancelled"].includes(q.status)) continue;
        quoteCounts.set(q.customer_id, (quoteCounts.get(q.customer_id) ?? 0) + 1);
      }

      return list.map((c) => ({
        ...c,
        activePlans: planCounts.get(c.id) ?? 0,
        activeQuotes: quoteCounts.get(c.id) ?? 0,
      }));
    },
  });

  const createCustomer = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name required");
      if (!user) throw new Error("Not signed in");
      const { data, error: insertErr } = await supabase
        .from("customers")
        .insert({
          user_id: user.id,
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          primary_address: address.trim() || null,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      return data;
    },
    onSuccess: (data) => {
      setAdding(false);
      setName("");
      setPhone("");
      setEmail("");
      setAddress("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      if (data?.id) navigate(`/customers/${data.id}`);
    },
    onError: (err: Error) => setError(err.message),
  });

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = customers ?? [];
    return q
      ? list.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.phone?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.primary_address?.toLowerCase().includes(q),
        )
      : list;
  }, [customers, query]);

  // Alphabetical grouping keeps a long list scannable — same UX pattern as PP.
  const groups = useMemo(() => {
    const map = new Map<string, CustomerWithCounts[]>();
    for (const c of filtered) {
      const first = c.name.trim()[0]?.toUpperCase() ?? "#";
      const key = /[A-Z]/.test(first) ? first : "#";
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className="pt-3">
      {/* Header — matches Home.tsx spacing (px-[22px]) */}
      <header className="px-[22px] pb-[18px] flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            {customers?.length ?? 0} total
          </div>
          <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5">Customers</h1>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="h-11 w-11 rounded-[14px] bg-bronze-500 text-white flex items-center justify-center shadow-bronze hover:bg-bronze-600 transition-colors"
          aria-label="New customer"
        >
          <Plus className="h-[22px] w-[22px]" strokeWidth={2.4} />
        </button>
      </header>

      {/* Search */}
      <section className="mx-4 pb-3.5">
        <div className="relative">
          <Search className="h-[18px] w-[18px] absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone or address"
            className="w-full h-[46px] pl-10 pr-3.5 rounded-xl border-[1.5px] border-ink-200 bg-card text-[15px] font-medium outline-none focus:border-green-800 transition-colors"
          />
        </div>
      </section>

      {isLoading && (
        <div className="text-sm text-ink-500 text-center py-6">Loading…</div>
      )}

      {!isLoading && filtered.length === 0 && (
        <section className="mx-4">
          <div className="tp-card p-8 text-center">
            <UsersIcon className="h-10 w-10 mx-auto text-ink-400" strokeWidth={1.6} />
            <h3 className="tp-display text-lg mt-3 text-ink-900">
              {query ? "No matches" : "No customers yet"}
            </h3>
            <p className="text-sm text-ink-500 mt-1">
              {query
                ? "Try a different search."
                : "No customers yet — add your first to track properties, plans, and routes."}
            </p>
            {!query && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 mt-4 bg-bronze-500 text-white px-5 py-2.5 rounded-full font-bold text-sm shadow-bronze hover:bg-bronze-600 transition-colors"
              >
                <Plus className="h-4 w-4" strokeWidth={2.4} /> Add customer
              </button>
            )}
          </div>
        </section>
      )}

      <section className="mx-4 space-y-2">
        {groups.map(([letter, rows]) => (
          <div key={letter}>
            <div className="px-1 py-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-500">
              {letter}
            </div>
            <div className="tp-card p-0 overflow-hidden">
              {rows.map((c, i) => (
                <Link
                  key={c.id}
                  to={`/customers/${c.id}`}
                  className={`flex items-center gap-3 p-3 active:bg-ink-100 transition-colors ${
                    i ? "border-t border-ink-200" : ""
                  }`}
                >
                  <div className="h-9 w-9 rounded-[10px] bg-green-100 text-green-800 flex items-center justify-center font-extrabold text-xs">
                    {initials(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-ink-900 truncate">{c.name}</div>
                    <div className="text-[11px] text-ink-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {c.phone && (
                        <span className="flex items-center gap-1 truncate">
                          <Phone className="h-3 w-3 shrink-0" />
                          {c.phone}
                        </span>
                      )}
                      {c.primary_address && (
                        <>
                          {c.phone && <span aria-hidden>·</span>}
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {c.primary_address}
                          </span>
                        </>
                      )}
                    </div>
                    {(c.activePlans > 0 || c.activeQuotes > 0) && (
                      <div className="flex items-center gap-1.5 mt-1">
                        {c.activePlans > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-green-100 text-green-800 px-1.5 py-0.5 rounded-full">
                            <Repeat className="h-2.5 w-2.5" strokeWidth={2.2} />
                            {c.activePlans} plan{c.activePlans === 1 ? "" : "s"}
                          </span>
                        )}
                        {c.activeQuotes > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-bronze-100 text-bronze-700 px-1.5 py-0.5 rounded-full">
                            <FileText className="h-2.5 w-2.5" strokeWidth={2.2} />
                            {c.activeQuotes} quote{c.activeQuotes === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-400" strokeWidth={2.2} />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="h-6" />

      {adding && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center"
          onClick={() => setAdding(false)}
        >
          <div
            className="bg-card rounded-t-3xl w-full max-w-md p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="tp-display text-xl text-ink-900">New customer</h3>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="p-1 text-ink-500"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name *"
              className="tp-modal-input"
              autoFocus
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              inputMode="tel"
              className="tp-modal-input"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              inputMode="email"
              className="tp-modal-input"
            />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Primary address"
              className="tp-modal-input"
            />
            {error && (
              <div className="text-xs font-semibold text-destructive">{error}</div>
            )}
            <button
              type="button"
              onClick={() => createCustomer.mutate()}
              disabled={createCustomer.isPending}
              className="w-full h-12 rounded-2xl bg-bronze-500 text-white font-bold shadow-bronze hover:bg-bronze-600 disabled:opacity-60 transition-colors"
            >
              {createCustomer.isPending ? "Saving…" : "Add customer"}
            </button>
          </div>
        </div>
      )}

      <style>{`
        .tp-modal-input {
          width: 100%;
          height: 46px;
          padding: 0 14px;
          border-radius: 12px;
          border: 1.5px solid hsl(var(--ink-200));
          background: hsl(var(--card));
          color: hsl(var(--ink-900));
          font-size: 15px;
          font-weight: 500;
          outline: none;
          transition: border-color 0.15s;
        }
        .tp-modal-input:focus { border-color: hsl(var(--green-800)); }
      `}</style>
    </div>
  );
}
