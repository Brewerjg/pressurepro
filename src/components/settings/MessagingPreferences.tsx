import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Info, Loader2, Mail, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { RESEND_ENABLED, TWILIO_ENABLED } from "@/lib/feature-flags";
import { vertical } from "@/vertical";

// MessagingPreferences — operator-facing toggles for the customer email +
// SMS comms layer. The columns live on public.user_settings (email in
// 0005_email_log.sql, SMS in 0008_sms.sql).
//
// Email toggles default to TRUE — opt-out is a deliberate action.
// SMS toggles default to FALSE — per-message cost + TCPA exposure mean
// every operator has to opt in deliberately, kind by kind.
//
// Layout: a per-kind grid row with side-by-side Email and SMS switches,
// plus a quiet-hours selector at the bottom that gates ALL SMS sends to
// a sane "contractor texting" window.

interface MessagingDraft {
  // Email — defaults true per 0005_email_log.sql
  send_on_the_way_email: boolean;
  send_completed_email: boolean;
  send_review_request_email: boolean;
  // SMS — defaults false per 0008_sms.sql
  send_on_the_way_sms: boolean;
  send_completed_sms: boolean;
  send_review_request_sms: boolean;
  // Quiet-hours window — defaults 8 / 20 per 0008_sms.sql
  sms_quiet_start_hour: number;
  sms_quiet_end_hour: number;
}

const defaultDraft: MessagingDraft = {
  send_on_the_way_email: true,
  send_completed_email: true,
  send_review_request_email: true,
  send_on_the_way_sms: false,
  send_completed_sms: false,
  send_review_request_sms: false,
  sms_quiet_start_hour: 8,
  sms_quiet_end_hour: 20,
};

// One row per template-kind. Each row exposes both email + SMS toggles.
// Plan confirmation is intentionally absent — it's a one-shot at plan
// creation and isn't operator-configurable today.
const ROWS: {
  kind: "on_the_way" | "completed" | "review_request";
  label: string;
  blurb: string;
  emailKey: keyof MessagingDraft;
  smsKey: keyof MessagingDraft;
}[] = [
  {
    kind: "on_the_way",
    label: "On the way",
    blurb:
      "Heads-up message when your crew is en route to a stop. SMS reads best here.",
    emailKey: "send_on_the_way_email",
    smsKey: "send_on_the_way_sms",
  },
  {
    kind: "completed",
    label: "Completed",
    blurb: vertical.copy.completedNotificationBlurb,
    emailKey: "send_completed_email",
    smsKey: "send_completed_sms",
  },
  {
    kind: "review_request",
    label: "Review request",
    blurb:
      "Ask for a quick review after the first completed visit. Email usually wins here.",
    emailKey: "send_review_request_email",
    smsKey: "send_review_request_sms",
  },
];

// Helpers for the hour pickers — 0..23, formatted as "8 am" / "8 pm".
const HOURS = Array.from({ length: 24 }, (_, i) => i);
function hourLabel(h: number): string {
  if (h === 0) return "12 am";
  if (h === 12) return "12 pm";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

export default function MessagingPreferences() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<MessagingDraft>(defaultDraft);
  const [savedFlash, setSavedFlash] = useState(false);

  // Read existing settings row. user_settings is a per-operator config
  // table; we cast to any because the new boolean + smallint columns
  // aren't in the generated types yet.
  const { data: settings, isLoading } = useQuery({
    queryKey: ["user-settings-messaging", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_settings")
        .select(
          [
            "send_on_the_way_email",
            "send_completed_email",
            "send_review_request_email",
            "send_on_the_way_sms",
            "send_completed_sms",
            "send_review_request_sms",
            "sms_quiet_start_hour",
            "sms_quiet_end_hour",
          ].join(", "),
        )
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Partial<MessagingDraft> | null;
    },
  });

  // Hydrate the draft once the query resolves. NULLs from older rows
  // fall back to the column-default semantics: email -> true, SMS -> false.
  useEffect(() => {
    if (!settings) {
      setDraft(defaultDraft);
      return;
    }
    setDraft({
      send_on_the_way_email: settings.send_on_the_way_email ?? true,
      send_completed_email: settings.send_completed_email ?? true,
      send_review_request_email: settings.send_review_request_email ?? true,
      send_on_the_way_sms: settings.send_on_the_way_sms ?? false,
      send_completed_sms: settings.send_completed_sms ?? false,
      send_review_request_sms: settings.send_review_request_sms ?? false,
      sms_quiet_start_hour: settings.sms_quiet_start_hour ?? 8,
      sms_quiet_end_hour: settings.sms_quiet_end_hour ?? 20,
    });
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (next: MessagingDraft) => {
      if (!user) throw new Error("Not signed in");
      // Update-then-insert pattern — avoids upsert when the underlying
      // row has other mandatory NOT NULLs we'd otherwise have to invent.
      const { data: existing } = await (supabase as any)
        .from("user_settings")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) {
        const { error } = await (supabase as any)
          .from("user_settings")
          .update(next)
          .eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("user_settings")
          .insert({ user_id: user.id, ...next });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["user-settings-messaging", user?.id],
      });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    },
  });

  // Optimistic flip — update local state, save in the background. We
  // don't roll back on error; next page-load reflects server truth.
  function applyDraft(next: MessagingDraft) {
    setDraft(next);
    saveMutation.mutate(next);
  }
  function toggleEmail(key: keyof MessagingDraft) {
    applyDraft({ ...draft, [key]: !draft[key] });
  }
  function toggleSms(key: keyof MessagingDraft) {
    applyDraft({ ...draft, [key]: !draft[key] });
  }
  function setQuietHour(field: "sms_quiet_start_hour" | "sms_quiet_end_hour", value: number) {
    applyDraft({ ...draft, [field]: value });
  }

  // Any SMS toggle on? Used to decide whether to show the "Twilio not
  // configured yet" notice. We always show the quiet-hours picker since
  // operators may want to set it before flipping SMS on.
  const anySmsOn =
    draft.send_on_the_way_sms ||
    draft.send_completed_sms ||
    draft.send_review_request_sms;

  return (
    <div className="tp-card p-4 space-y-3">
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading preferences…
        </div>
      ) : (
        <>
          {(RESEND_ENABLED || TWILIO_ENABLED) && (
            <p className="text-[12.5px] text-neutral-700 leading-relaxed">
              Pick which automatic customer messages go out and on which
              channel.
              {RESEND_ENABLED ? " Email is great for longer copy." : ""}
              {TWILIO_ENABLED
                ? " SMS is great for short, time-sensitive nudges like 'on the way.'"
                : ""}
            </p>
          )}

          {/* Column headers + per-kind toggle rows. The email column is
              hidden behind RESEND_ENABLED and the SMS column is hidden
              behind TWILIO_ENABLED — under the default flags both are
              off and the operator sends from their own apps via
              <MessageCustomerButton>. We render the whole grid only
              when at least one auto-send pipe is on. */}
          {(RESEND_ENABLED || TWILIO_ENABLED) && (
            <>
              <div
                className={cn(
                  "grid gap-3 items-center pt-1 pb-1 border-b border-neutral-100",
                  RESEND_ENABLED && TWILIO_ENABLED
                    ? "grid-cols-[1fr_auto_auto]"
                    : "grid-cols-[1fr_auto]",
                )}
              >
                <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                  Message
                </div>
                {RESEND_ENABLED && (
                  <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide w-12 text-center inline-flex items-center justify-center gap-1">
                    <Mail className="h-3 w-3" strokeWidth={2.2} />
                    Email
                  </div>
                )}
                {TWILIO_ENABLED && (
                  <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide w-12 text-center inline-flex items-center justify-center gap-1">
                    <MessageSquare className="h-3 w-3" strokeWidth={2.2} />
                    SMS
                  </div>
                )}
              </div>

              <div className="space-y-1">
                {ROWS.map((row) => (
                  <ChannelRow
                    key={row.kind}
                    label={row.label}
                    blurb={row.blurb}
                    emailOn={Boolean(draft[row.emailKey])}
                    smsOn={Boolean(draft[row.smsKey])}
                    onToggleEmail={() => toggleEmail(row.emailKey)}
                    onToggleSms={() => toggleSms(row.smsKey)}
                    disabled={saveMutation.isPending}
                    showEmail={RESEND_ENABLED}
                    showSms={TWILIO_ENABLED}
                  />
                ))}
              </div>
            </>
          )}

          {/* Under the mailto: deep-link model, customer emails come
              from the operator's own mail app — no Resend setup, no
              API keys to configure. Campaigns are the exception (they
              stay on Resend for fan-out scale). */}
          {!RESEND_ENABLED && (
            <div className="mt-3 px-3 py-2.5 rounded-xl bg-brand-50 border border-brand-100 text-[11.5px] text-neutral-700 leading-snug">
              Customer emails are sent from your own mail app — no setup
              required. Use the "Message customer" buttons inside each
              stop, quote, or plan to compose a pre-filled email and
              tap Send.
            </div>
          )}

          {/* Same story for SMS — operator's own phone is the transport,
              no Twilio dispatcher, no quiet-hours, no per-message cost. */}
          {!TWILIO_ENABLED && (
            <div className="mt-2 px-3 py-2.5 rounded-xl bg-brand-50 border border-brand-100 text-[11.5px] text-neutral-700 leading-snug">
              Customer texts are sent from your own phone via your
              Messages app — no setup required. Use the "Message
              customer" buttons inside each stop, quote, or plan to
              compose a pre-filled text and tap Send.
            </div>
          )}

          {/* Quiet hours — gates ALL SMS sends. Only meaningful when
              Twilio auto-send is on. */}
          {TWILIO_ENABLED && (
            <div className="pt-3 border-t border-neutral-100 space-y-2">
              <div className="text-[12px] font-semibold text-neutral-900 uppercase tracking-wide">
                SMS quiet hours
              </div>
              <p className="text-[11.5px] text-neutral-500 leading-snug">
                We'll only send SMS inside this window. Texts triggered
                outside the window are held back, so we don't ping a customer
                at 6am.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <HourSelect
                  label="From"
                  value={draft.sms_quiet_start_hour}
                  onChange={(h) => setQuietHour("sms_quiet_start_hour", h)}
                  disabled={saveMutation.isPending}
                />
                <span className="text-[12px] text-neutral-500">to</span>
                <HourSelect
                  label="To"
                  value={draft.sms_quiet_end_hour}
                  onChange={(h) => setQuietHour("sms_quiet_end_hour", h)}
                  disabled={saveMutation.isPending}
                />
              </div>
            </div>
          )}

          {/* Twilio-not-configured notice — shown only when at least one
              SMS toggle is on, because the operator may not have wired
              the Supabase project secrets yet. We can't actually check
              from the client; the message is intentionally soft. */}
          {TWILIO_ENABLED && anySmsOn && (
            <div className="mt-2 px-3 py-2 rounded-xl bg-accent-50 border border-accent-200 text-[11.5px] text-neutral-700 inline-flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-[2px] text-accent-500 shrink-0" strokeWidth={2} />
              <span>
                SMS will start delivering once Twilio is wired in your
                Supabase project secrets
                (<code className="font-mono text-[11px]">TWILIO_ACCOUNT_SID</code>,
                {" "}
                <code className="font-mono text-[11px]">TWILIO_AUTH_TOKEN</code>,
                {" "}
                <code className="font-mono text-[11px]">TWILIO_FROM_NUMBER</code>).
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1 min-h-[18px]">
            {savedFlash && (
              <span className="text-[11px] font-semibold text-brand-700 inline-flex items-center gap-1">
                <Mail className="h-3 w-3" strokeWidth={2.2} />
                Saved
              </span>
            )}
            {saveMutation.isError && (
              <span className="text-[11px] font-semibold text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {saveMutation.error instanceof Error
                  ? saveMutation.error.message
                  : "Couldn't save"}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

function ChannelRow({
  label,
  blurb,
  emailOn,
  smsOn,
  onToggleEmail,
  onToggleSms,
  disabled,
  showEmail = true,
  showSms = true,
}: {
  label: string;
  blurb: string;
  emailOn: boolean;
  smsOn: boolean;
  onToggleEmail: () => void;
  onToggleSms: () => void;
  disabled?: boolean;
  showEmail?: boolean;
  showSms?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 items-center py-2 border-t border-neutral-100 first:border-t-0",
        showEmail && showSms
          ? "grid-cols-[1fr_auto_auto]"
          : "grid-cols-[1fr_auto]",
      )}
    >
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-neutral-900">{label}</div>
        <div className="text-[11.5px] text-neutral-500 leading-snug">{blurb}</div>
      </div>
      {showEmail && (
        <MiniSwitch
          ariaLabel={`${label} email`}
          value={emailOn}
          onChange={onToggleEmail}
          disabled={disabled}
        />
      )}
      {showSms && (
        <MiniSwitch
          ariaLabel={`${label} SMS`}
          value={smsOn}
          onChange={onToggleSms}
          disabled={disabled}
        />
      )}
    </div>
  );
}

function MiniSwitch({
  ariaLabel,
  value,
  onChange,
  disabled,
}: {
  ariaLabel: string;
  value: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative shrink-0 h-6 w-11 rounded-full transition-colors disabled:opacity-60",
        value ? "bg-brand-700" : "bg-neutral-200",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          value ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function HourSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (h: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[12.5px] font-semibold text-neutral-900 disabled:opacity-60"
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {hourLabel(h)}
          </option>
        ))}
      </select>
    </label>
  );
}
