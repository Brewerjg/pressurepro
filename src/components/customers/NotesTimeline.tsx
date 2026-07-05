import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { APP_ID } from "@/lib/app-context";
import {
  MapPin,
  Beaker,
  DollarSign,
  FileText,
  MessageSquare,
  Mail,
  CreditCard,
  StickyNote,
  type LucideIcon,
} from "lucide-react";

// NotesTimeline — unified chronological feed of everything we know about a
// single customer. Notes are scattered across half a dozen tables today:
//   - customers.notes               (operator's bulk note on the profile)
//   - route_stops.notes             (per-visit notes from the field)
//   - chemical_applications.notes   (compliance log entries)
//   - manual_payments.notes         (off-Stripe payments)
//   - quotes.notes                  (pre-sale notes)
//   - sms_log (outbound) / sms_inbound (inbound) / email_log (outbound)
//   - maintenance_plans.charge_history (Stripe charges, jsonb array)
//
// We fan out these reads in parallel (one Supabase call per source, 9 total)
// then merge + sort client-side. Cap at 50 most recent events to bound the
// DOM. The customer's own `customers.notes` is pinned to the top regardless
// of date so the operator's "primary note" is always visible.

interface NotesTimelineProps {
  customer_id: string;
}

type TimelineKind =
  | "customer_note"
  | "visit"
  | "chem"
  | "payment"
  | "quote"
  | "sms_out"
  | "sms_in"
  | "email"
  | "charge";

interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  // Used for sort. `null` means "pin to top" (customer.notes).
  date: string | null;
  title: string;
  // Optional secondary line — notes / body preview / subject.
  body?: string | null;
}

const ICON_FOR: Record<TimelineKind, LucideIcon> = {
  customer_note: StickyNote,
  visit: MapPin,
  chem: Beaker,
  payment: DollarSign,
  quote: FileText,
  sms_out: MessageSquare,
  sms_in: MessageSquare,
  email: Mail,
  charge: CreditCard,
};

// Tailwind tint per kind. Keeps the rows visually parsable when scrolling
// fast through a long feed.
const TINT_FOR: Record<TimelineKind, string> = {
  customer_note: "bg-accent-100 text-accent-600",
  visit: "bg-brand-100 text-brand-800",
  chem: "bg-brand-50 text-brand-800",
  payment: "bg-brand-100 text-brand-800",
  quote: "bg-accent-100 text-accent-600",
  sms_out: "bg-neutral-100 text-neutral-700",
  sms_in: "bg-brand-50 text-brand-800",
  email: "bg-neutral-100 text-neutral-700",
  charge: "bg-brand-100 text-brand-800",
};

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

function fmtRelDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

// JSONB charge_history rows. Loose typing because legacy entries may be
// missing fields (e.g. `status` was added later).
interface ChargeEntry {
  date?: string;
  amount?: number;
  status?: string;
}

export function NotesTimeline({ customer_id }: NotesTimelineProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["customer-timeline", customer_id],
    enabled: !!customer_id,
    queryFn: async () => {
      // Fan-out parallel reads. We use `(supabase as any)` for tables whose
      // generated types don't yet include all columns we touch (route_stops,
      // chemical_applications, sms_inbound).
      const sb = supabase as unknown as {
        from: (t: string) => any;
      };

      const [
        customerRes,
        stopsRes,
        chemRes,
        paymentsRes,
        quotesRes,
        smsOutRes,
        smsInRes,
        emailRes,
        plansRes,
      ] = await Promise.all([
        sb
          .from("customers")
          .select("notes, created_at")
          .eq("id", customer_id)
          .maybeSingle(),
        sb
          .from("route_stops")
          .select(
            "id, notes, services, completed_at, created_at, status, address_snapshot",
          )
          .eq("customer_id", customer_id)
          .eq("status", "done")
          .order("completed_at", { ascending: false })
          .limit(50),
        sb
          .from("chemical_applications")
          .select("id, product_name, applied_at, notes")
          .eq("customer_id", customer_id)
          .order("applied_at", { ascending: false })
          .limit(50),
        sb
          .from("manual_payments")
          .select("id, method, amount_cents, received_at, notes")
          .eq("customer_id", customer_id)
          .order("received_at", { ascending: false })
          .limit(50),
        sb
          .from("quotes")
          .select("id, status, total, created_at, notes")
          .eq("customer_id", customer_id)
          .eq("app", APP_ID)
          .order("created_at", { ascending: false })
          .limit(50),
        sb
          .from("sms_log")
          .select("id, body, kind, created_at, sent_at")
          .eq("customer_id", customer_id)
          .order("created_at", { ascending: false })
          .limit(50),
        sb
          .from("sms_inbound")
          .select("id, body, received_at")
          .eq("customer_id", customer_id)
          .order("received_at", { ascending: false })
          .limit(50),
        sb
          .from("email_log")
          .select("id, subject, kind, created_at, sent_at")
          .eq("customer_id", customer_id)
          .order("created_at", { ascending: false })
          .limit(50),
        // charge_history lives on each plan as a JSONB array; we need to
        // pull plans for this customer, then flatten in JS.
        sb
          .from("maintenance_plans")
          .select("id, charge_history")
          .eq("customer_id", customer_id)
          .eq("app", APP_ID),
      ]);

      const events: TimelineEvent[] = [];

      const customerRow = customerRes?.data as
        | { notes: string | null; created_at: string }
        | null;
      if (customerRow?.notes && customerRow.notes.trim()) {
        events.push({
          id: `customer-note-${customer_id}`,
          kind: "customer_note",
          // null date so this row pins to the top.
          date: null,
          title: "Customer note",
          body: customerRow.notes,
        });
      }

      for (const r of (stopsRes?.data ?? []) as Array<{
        id: string;
        notes: string | null;
        services: string[] | null;
        completed_at: string | null;
        created_at: string;
        address_snapshot: string | null;
      }>) {
        const when = r.completed_at ?? r.created_at;
        const svc = (r.services ?? []).join(", ");
        events.push({
          id: `visit-${r.id}`,
          kind: "visit",
          date: when,
          title: `Visit on ${fmtRelDate(when)}${svc ? ` — ${svc}` : ""}`,
          body: r.notes,
        });
      }

      for (const r of (chemRes?.data ?? []) as Array<{
        id: string;
        product_name: string;
        applied_at: string;
        notes: string | null;
      }>) {
        events.push({
          id: `chem-${r.id}`,
          kind: "chem",
          date: r.applied_at,
          title: `Applied ${r.product_name} on ${fmtRelDate(r.applied_at)}`,
          body: r.notes,
        });
      }

      for (const r of (paymentsRes?.data ?? []) as Array<{
        id: string;
        method: string;
        amount_cents: number;
        received_at: string;
        notes: string | null;
      }>) {
        events.push({
          id: `pay-${r.id}`,
          kind: "payment",
          date: r.received_at,
          title: `${r.method} payment of ${fmtUSD(r.amount_cents / 100)} on ${fmtRelDate(r.received_at)}`,
          body: r.notes,
        });
      }

      for (const r of (quotesRes?.data ?? []) as Array<{
        id: string;
        status: string;
        total: number;
        created_at: string;
        notes: string | null;
      }>) {
        events.push({
          id: `quote-${r.id}`,
          kind: "quote",
          date: r.created_at,
          title: `Quote ${r.status} — ${fmtUSD(Number(r.total))} on ${fmtRelDate(r.created_at)}`,
          body: r.notes,
        });
      }

      for (const r of (smsOutRes?.data ?? []) as Array<{
        id: string;
        body: string | null;
        kind: string;
        created_at: string;
        sent_at: string | null;
      }>) {
        const preview = (r.body ?? "").slice(0, 80);
        events.push({
          id: `sms-out-${r.id}`,
          kind: "sms_out",
          date: r.sent_at ?? r.created_at,
          title: `Texted: ${preview}${(r.body?.length ?? 0) > 80 ? "…" : ""}`,
        });
      }

      for (const r of (smsInRes?.data ?? []) as Array<{
        id: string;
        body: string;
        received_at: string;
      }>) {
        const preview = (r.body ?? "").slice(0, 80);
        events.push({
          id: `sms-in-${r.id}`,
          kind: "sms_in",
          date: r.received_at,
          title: `Customer texted: ${preview}${r.body.length > 80 ? "…" : ""}`,
        });
      }

      for (const r of (emailRes?.data ?? []) as Array<{
        id: string;
        subject: string | null;
        kind: string;
        created_at: string;
        sent_at: string | null;
      }>) {
        events.push({
          id: `email-${r.id}`,
          kind: "email",
          date: r.sent_at ?? r.created_at,
          title: `Emailed: ${r.subject ?? r.kind ?? "(no subject)"}`,
        });
      }

      for (const plan of (plansRes?.data ?? []) as Array<{
        id: string;
        charge_history: ChargeEntry[] | null;
      }>) {
        if (!Array.isArray(plan.charge_history)) continue;
        plan.charge_history.forEach((c, i) => {
          if (!c || typeof c !== "object") return;
          const amt = typeof c.amount === "number" ? fmtUSD(c.amount) : "—";
          events.push({
            id: `charge-${plan.id}-${i}`,
            kind: "charge",
            date: c.date ?? null,
            title: `${c.status ?? "charge"}: ${amt}`,
          });
        });
      }

      // Sort: pinned (null date) first, then date desc. Stable by id within
      // a tie so the order doesn't jitter between re-renders.
      events.sort((a, b) => {
        if (a.date === null && b.date !== null) return -1;
        if (b.date === null && a.date !== null) return 1;
        if (a.date === null && b.date === null) return a.id.localeCompare(b.id);
        return (b.date ?? "").localeCompare(a.date ?? "");
      });

      return events.slice(0, 50);
    },
  });

  if (isLoading) {
    return <div className="tp-card p-4 text-sm text-neutral-500">Loading activity…</div>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="tp-card p-4 text-sm text-neutral-500">
        No activity yet. Visits, payments, texts, emails, and notes will appear
        here as they happen.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {data.map((ev) => {
        const Icon = ICON_FOR[ev.kind];
        return (
          <li key={ev.id} className="tp-card p-3 flex items-start gap-3">
            <div
              className={
                "h-8 w-8 rounded-lg shrink-0 flex items-center justify-center " +
                TINT_FOR[ev.kind]
              }
            >
              <Icon className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-neutral-900 leading-snug">
                {ev.title}
              </div>
              {ev.body && (
                <div className="text-[12px] text-neutral-700 leading-snug mt-0.5 whitespace-pre-wrap">
                  {ev.body}
                </div>
              )}
            </div>
            {ev.date && (
              <div className="text-[10.5px] uppercase tracking-[0.4px] text-neutral-500 shrink-0 mt-0.5">
                {fmtRelDate(ev.date)}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default NotesTimeline;
