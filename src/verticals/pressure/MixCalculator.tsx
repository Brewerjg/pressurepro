import { useMemo, useState } from "react";
import { FlaskConical, Droplets, Beaker } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  computeMix,
  estimateCost,
  SH_TARGETS,
  SURFACES,
  SURFACE_LABEL,
  type SurfaceKey,
} from "./mix-calc";

// Soft-wash mix calculator — pure client-side math over mix-calc.ts. No
// supabase, no settings, no weather: the operator picks a surface (which
// seeds the SH target + surfactant rate) and tunes gallons/stock strength.
// AppShell chrome comes from the route guard, same as every protected page.

const numOr = (v: string, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export default function MixCalculator() {
  const [surface, setSurfaceRaw] = useState<SurfaceKey>("house");
  const [totalGallons, setTotalGallons] = useState<string>("50");
  const [stockPct, setStockPct] = useState<string>("12.5");
  const [targetPct, setTargetPct] = useState<string>(
    String(SH_TARGETS.house.targetPct),
  );
  const [surfactantOzPerGal, setSurfactantOzPerGal] = useState<string>(
    String(SH_TARGETS.house.surfactantOzPerGal),
  );

  // Picking a surface seeds the target + surfactant rate; both stay editable
  // afterwards so operators can run hotter/cooler than the book values.
  const setSurface = (s: SurfaceKey) => {
    setSurfaceRaw(s);
    setTargetPct(String(SH_TARGETS[s].targetPct));
    setSurfactantOzPerGal(String(SH_TARGETS[s].surfactantOzPerGal));
  };

  const recipe = useMemo(
    () =>
      computeMix({
        totalGallons: numOr(totalGallons, 0),
        targetPct: numOr(targetPct, 0),
        stockPct: numOr(stockPct, 0),
        surfactantOzPerGal: numOr(surfactantOzPerGal, 0),
      }),
    [totalGallons, targetPct, stockPct, surfactantOzPerGal],
  );
  const cost = estimateCost(recipe.stockGal, recipe.surfactantOz);

  return (
    <div className="pt-3 pb-10">
      {/* Header */}
      <header className="px-[22px] pb-[14px] flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-neutral-500">
            SOFT-WASH
          </div>
          <h1 className="tp-display text-[28px] font-bold text-neutral-900 leading-tight mt-0.5">
            Mix calculator
          </h1>
          <div className="text-[13px] text-neutral-500 mt-0.5">
            Sodium hypochlorite recipe
          </div>
        </div>
        <div className="h-10 w-10 rounded-full bg-brand-800 text-accent-400 grid place-items-center">
          <FlaskConical className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </div>
      </header>

      {/* Surface picker */}
      <Section title="Surface">
        <div className="grid grid-cols-4 gap-2">
          {SURFACES.map((s) => {
            const on = surface === s;
            const { label, emoji } = SURFACE_LABEL[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSurface(s)}
                className={cn(
                  "rounded-[12px] border py-2.5 px-1 flex flex-col items-center gap-1 transition-colors",
                  on
                    ? "bg-brand-800 border-brand-800 text-white"
                    : "bg-card border-neutral-100 text-neutral-700 hover:bg-neutral-100",
                )}
              >
                <span className="text-[18px] leading-none">{emoji}</span>
                <span
                  className={cn(
                    "text-[10.5px] font-semibold leading-tight text-center",
                    on ? "text-white" : "text-neutral-700",
                  )}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Mix inputs */}
      <Section title="Mix">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Total mix" suffix="gal">
            <input
              type="number"
              inputMode="decimal"
              step="1"
              value={totalGallons}
              onChange={(e) => setTotalGallons(e.target.value)}
              className="tp-input"
              placeholder="50"
            />
          </Field>
          <Field label="Stock SH strength" suffix="%">
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              value={stockPct}
              onChange={(e) => setStockPct(e.target.value)}
              className="tp-input"
              placeholder="12.5"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mt-2.5">
          <Field label="Target SH" suffix="%">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={targetPct}
              onChange={(e) => setTargetPct(e.target.value)}
              className="tp-input"
              placeholder="1.0"
            />
          </Field>
          <Field label="Surfactant" suffix="oz/gal">
            <input
              type="number"
              inputMode="decimal"
              step="0.25"
              value={surfactantOzPerGal}
              onChange={(e) => setSurfactantOzPerGal(e.target.value)}
              className="tp-input"
              placeholder="1.0"
            />
          </Field>
        </div>
      </Section>

      {/* Recipe */}
      <Section title="Recipe">
        <div className="tp-card p-4">
          <RecipeRow
            icon={<FlaskConical className="h-4 w-4 text-brand-700" strokeWidth={1.9} />}
            label="SH stock"
            value={recipe.stockGal.toFixed(2)}
            unit="gal"
          />
          <RecipeRow
            icon={<Droplets className="h-4 w-4 text-brand-700" strokeWidth={1.9} />}
            label="Water"
            value={recipe.waterGal.toFixed(2)}
            unit="gal"
          />
          <RecipeRow
            icon={<Beaker className="h-4 w-4 text-brand-700" strokeWidth={1.9} />}
            label="Surfactant"
            value={recipe.surfactantOz.toFixed(1)}
            unit="oz"
          />
          <div className="flex items-center justify-between pt-3 mt-3 border-t border-neutral-100">
            <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-neutral-500">
              Est. chem cost
            </div>
            <div className="tp-num text-[18px] font-bold text-neutral-900">
              {`$${cost.toFixed(2)}`}
            </div>
          </div>
        </div>
      </Section>

      <div className="text-center text-[10.5px] text-neutral-400 mt-4 px-6 leading-relaxed">
        Estimates only. Verify SH strength and dwell times against surface
        condition before spraying.
      </div>

      <style>{`
        .tp-input {
          width: 100%;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1.5px solid hsl(var(--neutral-200));
          background: hsl(var(--card));
          color: hsl(var(--neutral-900));
          font-size: 14px;
          font-weight: 500;
          outline: none;
          transition: border-color 0.15s;
        }
        .tp-input:focus { border-color: hsl(var(--brand-800)); }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mx-4 mb-3">
      {title && (
        <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-neutral-500 px-1 pb-2">
          {title}
        </div>
      )}
      {children}
    </section>
  );
}

function Field({
  label,
  suffix,
  children,
}: {
  label: string;
  suffix: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-neutral-500 px-1 pb-1">
        {label} <span className="text-neutral-400 normal-case">({suffix})</span>
      </div>
      {children}
    </label>
  );
}

function RecipeRow({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="text-[13.5px] font-semibold text-neutral-700">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="tp-num text-[18px] font-bold text-neutral-900">{value}</span>
        <span className="text-[11px] text-neutral-500 font-semibold">{unit}</span>
      </div>
    </div>
  );
}
