import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Inbox as InboxIcon, MessageSquare, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import ThreadRow from "@/components/inbox/ThreadRow";
import MessageBubble from "@/components/inbox/MessageBubble";
import ReplyBox from "@/components/inbox/ReplyBox";
import type {
  InboundRow,
  OutboundRow,
  ThreadMessage,
  ThreadSummary,
} from "@/components/inbox/types";

// Two-way SMS Inbox.
//
// Two-pane layout:
//   - /inbox        → thread list (one row per customer or pseudo-thread
//                     for unknown senders), most-recently-active first.
//   - /inbox/:cid   → thread view for one customer (or "unknown" for
//                     the unmatched-phone pseudo-thread). Merged inbound
//                     + outbound timeline + reply box.
//
// We render a single column at all sizes — TurfPro is mobile-first
// (max-w-md AppShell), so the list and thread don't sit side-by-side
// even on desktop. Navigation between them is just route changes.
//
// Read state: opening a thread marks every inbound row in it with
// read_at=now() (single UPDATE), then invalidates the unread-count query
// so the header badge clears.
//
// Threading data sources:
//   inbound  ← public.sms_inbound       (0016_sms_inbox.sql)
//   outbound ← public.sms_log           (0008_sms.sql)
// Neither is in the generated supabase types yet — we cast at the
// boundary (mirrors the pattern in Campaigns.tsx).
//
// TODO(home-bell): Home.tsx currently shows a static red dot on the
// notification bell. Wiring it to the inbox unread count is a follow-up
// — touching Home.tsx is intentionally out of scope for this PR.

const UNKNOWN_KEY = "unknown";

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// Trim a body for the preview row, collapsing whitespace and cutting at
// a reasonable display width.
function previewText(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 80 ? t.slice(0, 77) + "…" : t;
}

// Best-effort phone normalization for inbound→customer matching at the
// client. (The webhook does this server-side too, but for client-side
// fallback we keep a copy.)
const E164_RE = /^\+[1-9]\d{7,14}$/;
const US10_RE = /^\d{10}$/;
function normalizePhone(s: string | null | undefined): string | null {
  if (!s) return null;
  const cleaned = s.replace(/[\s\-().]/g, "");
  if (E164_RE.test(cleaned)) return cleaned;
  if (US10_RE.test(cleaned)) return `+1${cleaned}`;
  return null;
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------
export default function Inbox() {
  const { customerId } = useParams<{ customerId?: string }>();
  const { user } = useAuth();

  if (customerId) {
    return <ThreadView customerId={customerId} userId={user?.id ?? null} />;
  }
  return <ThreadList userId={user?.id ?? null} />;
}

// =====================================================================
// Thread list
// =====================================================================
function ThreadList({ userId }: { userId: string | null }) {
  // Pull recent inbound for this user. We cap to the most recent 500 —
  // good enough for v1; a paged feed is a future ask.
  const { data: inbound, isLoading: loadingInbound } = useQuery({
    queryKey: ["sms_inbound_list", userId],
    enabled: !!userId,
    queryFn: async (): Promise<InboundRow[]> => {
      const { data, error } = await (supabase as any)
        .from("sms_inbound")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as InboundRow[];
    },
  });

  // Pull recent outbound for this user from sms_log so the list preview
  // can reflect "we just sent ..." even on threads with no inbound.
  const { data: outbound, isLoading: loadingOutbound } = useQuery({
    queryKey: ["sms_outbound_list", userId],
    enabled: !!userId,
    queryFn: async (): Promise<OutboundRow[]> => {
      const { data, error } = await (supabase as any)
        .from("sms_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as OutboundRow[];
    },
  });

  // Pull customer names for any inbound/outbound rows that reference one.
  const customerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of inbound ?? []) if (r.customer_id) ids.add(r.customer_id);
    for (const r of outbound ?? []) if (r.customer_id) ids.add(r.customer_id);
    return Array.from(ids);
  }, [inbound, outbound]);

  const { data: customers } = useQuery({
    queryKey: ["sms_thread_customers", customerIds.sort().join(",")],
    enabled: customerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone")
        .in("id", customerIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name: string;
        phone: string | null;
      }>;
    },
  });

  const customerById = useMemo(() => {
    const m = new Map<string, { id: string; name: string; phone: string | null }>();
    for (const c of customers ?? []) m.set(c.id, c);
    return m;
  }, [customers]);

  // Synthesize the thread summaries. Threads are keyed by:
  //   * customer_id when known
  //   * UNKNOWN_KEY for the bucket of inbound rows with no match
  //
  // Outbound rows with a customer_id contribute to the preview/sort-key
  // but never to the unread badge.
  const threads = useMemo<ThreadSummary[]>(() => {
    type Acc = {
      customerId: string | null;
      displayName: string;
      fromPhone: string;
      lastBody: string;
      lastAt: string;
      lastDirection: "inbound" | "outbound";
      unread: number;
    };
    const acc = new Map<string, Acc>();

    const touch = (
      key: string,
      direction: "inbound" | "outbound",
      body: string,
      at: string,
      customerId: string | null,
      displayName: string,
      fromPhone: string,
      isUnread: boolean,
    ) => {
      const existing = acc.get(key);
      if (!existing) {
        acc.set(key, {
          customerId,
          displayName,
          fromPhone,
          lastBody: body,
          lastAt: at,
          lastDirection: direction,
          unread: isUnread ? 1 : 0,
        });
        return;
      }
      if (new Date(at).getTime() > new Date(existing.lastAt).getTime()) {
        existing.lastBody = body;
        existing.lastAt = at;
        existing.lastDirection = direction;
      }
      if (isUnread) existing.unread += 1;
    };

    for (const r of inbound ?? []) {
      const cust = r.customer_id ? customerById.get(r.customer_id) : null;
      if (cust) {
        touch(
          cust.id,
          "inbound",
          r.body,
          r.received_at,
          cust.id,
          cust.name,
          r.from_phone,
          r.read_at === null,
        );
      } else {
        // Unknown senders all funnel into one pseudo-thread so the
        // operator can triage them without 17 separate rows for the same
        // wrong-number spammer. Within the thread view we still show
        // each message with its from_phone for context.
        touch(
          UNKNOWN_KEY,
          "inbound",
          r.body,
          r.received_at,
          null,
          "Unknown senders",
          r.from_phone,
          r.read_at === null,
        );
      }
    }

    for (const r of outbound ?? []) {
      if (!r.customer_id) continue; // outbound with no customer can't be threaded
      const cust = customerById.get(r.customer_id);
      if (!cust) continue;
      touch(
        cust.id,
        "outbound",
        r.body ?? "",
        r.sent_at ?? r.created_at,
        cust.id,
        cust.name,
        cust.phone ?? "",
        false,
      );
    }

    const list: ThreadSummary[] = Array.from(acc.values()).map((a) => ({
      customerId: a.customerId,
      displayName: a.displayName,
      fromPhone: a.fromPhone,
      preview: previewText(a.lastBody),
      lastActivityAt: a.lastAt,
      unreadCount: a.unread,
      lastDirection: a.lastDirection,
    }));
    // Most recent activity first.
    list.sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() -
        new Date(a.lastActivityAt).getTime(),
    );
    return list;
  }, [inbound, outbound, customerById]);

  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0);
  const loading = loadingInbound || loadingOutbound;

  return (
    <div className="pt-3">
      <header className="px-[22px] pb-[18px] flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            {totalUnread > 0
              ? `${totalUnread} unread`
              : `${threads.length} thread${threads.length === 1 ? "" : "s"}`}
          </div>
          <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5">
            Inbox
          </h1>
        </div>
      </header>

      {loading && (
        <div className="text-sm text-ink-500 text-center py-6">Loading…</div>
      )}

      {!loading && threads.length === 0 && (
        <section className="mx-4">
          <div className="tp-card p-8 text-center">
            <InboxIcon
              className="h-10 w-10 mx-auto text-ink-400"
              strokeWidth={1.6}
            />
            <h3 className="tp-display text-lg mt-3 text-ink-900">
              No messages yet
            </h3>
            <p className="text-sm text-ink-500 mt-1">
              Customer replies to your texts show up here. You can send a
              new SMS from a customer's detail page or from RouteMode.
            </p>
          </div>
        </section>
      )}

      {!loading && threads.length > 0 && (
        <section className="mx-4">
          <div className="tp-card p-0 overflow-hidden">
            {threads.map((t, i) => (
              <ThreadRow
                key={t.customerId ?? UNKNOWN_KEY}
                thread={t}
                isFirst={i === 0}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// =====================================================================
// Thread view
// =====================================================================
function ThreadView({
  customerId,
  userId,
}: {
  customerId: string;
  userId: string | null;
}) {
  const queryClient = useQueryClient();
  const isUnknown = customerId === UNKNOWN_KEY;

  // Customer detail (name + phone) for matched threads.
  const { data: customer } = useQuery({
    queryKey: ["sms_thread_customer", customerId],
    enabled: !!userId && !isUnknown,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone")
        .eq("id", customerId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as
        | { id: string; name: string; phone: string | null }
        | null;
    },
  });

  // Inbound rows for this thread. Unknown thread → all unmatched rows.
  const { data: inbound, isLoading: loadingInbound } = useQuery({
    queryKey: ["sms_thread_inbound", customerId, userId],
    enabled: !!userId,
    queryFn: async (): Promise<InboundRow[]> => {
      let q = (supabase as any)
        .from("sms_inbound")
        .select("*")
        .order("received_at", { ascending: true });
      if (isUnknown) {
        q = q.is("customer_id", null);
      } else {
        q = q.eq("customer_id", customerId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InboundRow[];
    },
  });

  // Outbound rows for this thread. Unknown thread → none (we never send
  // outbound to "unknown"; there's nothing to link a log row to).
  const { data: outbound, isLoading: loadingOutbound } = useQuery({
    queryKey: ["sms_thread_outbound", customerId, userId],
    enabled: !!userId && !isUnknown,
    queryFn: async (): Promise<OutboundRow[]> => {
      const { data, error } = await (supabase as any)
        .from("sms_log")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OutboundRow[];
    },
  });

  // Merge + sort.
  const messages = useMemo<ThreadMessage[]>(() => {
    const list: ThreadMessage[] = [];
    for (const r of inbound ?? []) {
      list.push({
        id: `in_${r.id}`,
        direction: "inbound",
        body: r.body,
        at: r.received_at,
        status: "received",
      });
    }
    for (const r of outbound ?? []) {
      list.push({
        id: `out_${r.id}`,
        direction: "outbound",
        body: r.body ?? "",
        at: r.sent_at ?? r.created_at,
        status: (r.status as ThreadMessage["status"]) ?? "sent",
        error: r.error,
        deferredByQuietHours:
          r.status === "queued" && r.error === "quiet_hours",
      });
    }
    list.sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    return list;
  }, [inbound, outbound]);

  // Mark-as-read mutation. Fires on first render when there are unread
  // inbound rows.
  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await (supabase as any)
        .from("sms_inbound")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      // Invalidate the list query so the unread badges refresh.
      queryClient.invalidateQueries({ queryKey: ["sms_inbound_list"] });
      queryClient.invalidateQueries({ queryKey: ["sms_thread_inbound"] });
    },
  });

  // Run mark-as-read once per thread load when we see any unread rows.
  useEffect(() => {
    if (!inbound) return;
    const unreadIds = inbound.filter((r) => r.read_at === null).map((r) => r.id);
    if (unreadIds.length > 0) {
      markRead.mutate(unreadIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbound]);

  const loading = loadingInbound || (!isUnknown && loadingOutbound);

  // Resolve recipient details for the reply box.
  const replyPhone = isUnknown
    ? null
    : customer?.phone
      ? normalizePhone(customer.phone) ?? customer.phone
      : null;
  const replyName = isUnknown ? null : customer?.name ?? null;

  return (
    <div className="pt-3 flex flex-col min-h-[calc(100vh-7rem)]">
      <header className="px-[22px] pb-3 flex items-center gap-3">
        <Link
          to="/inbox"
          aria-label="Back to inbox"
          className="h-9 w-9 rounded-full bg-ink-100 text-ink-700 flex items-center justify-center hover:bg-ink-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2.4} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="tp-display text-lg font-bold text-ink-900 truncate">
            {isUnknown ? "Unknown senders" : customer?.name ?? "Loading…"}
          </h1>
          {!isUnknown && customer?.phone && (
            <Link
              to={`/customers/${customer.id}`}
              className="text-[11px] text-ink-500 flex items-center gap-1 hover:text-ink-700 transition-colors"
            >
              <Phone className="h-3 w-3" strokeWidth={2} />
              {customer.phone}
            </Link>
          )}
          {isUnknown && (
            <div className="text-[11px] text-ink-500">
              Replies from phones not matched to a customer.
            </div>
          )}
        </div>
      </header>

      {loading && (
        <div className="text-sm text-ink-500 text-center py-6">Loading…</div>
      )}

      {!loading && messages.length === 0 && (
        <section className="mx-4 mb-3">
          <div className="tp-card p-6 text-center">
            <MessageSquare
              className="h-8 w-8 mx-auto text-ink-400"
              strokeWidth={1.6}
            />
            <p className="text-sm text-ink-500 mt-2">
              No messages in this thread yet.
            </p>
          </div>
        </section>
      )}

      <section className="mx-4 flex-1 space-y-2 pb-3">
        {messages.map((m) => {
          const inboundRow =
            m.direction === "inbound"
              ? inbound?.find((r) => `in_${r.id}` === m.id)
              : null;
          return (
            <div key={m.id} className="space-y-0.5">
              {isUnknown && inboundRow && (
                <div className="text-[10px] text-ink-500 px-2 tp-num">
                  from {inboundRow.from_phone}
                </div>
              )}
              <MessageBubble message={m} />
            </div>
          );
        })}
      </section>

      {/* Reply box. Unknown-sender threads can't be replied to because the
          sender isn't tied to a customers row — we'd be sending to an
          unverified phone with no STOP-list checking. */}
      <section className="mx-4 sticky bottom-3">
        {isUnknown ? (
          <div className="tp-card p-3 text-[12px] text-ink-500 text-center">
            Match this number to a customer to reply.
          </div>
        ) : (
          <ReplyBox
            customerId={customer?.id ?? null}
            recipientPhone={replyPhone}
            recipientName={replyName}
            onSent={() => {
              queryClient.invalidateQueries({
                queryKey: ["sms_thread_outbound", customerId],
              });
              queryClient.invalidateQueries({
                queryKey: ["sms_outbound_list"],
              });
            }}
          />
        )}
      </section>
    </div>
  );
}
