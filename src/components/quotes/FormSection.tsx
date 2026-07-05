import type { ReactNode } from "react";

// Shared quote-form primitives: a titled card section and a labelled field.
// Used by QuoteForm and by each vertical's quote-line LineEditor.
export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="tp-card p-4 space-y-3">
      <div>
        <h2 className="text-[14px] font-semibold text-neutral-900">{title}</h2>
        {subtitle && (
          <p className="text-[11.5px] text-neutral-500 mt-0.5 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[10.5px] font-bold uppercase tracking-[0.4px] text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}
