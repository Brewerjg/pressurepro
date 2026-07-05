interface Props {
  title: string;
  mockup: string;
  note?: string;
}

export default function PagePlaceholder({ title, mockup, note }: Props) {
  return (
    <div className="pt-4 px-[22px]">
      <div className="text-xs font-medium tracking-[0.4px] uppercase text-neutral-500">Not built yet</div>
      <h1 className="tp-display text-[28px] font-bold mb-5">{title}</h1>

      <div className="tp-card p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-600 mb-2">
          Mockup ready
        </div>
        <code className="tp-mono text-xs text-neutral-700 break-all">{mockup}</code>
        {note && <p className="text-sm text-neutral-700 mt-3 leading-relaxed">{note}</p>}
      </div>
    </div>
  );
}
