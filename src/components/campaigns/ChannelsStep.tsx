import { Mail, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

// Step 3 — channels picker. At least one must be checked; the page
// disables "Send now" until that's true.

interface Props {
  channels: string[];
  onChange: (next: string[]) => void;
}

export default function ChannelsStep({ channels, onChange }: Props) {
  const has = (k: string) => channels.includes(k);
  function toggle(k: string) {
    onChange(has(k) ? channels.filter((c) => c !== k) : [...channels, k]);
  }

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-neutral-500">
        3. Channels
      </div>
      <p className="text-[12.5px] text-neutral-500 leading-relaxed">
        Pick at least one. SMS auto-trims to ~320 chars; email keeps the
        full body. Recipients missing the corresponding contact info are
        skipped silently.
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <ChannelCard
          active={has("email")}
          onClick={() => toggle("email")}
          icon={<Mail className="h-5 w-5" strokeWidth={2} />}
          label="Email"
          blurb="Long-form. Subject line shows."
        />
        <ChannelCard
          active={has("sms")}
          onClick={() => toggle("sms")}
          icon={<MessageSquare className="h-5 w-5" strokeWidth={2} />}
          label="SMS"
          blurb="Short + immediate. Body only."
        />
      </div>
    </div>
  );
}

function ChannelCard({
  active,
  onClick,
  icon,
  label,
  blurb,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tp-card p-3 text-left transition-all",
        active ? "ring-2 ring-brand-700 bg-brand-50" : "hover:bg-neutral-100/30",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "h-9 w-9 rounded-lg grid place-items-center shrink-0",
            active ? "bg-brand-700 text-white" : "bg-accent-100 text-accent-700",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-[14px] text-neutral-900">{label}</div>
          <div className="text-[11.5px] text-neutral-500">{blurb}</div>
        </div>
      </div>
    </button>
  );
}
