import { Plus, Trash2, Droplets, Zap } from "lucide-react";
import type {
  QuoteLine,
  CatalogItem,
  LineDescription,
  LineEditorProps,
  QuoteLineModule,
} from "@/verticals/quote-line";
import { Section, Field } from "@/components/quotes/FormSection";

// The concrete pressure line. The shared QuoteLine is opaque; this module is the
// one place that knows the pressure shape, so it casts at its boundary.
type SurfaceKey = "concrete" | "siding" | "roof" | "deck" | "fence" | "driveway" | "house";
type JobMode = "soft" | "power";

interface PressureSurfaceLine extends QuoteLine {
  surface: SurfaceKey;
  sqft: number;
  rate: number; // $/sqft, or flat $ when custom (sqft = 1)
  mode: JobMode;
  label?: string;
  custom?: boolean;
}

// Surface metadata — relocated verbatim from PressurePro store.ts SURFACE_META.
const SURFACE_META: Record<SurfaceKey, { label: string; emoji: string; recommended: JobMode }> = {
  house: { label: "House Wash", emoji: "🏠", recommended: "soft" },
  siding: { label: "Siding", emoji: "🧱", recommended: "soft" },
  roof: { label: "Roof", emoji: "🛖", recommended: "soft" },
  driveway: { label: "Driveway", emoji: "🛣️", recommended: "power" },
  concrete: { label: "Concrete", emoji: "🧊", recommended: "power" },
  deck: { label: "Deck", emoji: "🪵", recommended: "soft" },
  fence: { label: "Fence", emoji: "🚧", recommended: "soft" },
};

// Add-time default area by surface (from PressurePro NewQuote.addSurface).
const DEFAULT_SQFT: Record<SurfaceKey, number> = {
  house: 1500, siding: 1500, roof: 1500, driveway: 600, concrete: 600, deck: 300, fence: 300,
};

function isSurfaceKey(s: unknown): s is SurfaceKey {
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(SURFACE_META, s);
}

function pressureLineTotal(l: { sqft: number; rate: number }): number {
  return Math.round((l.sqft ?? 0) * (l.rate ?? 0) * 100) / 100;
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function pressureBlankLine(): QuoteLine {
  return {
    id: crypto.randomUUID(),
    surface: "concrete",
    sqft: 1,
    rate: 0,
    mode: "power",
    label: "Custom item",
    custom: true,
    total: 0,
  } as PressureSurfaceLine;
}

function pressureCatalogToLine(item: CatalogItem): QuoteLine {
  const rate = Number(item.default_rate ?? 0);
  if (isSurfaceKey(item.surface_type)) {
    const surface = item.surface_type;
    const mode: JobMode =
      item.mode === "soft" || item.mode === "power" ? item.mode : SURFACE_META[surface].recommended;
    const sqft = DEFAULT_SQFT[surface];
    return {
      id: crypto.randomUUID(),
      surface,
      sqft,
      rate,
      mode,
      custom: false,
      total: pressureLineTotal({ sqft, rate }),
    } as PressureSurfaceLine;
  }
  return {
    id: crypto.randomUUID(),
    surface: "concrete",
    sqft: 1,
    rate,
    mode: "power",
    label: item.name,
    custom: true,
    total: rate,
  } as PressureSurfaceLine;
}

function pressureParseLines(raw: unknown): QuoteLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any): QuoteLine | null => {
      if (!r || typeof r !== "object") return null;
      const validSurface = isSurfaceKey(r.surface);
      const custom = r.custom === true || !validSurface;
      const surface: SurfaceKey = validSurface ? r.surface : "concrete";
      const sqft = Number(r.sqft) || (custom ? 1 : 0);
      const rate = Number(r.rate) || 0;
      const mode: JobMode = r.mode === "power" ? "power" : "soft";
      const line: PressureSurfaceLine = {
        id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
        surface,
        sqft,
        rate,
        mode,
        custom,
        total: typeof r.total === "number" ? r.total : pressureLineTotal({ sqft, rate }),
      };
      if (typeof r.label === "string" && r.label) line.label = r.label;
      return line;
    })
    .filter((l): l is QuoteLine => l !== null);
}

function pressureDescribe(line: QuoteLine): LineDescription {
  const l = line as PressureSurfaceLine;
  if (l.custom) {
    return { label: l.label || "Custom item", detail: null, qty: "1", rate: "—", amount: l.total };
  }
  const meta = SURFACE_META[l.surface];
  const sqftStr = l.sqft.toLocaleString();
  return {
    label: meta ? meta.label : "Service",
    detail: `${sqftStr} sqft × ${fmtMoney(l.rate)} · ${l.mode}`,
    qty: `${sqftStr} sqft`,
    rate: fmtMoney(l.rate),
    amount: l.total,
  };
}

// Soft/power segmented control — ported from PressurePro's ModeToggle, using
// shared theme classes only.
function ModeToggle({ value, onChange }: { value: JobMode; onChange: (m: JobMode) => void }) {
  const isSoft = value === "soft";
  const btn = (active: boolean) =>
    `relative z-10 flex items-center justify-center gap-1 flex-1 px-2 py-1.5 font-semibold rounded-full text-[12px] ${
      active ? "text-brand-800" : "text-neutral-500"
    }`;
  return (
    <div className="relative inline-flex items-center rounded-full bg-neutral-100 p-1 w-full select-none">
      <span
        aria-hidden
        className={`absolute top-1 bottom-1 w-1/2 rounded-full bg-card shadow-card transition-transform duration-200 ${
          isSoft ? "translate-x-0" : "translate-x-full"
        }`}
      />
      <button type="button" onClick={() => onChange("soft")} className={btn(isSoft)}>
        <Droplets className="h-3.5 w-3.5" /> Soft
      </button>
      <button type="button" onClick={() => onChange("power")} className={btn(!isSoft)}>
        <Zap className="h-3.5 w-3.5" /> Power
      </button>
    </div>
  );
}

function PressureLineEditor({ lines, catalog, onChange }: LineEditorProps) {
  const rows = lines as PressureSurfaceLine[];

  const rateFor = (surface: SurfaceKey, mode: JobMode): number => {
    const hit = catalog.find((c) => c.surface_type === surface && c.mode === mode);
    return hit ? Number(hit.default_rate ?? 0) : 0;
  };
  const addSurface = (surface: SurfaceKey) => {
    const mode = SURFACE_META[surface].recommended;
    const rate = rateFor(surface, mode);
    const sqft = DEFAULT_SQFT[surface];
    onChange([
      ...rows,
      {
        id: crypto.randomUUID(),
        surface,
        sqft,
        rate,
        mode,
        custom: false,
        total: pressureLineTotal({ sqft, rate }),
      } as PressureSurfaceLine,
    ]);
  };
  const addCustomLine = () => onChange([...rows, pressureBlankLine() as PressureSurfaceLine]);
  const updateLine = (id: string, patch: Partial<PressureSurfaceLine>) =>
    onChange(
      rows.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        next.total = pressureLineTotal(next);
        return next;
      }),
    );
  const removeLine = (id: string) => onChange(rows.filter((l) => l.id !== id));

  return (
    <Section
      title="Line items"
      subtitle="Tap a surface to add it, or add a custom line. Edit sqft, rate, and wash mode per line."
    >
      <div className="grid grid-cols-4 gap-2">
        {(Object.keys(SURFACE_META) as SurfaceKey[]).map((s) => {
          const m = SURFACE_META[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => addSurface(s)}
              className="flex flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-card p-2 hover:border-brand-700 transition-colors"
            >
              <span className="text-2xl">{m.emoji}</span>
              <span className="text-[10px] font-bold leading-tight text-center">{m.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addCustomLine}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-200 py-2 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
        Add custom line item
      </button>

      {rows.length > 0 && (
        <ul className="space-y-2 pt-1">
          {rows.map((l) => (
            <li key={l.id} className="rounded-xl border border-neutral-200 bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                {l.custom ? (
                  <>
                    <span className="text-xl">✏️</span>
                    <input
                      value={l.label ?? ""}
                      onChange={(e) => updateLine(l.id, { label: e.target.value })}
                      placeholder="Line item name"
                      className="tp-input flex-1 font-semibold"
                    />
                  </>
                ) : (
                  <>
                    <span className="text-xl">{SURFACE_META[l.surface].emoji}</span>
                    <span className="font-semibold flex-1">{SURFACE_META[l.surface].label}</span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => removeLine(l.id)}
                  className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 flex items-center justify-center"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {l.custom ? (
                <Field label="Amount ($)">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={l.rate}
                    onChange={(e) => updateLine(l.id, { rate: Number(e.target.value) || 0, sqft: 1 })}
                    className="tp-input"
                  />
                </Field>
              ) : (
                <div className="grid grid-cols-3 gap-2 items-end">
                  <Field label="Sqft">
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={l.sqft}
                      onChange={(e) => updateLine(l.id, { sqft: Number(e.target.value) || 0 })}
                      className="tp-input"
                    />
                  </Field>
                  <Field label="$ / sqft">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={l.rate}
                      onChange={(e) => updateLine(l.id, { rate: Number(e.target.value) || 0 })}
                      className="tp-input"
                    />
                  </Field>
                  <Field label="Mode">
                    <ModeToggle value={l.mode} onChange={(m) => updateLine(l.id, { mode: m })} />
                  </Field>
                </div>
              )}

              <div className="flex justify-between items-center pt-1">
                <span className="text-[12px] text-neutral-500">Line total</span>
                <span className="font-semibold tp-num">{fmtMoney(l.total)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export const pressureQuoteLine: QuoteLineModule = {
  blankLine: pressureBlankLine,
  catalogToLine: pressureCatalogToLine,
  lineTotal: (l) => pressureLineTotal(l as PressureSurfaceLine),
  parseLines: pressureParseLines,
  describe: pressureDescribe,
  LineEditor: PressureLineEditor,
};
