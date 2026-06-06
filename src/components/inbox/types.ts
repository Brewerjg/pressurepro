// Shared types for the two-way SMS Inbox. Kept narrow — the Inbox UI is
// the only consumer right now, but pulling these into a shared file keeps
// the page component readable and lets ThreadRow / MessageBubble /
// ReplyBox import from a single canonical place.
//
// Why hand-rolled and not generated: public.sms_inbound was added in
// 0016_sms_inbox.sql and the supabase generated types in
// src/integrations/supabase/types.ts haven't been regenerated to include
// it. Same workaround pattern as Campaigns.tsx — cast at the boundary,
// type the rest of the app cleanly.

export interface InboundRow {
  id: string;
  user_id: string;
  customer_id: string | null;
  from_phone: string;
  to_phone: string;
  body: string;
  twilio_message_sid: string | null;
  received_at: string;
  read_at: string | null;
  created_at: string;
}

export interface OutboundRow {
  id: string;
  user_id: string;
  customer_id: string | null;
  kind: string;
  recipient_phone: string;
  body: string | null;
  twilio_message_sid: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

// One row in the thread list — synthesized from inbound rows grouped by
// customer (or by phone for unknown senders).
export interface ThreadSummary {
  // Either a real customer.id, or null for the synthetic
  // "Unknown senders" pseudo-thread.
  customerId: string | null;
  // Display name — customer.name when known, phone otherwise.
  displayName: string;
  // Resolved phone for the most recent inbound row in this thread —
  // used to surface "Unknown senders" subtitles + as the from_phone
  // when an inbound thread has no matched customer.
  fromPhone: string;
  // Preview = body of the most recent message in the thread (inbound or
  // outbound), trimmed to ~80 chars.
  preview: string;
  // ISO timestamp of the most recent message. Sort key for the list.
  lastActivityAt: string;
  // How many inbound rows in this thread have read_at IS NULL.
  unreadCount: number;
  // Direction of the most recent message — affects iconography.
  lastDirection: "inbound" | "outbound";
}

// A merged thread message (inbound + outbound flattened into one
// timeline). The thread view sorts these by `at` ascending.
export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  at: string;
  // For outbound, the status from sms_log (queued / sent / failed).
  // Inbound rows always have status='received'.
  status: "received" | "queued" | "sent" | "failed";
  // The outbound row's `error` column when status='failed' — surfaces
  // the underlying Twilio error in the bubble.
  error?: string | null;
  // True if this outbound row was held back by quiet-hours. The drainer
  // will pick it up; we still want to render it tinted.
  deferredByQuietHours?: boolean;
}
