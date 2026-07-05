import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Eye,
  Loader2,
  Megaphone,
  Plus,
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import TemplatePicker from "@/components/campaigns/TemplatePicker";
import AudienceStep, {
  type AudienceFilter,
} from "@/components/campaigns/AudienceStep";
import ChannelsStep from "@/components/campaigns/ChannelsStep";
import {
  TEMPLATES,
  type CampaignKind,
  type CampaignTemplate,
} from "@/components/campaigns/templates";
import { APP_ID } from "@/lib/app-context";

// Campaigns — the seasonal blast tool. List + wizard live on the same
// page; "view a draft" routes through the same wizard with prefilled
// state. Sent campaigns surface as a read-only summary.
//
// Data lives in public.campaigns (migration 0011). The send-campaign
// edge function does the actual fan-out and updates email_sent_count /
// sms_sent_count as it goes — we poll the row every few seconds while
// a send is in flight so the operator sees live progress.

// ----------------------------------------------------------------------
// Types — campaigns table isn't in the generated supabase types yet, so
// we model the columns locally and cast at the boundary.
// ----------------------------------------------------------------------
type CampaignStatus = "draft" | "queued" | "sending" | "sent" | "failed";

interface CampaignRow {
  id: string;
  user_id: string;
  name: string;
  kind: CampaignKind;
  channels: string[];
  subject: string | null;
  body: string;
  audience_filter: AudienceFilter;
  scheduled_at: string | null;
  sent_at: string | null;
  status: CampaignStatus;
  total_recipients: number;
  email_sent_count: number;
  sms_sent_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_STYLE: Record<CampaignStatus, { pill: string; stripe: string }> = {
  draft: { pill: "bg-neutral-100 text-neutral-700", stripe: "bg-neutral-400" },
  queued: { pill: "bg-accent-100 text-accent-700", stripe: "bg-accent-500" },
  sending: { pill: "bg-accent-100 text-accent-700", stripe: "bg-accent-500" },
  sent: { pill: "bg-brand-100 text-brand-800", stripe: "bg-brand-700" },
  failed: { pill: "bg-red-100 text-red-700", stripe: "bg-red-500" },
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

// ----------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------
export default function Campaigns() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // -------------------------------------------------------------------
  // List query — every campaign owned by the operator.
  // -------------------------------------------------------------------
  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["campaigns", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("campaigns")
        .select("*")
        .eq("app", APP_ID)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CampaignRow[];
    },
  });

  // -------------------------------------------------------------------
  // While editing, render the editor. Otherwise render the list + new
  // button. We keep the same component mounted (no router push) because
  // operators expect to bounce back to the list quickly.
  // -------------------------------------------------------------------
  if (editingId || creating) {
    return (
      <CampaignEditor
        campaignId={editingId}
        onClose={() => {
          setEditingId(null);
          setCreating(false);
          queryClient.invalidateQueries({ queryKey: ["campaigns", user?.id] });
        }}
      />
    );
  }

  return (
    <div className="pt-3 pb-8">
      {/* Header */}
      <header className="px-[22px] pb-[18px] flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-neutral-500">
            Outreach
          </div>
          <h1 className="tp-display text-2xl font-bold text-neutral-900 mt-0.5">
            Campaigns
          </h1>
          <div className="text-[12px] text-neutral-500 mt-1">
            Seasonal blasts — aeration, leaf cleanup, spring restart.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="h-10 px-3.5 rounded-full bg-accent-500 text-white flex items-center gap-1.5 font-semibold text-[13px] shadow-accent hover:bg-accent-600 transition-colors"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          New campaign
        </button>
      </header>

      {/* List */}
      <section className="mx-4 mb-3">
        {isLoading ? (
          <ul className="flex flex-col gap-2.5">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="tp-card p-3.5 h-[80px] animate-pulse bg-neutral-100"
              />
            ))}
          </ul>
        ) : (campaigns ?? []).length === 0 ? (
          <div className="tp-card p-6 text-center">
            <Megaphone
              className="h-7 w-7 mx-auto text-neutral-400"
              strokeWidth={1.7}
            />
            <p className="text-sm font-semibold text-neutral-900 mt-2">
              No campaigns yet.
            </p>
            <p className="text-xs text-neutral-500 mt-1 max-w-[280px] mx-auto">
              Aeration in August, leaf cleanup in October, spring restart in
              March. Pick a template and blast your customer list in two minutes.
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-accent-500 text-white text-[13px] font-semibold shadow-accent hover:bg-accent-600 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.4} />
              Start your first campaign
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {(campaigns ?? []).map((c) => (
              <CampaignRowItem
                key={c.id}
                campaign={c}
                onOpen={() => setEditingId(c.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Footer link back to Settings — same affordance as other surfaces */}
      <div className="px-[22px] pt-4">
        <Link
          to="/settings"
          className="text-[12px] font-semibold text-neutral-500 hover:text-neutral-700 inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2.2} />
          Back to Settings
        </Link>
      </div>
    </div>
  );
}

// =====================================================================
// List row
// =====================================================================
function CampaignRowItem({
  campaign,
  onOpen,
}: {
  campaign: CampaignRow;
  onOpen: () => void;
}) {
  const tone = STATUS_STYLE[campaign.status];
  const tplLabel =
    TEMPLATES.find((t) => t.kind === campaign.kind)?.label ?? campaign.kind;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="tp-card block p-3.5 w-full text-left active:scale-[0.99] transition-transform"
      >
        <div className="flex items-stretch gap-3">
          <div
            className={cn("w-1.5 rounded-[3px] self-stretch shrink-0", tone.stripe)}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-semibold text-[14px] text-neutral-900 truncate">
                {campaign.name || tplLabel}
              </div>
              <div className="tp-num font-bold text-[13px] text-neutral-700 shrink-0 inline-flex items-center gap-1">
                <Users className="h-3 w-3" strokeWidth={2.2} />
                {campaign.total_recipients.toLocaleString()}
              </div>
            </div>
            <div className="text-[11.5px] text-neutral-500 truncate mt-0.5">
              {tplLabel} · {campaign.channels.length === 0
                ? "no channels"
                : campaign.channels.join(" + ")}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span
                className={cn(
                  "px-2 py-[2px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px]",
                  tone.pill,
                )}
              >
                {campaign.status}
              </span>
              <div className="text-[11px] text-neutral-500 tp-num">
                {campaign.sent_at
                  ? `Sent ${fmtDate(campaign.sent_at)}`
                  : fmtDate(campaign.created_at)}
              </div>
            </div>
            {campaign.status === "sending" && (
              <div className="text-[11px] text-accent-700 mt-1 tp-num inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {campaign.email_sent_count + campaign.sms_sent_count} /{" "}
                {campaign.total_recipients} sent
              </div>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

// =====================================================================
// Editor — both "new" and "open existing draft" go through this.
// =====================================================================
function CampaignEditor({
  campaignId,
  onClose,
}: {
  campaignId: string | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Load the existing row when editing.
  const { data: existing, isLoading: existingLoading } = useQuery({
    queryKey: ["campaign", campaignId],
    enabled: !!campaignId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("campaigns")
        .select("*")
        .eq("id", campaignId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CampaignRow | null;
    },
  });

  // Business name + sample-customer for the preview pane. One shot, cached.
  const { data: previewCtx } = useQuery({
    queryKey: ["campaign-preview-context", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [{ data: prof }, { data: sample }] = await Promise.all([
        supabase
          .from("profiles")
          .select("business_name")
          .eq("user_id", user!.id)
          .maybeSingle(),
        supabase
          .from("customers")
          .select("name, primary_address")
          .eq("user_id", user!.id)
          .limit(1)
          .maybeSingle(),
      ]);
      const fname = (sample?.name as string | null)?.trim().split(/\s+/)[0] ?? "";
      return {
        businessName:
          (prof?.business_name as string | null) ?? "your lawn crew",
        sampleFirstName: fname || "Pat",
        sampleAddress:
          (sample?.primary_address as string | null) ?? "123 Maple St",
      };
    },
  });

  // Wizard state.
  const [kind, setKind] = useState<CampaignKind>("aeration");
  const [name, setName] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [filter, setFilter] = useState<AudienceFilter>({ preset: "all" });
  const [channels, setChannels] = useState<string[]>(["email"]);

  // Hydrate when an existing row loads.
  useEffect(() => {
    if (!existing) {
      // Default to the aeration template for a brand-new draft.
      const t = TEMPLATES[0];
      setKind(t.kind);
      setName(t.label);
      setSubject(t.subject);
      setBody(t.body);
      return;
    }
    setKind(existing.kind);
    setName(existing.name);
    setSubject(existing.subject ?? "");
    setBody(existing.body);
    setFilter(existing.audience_filter ?? { preset: "all" });
    setChannels(existing.channels ?? ["email"]);
  }, [existing]);

  const readOnly = existing?.status === "sent" || existing?.status === "sending";

  function applyTemplate(t: CampaignTemplate) {
    setKind(t.kind);
    setName(t.label);
    setSubject(t.subject);
    setBody(t.body);
  }

  // -------------------------------------------------------------------
  // Save / send mutations
  // -------------------------------------------------------------------
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const payload = {
        user_id: user.id,
        name: name || "Untitled campaign",
        kind,
        channels,
        subject: subject || null,
        body,
        audience_filter: filter,
      };
      if (existing) {
        const { error } = await (supabase as any)
          .from("campaigns")
          .update({ ...payload, status: "draft" })
          .eq("id", existing.id);
        if (error) throw error;
        return existing.id;
      }
      const { data, error } = await (supabase as any)
        .from("campaigns")
        .insert({ ...payload, status: "draft", app: APP_ID })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns", user?.id] });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      // Upsert the row first so we have an id to hand to the edge fn.
      const payload = {
        user_id: user.id,
        name: name || "Untitled campaign",
        kind,
        channels,
        subject: subject || null,
        body,
        audience_filter: filter,
        status: "queued" as CampaignStatus,
      };
      let id: string;
      if (existing) {
        const { error } = await (supabase as any)
          .from("campaigns")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
        id = existing.id;
      } else {
        const { data, error } = await (supabase as any)
          .from("campaigns")
          .insert({ ...payload, app: APP_ID })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id as string;
      }
      // Fire the edge fn. We await the response so the UI can flip to
      // 'sent' state synchronously — the function rate-limits internally
      // so a 100-recipient send takes ~20s, which is fine to await.
      const { data: result, error: fnErr } = await supabase.functions.invoke(
        "send-campaign",
        { body: { campaign_id: id } },
      );
      if (fnErr) throw fnErr;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns", user?.id] });
      onClose();
    },
  });

  const canSend = channels.length > 0 && body.trim().length > 0 && !readOnly;

  async function handleSend() {
    // Get a recipient-count preview before confirming. We re-run the
    // exact same count query the AudienceStep used.
    if (!user) return;
    const count = await previewCount(user.id, filter);
    const ok = window.confirm(
      `Send "${name || "this campaign"}" to ${count} customer${count === 1 ? "" : "s"} via ${channels.join(" + ")}?`,
    );
    if (!ok) return;
    sendMutation.mutate();
  }

  if (campaignId && existingLoading) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="pt-3 pb-12">
      <header className="px-[22px] pb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className="h-9 w-9 grid place-items-center rounded-full bg-neutral-100 hover:bg-neutral-200 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-neutral-500">
            {existing ? "Edit campaign" : "New campaign"}
          </div>
          <h1 className="tp-display text-xl font-bold text-neutral-900 mt-0.5 truncate">
            {name || "Untitled campaign"}
          </h1>
        </div>
      </header>

      {/* Sent / sending states render a read-only summary instead of the wizard. */}
      {readOnly && existing ? (
        <SentSummary campaign={existing} />
      ) : (
        <div className="mx-4 space-y-5">
          {/* Name */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Campaign name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full h-10 px-3 rounded-xl border border-neutral-200 bg-white text-[13.5px] font-medium text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-700"
              placeholder="Fall aeration 2026"
            />
          </div>

          {/* Step 1 — template + body */}
          <TemplatePicker
            selectedKind={kind}
            sampleFirstName={previewCtx?.sampleFirstName ?? "Pat"}
            sampleAddress={previewCtx?.sampleAddress ?? "123 Maple St"}
            businessName={previewCtx?.businessName ?? "your lawn crew"}
            bodyDraft={body}
            subjectDraft={subject}
            onSelect={applyTemplate}
            onEditBody={setBody}
            onEditSubject={setSubject}
          />

          {/* Step 2 — audience */}
          <AudienceStep filter={filter} onChange={setFilter} />

          {/* Step 3 — channels + actions */}
          <ChannelsStep channels={channels} onChange={setChannels} />

          {/* Action bar */}
          <div className="tp-card p-3 flex items-center gap-2 sticky bottom-2 bg-white shadow-lg">
            <button
              type="button"
              onClick={() => saveDraftMutation.mutate()}
              disabled={saveDraftMutation.isPending || sendMutation.isPending}
              className="h-10 px-3.5 rounded-xl border border-neutral-200 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              {saveDraftMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" strokeWidth={2.2} />
              )}
              Save draft
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend || sendMutation.isPending}
              className={cn(
                "flex-1 h-10 px-3.5 rounded-xl font-semibold text-[13px] inline-flex items-center justify-center gap-1.5 transition-colors",
                canSend
                  ? "bg-brand-700 text-white hover:bg-brand-800"
                  : "bg-neutral-200 text-neutral-500 cursor-not-allowed",
              )}
            >
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Send now
                </>
              )}
            </button>
          </div>

          {/* Save / send error surface */}
          {(saveDraftMutation.isError || sendMutation.isError) && (
            <div className="tp-card p-3 inline-flex items-start gap-2 border border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div className="text-[12px] text-red-700">
                {(sendMutation.error || saveDraftMutation.error) instanceof Error
                  ? (sendMutation.error || saveDraftMutation.error)!.message
                  : "Couldn't save the campaign"}
              </div>
            </div>
          )}

          {saveDraftMutation.isSuccess && !sendMutation.isPending && (
            <div className="tp-card p-3 inline-flex items-start gap-2 border border-brand-200 bg-brand-50">
              <Check className="h-4 w-4 text-brand-700 shrink-0 mt-0.5" />
              <div className="text-[12px] text-brand-800">Draft saved.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Read-only summary for sent / sending campaigns
// =====================================================================
function SentSummary({ campaign }: { campaign: CampaignRow }) {
  const tone = STATUS_STYLE[campaign.status];
  const tplLabel =
    TEMPLATES.find((t) => t.kind === campaign.kind)?.label ?? campaign.kind;
  return (
    <div className="mx-4 space-y-3">
      <div className="tp-card p-4">
        <div className="flex items-center justify-between">
          <span
            className={cn(
              "px-2 py-[3px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px]",
              tone.pill,
            )}
          >
            {campaign.status}
          </span>
          <div className="text-[11px] text-neutral-500 tp-num">
            {campaign.sent_at ? `Sent ${fmtDate(campaign.sent_at)}` : "—"}
          </div>
        </div>
        <div className="mt-3 text-[13px] text-neutral-700">
          <span className="font-semibold">{tplLabel}</span> ·{" "}
          {campaign.channels.join(" + ") || "no channels"}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <Stat
            label="Recipients"
            value={campaign.total_recipients.toLocaleString()}
          />
          <Stat
            label="Email sent"
            value={campaign.email_sent_count.toLocaleString()}
          />
          <Stat
            label="SMS sent"
            value={campaign.sms_sent_count.toLocaleString()}
          />
        </div>
        {campaign.error && (
          <div className="mt-3 text-[12px] text-red-700 inline-flex items-start gap-1.5">
            <X className="h-3.5 w-3.5 mt-0.5" /> {campaign.error}
          </div>
        )}
      </div>
      <div className="tp-card p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
          Body
        </div>
        {campaign.subject && (
          <div className="mt-1 text-[13px] font-semibold text-neutral-900">
            {campaign.subject}
          </div>
        )}
        <pre className="mt-1 text-[12.5px] text-neutral-700 whitespace-pre-wrap font-sans leading-relaxed">
          {campaign.body}
        </pre>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tp-card p-2 bg-neutral-100/30">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 font-bold">
        {label}
      </div>
      <div className="tp-num font-bold text-[16px] text-neutral-900">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Confirm-time recipient count. Re-runs the count queries from
// AudienceStep so what the operator confirms is what they get.
// ---------------------------------------------------------------------
async function previewCount(
  userId: string,
  filter: AudienceFilter,
): Promise<number> {
  if (filter.preset === "test_self") return 1;

  if (filter.preset === "all") {
    const { count } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    return count ?? 0;
  }

  if (filter.preset === "with_active_plan") {
    const { data } = await supabase
      .from("maintenance_plans")
      .select("customer_id")
      .eq("user_id", userId)
      .eq("app", APP_ID)
      .eq("status", "active")
      .not("customer_id", "is", null);
    const ids = new Set(
      ((data ?? []) as { customer_id: string | null }[])
        .map((r) => r.customer_id)
        .filter((x): x is string => !!x),
    );
    return ids.size;
  }

  if (filter.preset === "without_active_plan") {
    const [{ count: totalCount }, { data: planRows }] = await Promise.all([
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("maintenance_plans")
        .select("customer_id")
        .eq("user_id", userId)
        .eq("app", APP_ID)
        .eq("status", "active")
        .not("customer_id", "is", null),
    ]);
    const total = totalCount ?? 0;
    const withPlan = new Set(
      ((planRows ?? []) as { customer_id: string | null }[])
        .map((r) => r.customer_id)
        .filter((x): x is string => !!x),
    );
    return Math.max(0, total - withPlan.size);
  }

  if (filter.preset === "inactive_days") {
    const days = Math.max(1, Math.min(365, filter.days ?? 60));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString();
    const [{ count: totalCount }, { data: recentRows }] = await Promise.all([
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("route_stops")
        .select("customer_id")
        .eq("user_id", userId)
        .eq("status", "done")
        .gte("completed_at", cutoff)
        .not("customer_id", "is", null),
    ]);
    const total = totalCount ?? 0;
    const recent = new Set(
      ((recentRows ?? []) as { customer_id: string | null }[])
        .map((r) => r.customer_id)
        .filter((x): x is string => !!x),
    );
    return Math.max(0, total - recent.size);
  }

  return 0;
}

