import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TEMPLATES, applyMergeTags, type CampaignTemplate } from "./templates";

// Step 1 of the campaign wizard — operator picks one of six built-in
// templates (or "custom" for a blank slate). The right column shows a
// live merge-tag preview using a sample customer's first name and
// address.

interface Props {
  selectedKind: string;
  sampleFirstName: string;
  sampleAddress: string;
  businessName: string;
  bodyDraft: string;
  subjectDraft: string;
  onSelect: (t: CampaignTemplate) => void;
  onEditBody: (next: string) => void;
  onEditSubject: (next: string) => void;
}

export default function TemplatePicker({
  selectedKind,
  sampleFirstName,
  sampleAddress,
  businessName,
  bodyDraft,
  subjectDraft,
  onSelect,
  onEditBody,
  onEditSubject,
}: Props) {
  // Preview is the body with merge tags applied — what the customer
  // actually sees, modulo per-channel transforms (email HTML escape,
  // SMS trim) which happen server-side.
  const preview = useMemo(
    () =>
      applyMergeTags(bodyDraft, {
        first_name: sampleFirstName || "Pat",
        address: sampleAddress || "123 Maple St",
        business_name: businessName || "your lawn crew",
      }),
    [bodyDraft, sampleFirstName, sampleAddress, businessName],
  );
  const subjectPreview = useMemo(
    () =>
      applyMergeTags(subjectDraft, {
        first_name: sampleFirstName || "Pat",
        address: sampleAddress || "123 Maple St",
        business_name: businessName || "your lawn crew",
      }),
    [subjectDraft, sampleFirstName, sampleAddress, businessName],
  );

  return (
    <div className="space-y-4">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">
        1. Pick a template
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {TEMPLATES.map((t) => {
          const Icon = t.icon;
          const active = t.kind === selectedKind;
          return (
            <button
              key={t.kind}
              type="button"
              onClick={() => onSelect(t)}
              className={cn(
                "tp-card text-left p-3 transition-all",
                active
                  ? "ring-2 ring-green-700 bg-green-50"
                  : "hover:bg-ink-100/30",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-7 w-7 rounded-lg grid place-items-center shrink-0",
                    active ? "bg-green-700 text-white" : "bg-bronze-100 text-bronze-700",
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-[13px] text-ink-900 truncate">
                    {t.label}
                  </div>
                  <div className="text-[10.5px] text-ink-500 uppercase tracking-wide tp-num">
                    {t.season}
                  </div>
                </div>
              </div>
              <div className="text-[11.5px] text-ink-500 leading-snug mt-1.5">
                {t.blurb}
              </div>
            </button>
          );
        })}
      </div>

      {/* Subject editor — only matters for email, but shown always so
          operators can fine-tune without re-picking a template. */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Subject (email)
        </label>
        <input
          type="text"
          value={subjectDraft}
          onChange={(e) => onEditSubject(e.target.value)}
          placeholder="An update from your lawn crew"
          className="mt-1 w-full h-10 px-3 rounded-xl border border-ink-200 bg-white text-[13.5px] font-medium text-ink-900 focus:outline-none focus:ring-2 focus:ring-green-700"
        />
      </div>

      {/* Body editor */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Message body
          </label>
          <div className="text-[10.5px] text-ink-500">
            Tags: <code className="tp-mono">{"{first_name}"}</code>{" "}
            <code className="tp-mono">{"{address}"}</code>{" "}
            <code className="tp-mono">{"{business_name}"}</code>
          </div>
        </div>
        <textarea
          value={bodyDraft}
          onChange={(e) => onEditBody(e.target.value)}
          rows={10}
          placeholder="Hi {first_name}, …"
          className="mt-1 w-full px-3 py-2 rounded-xl border border-ink-200 bg-white text-[13.5px] text-ink-900 font-medium leading-relaxed focus:outline-none focus:ring-2 focus:ring-green-700"
        />
        <div className="text-[11px] text-ink-500 mt-1 tp-num">
          {bodyDraft.length} chars
          {bodyDraft.length > 320 && (
            <span className="text-bronze-600 ml-2">
              · SMS will be trimmed to ~320 chars
            </span>
          )}
        </div>
      </div>

      {/* Preview pane */}
      <div className="tp-card p-3 bg-ink-100/30">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500">
          Preview for {sampleFirstName || "Pat"}
        </div>
        {subjectDraft && (
          <div className="mt-1 text-[12.5px] font-semibold text-ink-900">
            {subjectPreview}
          </div>
        )}
        <pre className="mt-1 text-[12.5px] text-ink-700 whitespace-pre-wrap font-sans leading-relaxed">
          {preview || "(empty)"}
        </pre>
      </div>
    </div>
  );
}
