import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Beaker,
  FlaskConical,
  Droplets,
  Calculator,
  PawPrint,
  ArrowLeft,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import SaveApplicationForm, {
  type ApplicationType,
  type PrefillRate,
} from "@/components/calc/SaveApplicationForm";

// Application calculator — three modes (granular / liquid / lime) wired off a
// segmented control because (a) the existing screen-calc.jsx mockup uses a
// 2-up segmented control and we're just adding lime as a third pill, and (b)
// a tabs widget would imply page-level navigation that we don't want — the
// "Save to chemical log" card lives below all three modes and reads whichever
// mode is currently active. Segmented control keeps the calc inputs visible
// while you switch.
//
// chemical_applications isn't in supabase/types.ts (it's defined in
// supabase/migrations/0001_turfpro_lawn_care.sql), so the save form casts.
// properties.turf_sqft and properties.pet_safe_only are also not in types —
// we cast at this query boundary.

type CalcMode = "granular" | "liquid" | "lime";

const MODES: { value: CalcMode; label: string; Icon: typeof Beaker }[] = [
  { value: "granular", label: "Granular", Icon: Beaker },
  { value: "liquid", label: "Liquid", Icon: Droplets },
  { value: "lime", label: "Lime", Icon: FlaskConical },
];

// Map calculator mode to default application_type for the save form.
const MODE_TO_TYPE: Record<CalcMode, ApplicationType> = {
  granular: "fertilizer",
  liquid: "herbicide",
  lime: "lime",
};

// Reverse map for the `?type=` deep-link param (used by the GDD pre-emergent
// alert on Home: "Open calculator" -> /calc?type=herbicide). Only the types
// the calculator has a sensible default mode for are listed here; anything
// else falls through to the regular granular default.
const TYPE_TO_MODE: Partial<Record<ApplicationType, CalcMode>> = {
  fertilizer: "granular",
  herbicide: "liquid",
  pesticide: "liquid",
  fungicide: "liquid",
  lime: "lime",
};

// Seed the calculator mode + the save-form application_type from a `type`
// query param if present. Both states are seeded from the same source so the
// segmented mode toggle matches the application_type chip in the save form.
function seedFromQuery(typeParam: string | null): {
  mode: CalcMode;
  appType: ApplicationType | null;
} {
  if (!typeParam) return { mode: "granular", appType: null };
  const t = typeParam.toLowerCase() as ApplicationType;
  const mode = TYPE_TO_MODE[t];
  if (!mode) return { mode: "granular", appType: null };
  return { mode, appType: t };
}

interface PropertyLite {
  id: string;
  address: string;
  customer_id: string | null;
  sqft: number | null;
  turf_sqft: number | null;
  pet_safe_only: boolean | null;
}

const numOr = (v: string, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Spread setting hint — there's no curated product DB, so this is a coarse
// bucket based on lb/1000 sqft. Operators still calibrate against their own
// spreader; we just label it A–F as a starting point.
function spreaderSetting(lbsPer1k: number): string {
  if (lbsPer1k < 2) return "A";
  if (lbsPer1k < 3) return "B";
  if (lbsPer1k < 4) return "C";
  if (lbsPer1k < 5) return "D";
  if (lbsPer1k < 7) return "E";
  return "F";
}

export default function ApplicationCalc() {
  const [searchParams] = useSearchParams();
  const propertyId = searchParams.get("property_id");
  // `?type=herbicide` (and friends) is the deep-link from the Home GDD
  // pre-emergent alert. We compute the seed once via the lazy initializer so
  // navigating /calc?type=herbicide -> /calc cleanly via back doesn't reset
  // the mode toggle on every render.
  const typeParam = searchParams.get("type");
  const initial = seedFromQuery(typeParam);

  // Load the linked property (if any) for sqft + pet-safe flag prefill.
  const propertyQuery = useQuery({
    queryKey: ["calc-property", propertyId],
    enabled: !!propertyId,
    queryFn: async (): Promise<PropertyLite | null> => {
      const { data, error } = await (supabase as any)
        .from("properties")
        .select("id, address, customer_id, sqft, turf_sqft, pet_safe_only")
        .eq("id", propertyId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PropertyLite | null;
    },
  });

  const property = propertyQuery.data;
  const propertyTurfSqft = property?.turf_sqft ?? property?.sqft ?? null;

  // Mode seeds from the query param on mount only (lazy initializer). After
  // mount the user can flip modes freely without the URL forcing a value.
  const [mode, setModeRaw] = useState<CalcMode>(() => initial.mode);
  // application_type used to seed the save form. Starts from the query param
  // if provided (e.g. ?type=herbicide), otherwise from MODE_TO_TYPE[mode]. We
  // track it separately so the initial mount honors the URL even though
  // liquid maps to "herbicide" by default — and on subsequent mode flips we
  // re-derive it so the toggle stays in sync with the application_type chip.
  const [appType, setAppType] = useState<ApplicationType>(
    () => initial.appType ?? MODE_TO_TYPE[initial.mode],
  );
  const setMode = (m: CalcMode) => {
    setModeRaw(m);
    setAppType(MODE_TO_TYPE[m]);
  };

  // ---- Granular state -----------------------------------------------------
  const [gSqft, setGSqft] = useState<string>("");
  const [nPct, setNPct] = useState<string>("24");
  const [pPct, setPPct] = useState<string>("0");
  const [kPct, setKPct] = useState<string>("12");
  const [targetN, setTargetN] = useState<string>("1.0");
  const [bagLb, setBagLb] = useState<string>("50");
  const [gProduct, setGProduct] = useState<string>("");

  // ---- Liquid state -------------------------------------------------------
  const [lSqft, setLSqft] = useState<string>("");
  const [tankGal, setTankGal] = useState<string>("4");
  const [labelRate, setLabelRate] = useState<string>("2");
  const [labelRateMode, setLabelRateMode] = useState<"oz_per_gal" | "floz_per_1k">(
    "oz_per_gal",
  );
  const [coverageSqftPerGal, setCoverageSqftPerGal] = useState<string>("1000");
  const [lProduct, setLProduct] = useState<string>("");

  // ---- Lime state ---------------------------------------------------------
  const [limeSqft, setLimeSqft] = useState<string>("");
  const [limeRate, setLimeRate] = useState<string>("40");
  const [limeBag, setLimeBag] = useState<string>("40");
  const [limeProduct, setLimeProduct] = useState<string>("");

  // Auto-prefill sqft fields from property record once the query resolves.
  useEffect(() => {
    if (propertyTurfSqft && !gSqft) setGSqft(String(propertyTurfSqft));
    if (propertyTurfSqft && !lSqft) setLSqft(String(propertyTurfSqft));
    if (propertyTurfSqft && !limeSqft) setLimeSqft(String(propertyTurfSqft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyTurfSqft]);

  // ---- Granular math ------------------------------------------------------
  const granular = useMemo(() => {
    const sqft = numOr(gSqft, 0);
    const n = numOr(nPct, 0);
    const target = numOr(targetN, 1);
    const bag = numOr(bagLb, 50);
    if (sqft <= 0 || n <= 0) {
      return { totalLb: 0, bags: 0, lbPer1k: 0, actualN: 0, lbP: 0, lbK: 0, setting: "—" };
    }
    // lbs product = (sqft/1000) * (lb N per 1k / (N% / 100))
    const totalLb = (sqft / 1000) * (target / (n / 100));
    const bags = Math.ceil(totalLb / bag);
    const lbPer1k = totalLb / (sqft / 1000);
    const actualN = (lbPer1k * n) / 100;
    const lbP = (lbPer1k * numOr(pPct, 0)) / 100;
    const lbK = (lbPer1k * numOr(kPct, 0)) / 100;
    return {
      totalLb,
      bags,
      lbPer1k,
      actualN,
      lbP,
      lbK,
      setting: spreaderSetting(lbPer1k),
    };
  }, [gSqft, nPct, pPct, kPct, targetN, bagLb]);

  // ---- Liquid math --------------------------------------------------------
  const liquid = useMemo(() => {
    const sqft = numOr(lSqft, 0);
    const gal = numOr(tankGal, 4);
    const rate = numOr(labelRate, 0);
    const coverage = numOr(coverageSqftPerGal, 1000);
    if (sqft <= 0 || rate <= 0) {
      return { ozPerTank: 0, tanks: 0, totalOz: 0, totalGal: 0, totalConcentrateOz: 0 };
    }
    if (labelRateMode === "oz_per_gal") {
      // total water = (sqft / coverage) gal
      const totalWaterGal = sqft / coverage;
      const tanks = Math.ceil(totalWaterGal / gal);
      const ozPerTank = rate * gal;
      const totalConcentrateOz = rate * totalWaterGal;
      return {
        ozPerTank,
        tanks,
        totalOz: ozPerTank * tanks,
        totalGal: totalWaterGal,
        totalConcentrateOz,
      };
    }
    // floz_per_1k: rate is fl oz of concentrate per 1000 sqft
    const totalConcentrateOz = (sqft / 1000) * rate;
    const totalWaterGal = sqft / coverage;
    const tanks = Math.ceil(totalWaterGal / gal);
    const ozPerTank = tanks > 0 ? totalConcentrateOz / tanks : 0;
    return {
      ozPerTank,
      tanks,
      totalOz: totalConcentrateOz,
      totalGal: totalWaterGal,
      totalConcentrateOz,
    };
  }, [lSqft, tankGal, labelRate, coverageSqftPerGal, labelRateMode]);

  // ---- Lime math ----------------------------------------------------------
  const lime = useMemo(() => {
    const sqft = numOr(limeSqft, 0);
    const rate = numOr(limeRate, 40);
    const bag = numOr(limeBag, 40);
    if (sqft <= 0 || rate <= 0) return { totalLb: 0, bags: 0 };
    const totalLb = (sqft / 1000) * rate;
    return { totalLb, bags: Math.ceil(totalLb / bag) };
  }, [limeSqft, limeRate, limeBag]);

  // ---- Prefill for save form ---------------------------------------------
  const prefill: PrefillRate = useMemo(() => {
    if (mode === "granular") {
      return {
        rate_amount: numOr(targetN, 0) || null,
        rate_unit: "lb N / 1000 sqft",
        total_amount: granular.totalLb > 0 ? Number(granular.totalLb.toFixed(2)) : null,
        total_unit: "lb",
        area_sqft: numOr(gSqft, 0) || null,
      };
    }
    if (mode === "liquid") {
      return {
        rate_amount: numOr(labelRate, 0) || null,
        rate_unit:
          labelRateMode === "oz_per_gal" ? "oz / gal" : "fl oz / 1000 sqft",
        total_amount:
          liquid.totalConcentrateOz > 0
            ? Number(liquid.totalConcentrateOz.toFixed(2))
            : null,
        total_unit: "oz",
        area_sqft: numOr(lSqft, 0) || null,
      };
    }
    return {
      rate_amount: numOr(limeRate, 0) || null,
      rate_unit: "lb / 1000 sqft",
      total_amount: lime.totalLb > 0 ? Number(lime.totalLb.toFixed(2)) : null,
      total_unit: "lb",
      area_sqft: numOr(limeSqft, 0) || null,
    };
  }, [
    mode,
    targetN,
    gSqft,
    granular,
    labelRate,
    labelRateMode,
    lSqft,
    liquid,
    limeRate,
    limeSqft,
    lime,
  ]);

  const defaultProductName =
    mode === "granular" ? gProduct : mode === "liquid" ? lProduct : limeProduct;

  return (
    <div className="pt-3 pb-10">
      {/* Header */}
      <header className="px-[22px] pb-[14px] flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          {property?.address ? (
            <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500 truncate">
              <Link
                to={`/properties/${property.id}`}
                className="inline-flex items-center gap-1 hover:text-ink-700"
              >
                <ArrowLeft className="h-3 w-3" /> {property.address}
              </Link>
            </div>
          ) : (
            <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
              NPK · lbs per 1000 ft²
            </div>
          )}
          <h1 className="tp-display text-[28px] font-bold text-ink-900 leading-tight mt-0.5">
            Application
          </h1>
        </div>
        <div className="h-10 w-10 rounded-full bg-green-800 text-bronze-400 grid place-items-center">
          <Calculator className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </div>
      </header>

      {/* Pet-safe banner */}
      {property?.pet_safe_only && (
        <div className="mx-4 mb-3">
          <div className="rounded-[14px] bg-[hsl(var(--warning-bg))] border border-[hsl(var(--warning)_/_0.25)] px-3.5 py-2.5 flex items-center gap-2.5">
            <PawPrint
              className="h-4 w-4 text-[hsl(var(--warning))] shrink-0"
              strokeWidth={2}
            />
            <div className="text-[12px] text-bronze-700 leading-snug">
              <b>Pet-safe products only.</b> This property has pets on site —
              double-check label before applying.
            </div>
          </div>
        </div>
      )}

      {/* Mode toggle */}
      <div className="mx-4 mb-3.5">
        <div className="tp-card p-1 flex gap-1">
          {MODES.map(({ value, label, Icon }) => {
            const on = mode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  "flex-1 py-2.5 rounded-[12px] flex items-center justify-center gap-1.5 text-[13px] font-semibold transition-colors",
                  on
                    ? "bg-green-800 text-white"
                    : "text-ink-700 hover:bg-ink-100",
                )}
              >
                <Icon
                  className={cn("h-3.5 w-3.5", on ? "text-bronze-400" : "text-ink-500")}
                  strokeWidth={1.9}
                />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mode body */}
      {mode === "granular" && (
        <GranularMode
          sqft={gSqft}
          setSqft={setGSqft}
          nPct={nPct}
          setNPct={setNPct}
          pPct={pPct}
          setPPct={setPPct}
          kPct={kPct}
          setKPct={setKPct}
          targetN={targetN}
          setTargetN={setTargetN}
          bagLb={bagLb}
          setBagLb={setBagLb}
          product={gProduct}
          setProduct={setGProduct}
          result={granular}
          sqftFromProperty={!!propertyTurfSqft && gSqft === String(propertyTurfSqft)}
        />
      )}

      {mode === "liquid" && (
        <LiquidMode
          sqft={lSqft}
          setSqft={setLSqft}
          tankGal={tankGal}
          setTankGal={setTankGal}
          labelRate={labelRate}
          setLabelRate={setLabelRate}
          labelRateMode={labelRateMode}
          setLabelRateMode={setLabelRateMode}
          coverage={coverageSqftPerGal}
          setCoverage={setCoverageSqftPerGal}
          product={lProduct}
          setProduct={setLProduct}
          result={liquid}
          sqftFromProperty={!!propertyTurfSqft && lSqft === String(propertyTurfSqft)}
        />
      )}

      {mode === "lime" && (
        <LimeMode
          sqft={limeSqft}
          setSqft={setLimeSqft}
          rate={limeRate}
          setRate={setLimeRate}
          bag={limeBag}
          setBag={setLimeBag}
          product={limeProduct}
          setProduct={setLimeProduct}
          result={lime}
          sqftFromProperty={!!propertyTurfSqft && limeSqft === String(propertyTurfSqft)}
        />
      )}

      {/* Save to chemical log */}
      <div className="mx-4 mt-4">
        <SaveApplicationForm
          propertyId={propertyId}
          prefill={prefill}
          defaultType={appType}
          defaultProductName={defaultProductName}
          onSaved={() => {
            // Stay on the page; the log will pick it up via query invalidation
            // when the user navigates there. Tiny confirmation toast would be
            // ideal here, but we keep it minimal until a shared toast lands.
          }}
        />
      </div>

      <div className="text-center text-[10.5px] text-ink-400 mt-4 px-6 leading-relaxed">
        Calculations are estimates. Always defer to the product label for
        final rates and re-entry intervals.
      </div>
    </div>
  );
}

// =====================================================================
// Granular mode body
// =====================================================================
function GranularMode(props: {
  sqft: string;
  setSqft: (v: string) => void;
  nPct: string;
  setNPct: (v: string) => void;
  pPct: string;
  setPPct: (v: string) => void;
  kPct: string;
  setKPct: (v: string) => void;
  targetN: string;
  setTargetN: (v: string) => void;
  bagLb: string;
  setBagLb: (v: string) => void;
  product: string;
  setProduct: (v: string) => void;
  sqftFromProperty: boolean;
  result: {
    totalLb: number;
    bags: number;
    lbPer1k: number;
    actualN: number;
    lbP: number;
    lbK: number;
    setting: string;
  };
}) {
  const r = props.result;
  return (
    <>
      {/* Product card */}
      <Section title="Product">
        <div className="tp-card p-3.5">
          <input
            type="text"
            value={props.product}
            onChange={(e) => props.setProduct(e.target.value)}
            placeholder="Product name (e.g. Lesco Pro)"
            className="w-full bg-transparent text-[14.5px] font-semibold text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          <div className="grid grid-cols-3 gap-2 mt-3">
            <NPKChip label="N" value={props.nPct} onChange={props.setNPct} color="text-green-700" />
            <NPKChip label="P" value={props.pPct} onChange={props.setPPct} color="text-ink-500" />
            <NPKChip label="K" value={props.kPct} onChange={props.setKPct} color="text-bronze-600" />
          </div>
        </div>
      </Section>

      {/* Inputs grid */}
      <Section>
        <div className="grid grid-cols-2 gap-2.5">
          <InputCard
            label="Lawn area"
            value={props.sqft}
            onChange={props.setSqft}
            suffix="ft²"
            hint={props.sqftFromProperty ? "from property record" : undefined}
          />
          <InputCard
            label="Target N rate"
            value={props.targetN}
            onChange={props.setTargetN}
            suffix="lb N/1k"
            step="0.05"
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5 mt-2.5">
          <InputCard
            label="Bag size"
            value={props.bagLb}
            onChange={props.setBagLb}
            suffix="lb"
          />
          <div className="rounded-[14px] border border-ink-100 bg-card p-3 flex flex-col justify-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-ink-500">
              Actual N applied
            </div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="tp-num text-[20px] font-bold text-ink-900">
                {r.actualN.toFixed(2)}
              </span>
              <span className="text-[11px] text-ink-500 font-semibold">lb/1k</span>
            </div>
          </div>
        </div>
      </Section>

      {/* Result card */}
      <Section>
        <div className="rounded-[22px] bg-gradient-hero-deep text-white px-[22px] pt-5 pb-5 relative overflow-hidden shadow-[0_8px_24px_-10px_hsl(148_75%_12%_/_0.5)]">
          <div className="text-[11px] font-semibold tracking-[1px] uppercase text-bronze-400">
            Apply this visit
          </div>
          <div className="flex items-baseline gap-1.5 mt-1.5">
            <span className="tp-display tp-num text-[48px] font-bold leading-none tracking-[-0.03em]">
              {r.totalLb.toFixed(1)}
            </span>
            <span className="text-[18px] font-semibold text-[#cfead8]">lb</span>
          </div>
          <div className="text-[13px] text-[#cfead8] mt-1">
            ≈{" "}
            <span className="tp-num font-bold text-white">
              {r.bags}
            </span>{" "}
            bag{r.bags === 1 ? "" : "s"} of {props.bagLb} lb
          </div>
          <div className="flex justify-between gap-4 mt-4 pt-3.5 border-t border-white/10">
            <ResultStat
              label="Spreader"
              value={<>setting <span className="text-bronze-400">{r.setting}</span></>}
            />
            <ResultStat
              label="Coverage"
              value={
                <>
                  {r.lbPer1k.toFixed(1)}
                  <span className="text-[11px] text-[#cfead8] font-medium ml-0.5">lb/k</span>
                </>
              }
            />
            <ResultStat
              label="P + K"
              value={
                <>
                  {r.lbP.toFixed(1)}/{r.lbK.toFixed(1)}
                  <span className="text-[11px] text-[#cfead8] font-medium ml-0.5">lb/k</span>
                </>
              }
            />
          </div>
        </div>
      </Section>
    </>
  );
}

// =====================================================================
// Liquid mode body
// =====================================================================
function LiquidMode(props: {
  sqft: string;
  setSqft: (v: string) => void;
  tankGal: string;
  setTankGal: (v: string) => void;
  labelRate: string;
  setLabelRate: (v: string) => void;
  labelRateMode: "oz_per_gal" | "floz_per_1k";
  setLabelRateMode: (m: "oz_per_gal" | "floz_per_1k") => void;
  coverage: string;
  setCoverage: (v: string) => void;
  product: string;
  setProduct: (v: string) => void;
  sqftFromProperty: boolean;
  result: {
    ozPerTank: number;
    tanks: number;
    totalOz: number;
    totalGal: number;
    totalConcentrateOz: number;
  };
}) {
  const r = props.result;
  return (
    <>
      <Section title="Product">
        <div className="tp-card p-3.5">
          <input
            type="text"
            value={props.product}
            onChange={(e) => props.setProduct(e.target.value)}
            placeholder="Product name (e.g. Tenacity)"
            className="w-full bg-transparent text-[14.5px] font-semibold text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
        </div>
      </Section>

      <Section title="Label rate">
        <div className="tp-card p-1 flex gap-1 mb-2.5">
          <button
            type="button"
            onClick={() => props.setLabelRateMode("oz_per_gal")}
            className={cn(
              "flex-1 py-2 rounded-[10px] text-[12px] font-semibold",
              props.labelRateMode === "oz_per_gal"
                ? "bg-green-800 text-white"
                : "text-ink-700 hover:bg-ink-100",
            )}
          >
            oz / gal water
          </button>
          <button
            type="button"
            onClick={() => props.setLabelRateMode("floz_per_1k")}
            className={cn(
              "flex-1 py-2 rounded-[10px] text-[12px] font-semibold",
              props.labelRateMode === "floz_per_1k"
                ? "bg-green-800 text-white"
                : "text-ink-700 hover:bg-ink-100",
            )}
          >
            fl oz / 1000 sqft
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <InputCard
            label={
              props.labelRateMode === "oz_per_gal" ? "Rate (oz/gal)" : "Rate (fl oz/1k)"
            }
            value={props.labelRate}
            onChange={props.setLabelRate}
            suffix={props.labelRateMode === "oz_per_gal" ? "oz/gal" : "fl oz/1k"}
            step="0.1"
          />
          <InputCard
            label="Tank size"
            value={props.tankGal}
            onChange={props.setTankGal}
            suffix="gal"
            step="0.5"
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5 mt-2.5">
          <InputCard
            label="Target area"
            value={props.sqft}
            onChange={props.setSqft}
            suffix="ft²"
            hint={props.sqftFromProperty ? "from property record" : undefined}
          />
          <InputCard
            label="Coverage / gal"
            value={props.coverage}
            onChange={props.setCoverage}
            suffix="ft²/gal"
          />
        </div>
      </Section>

      <Section>
        <div className="rounded-[22px] bg-gradient-hero-deep text-white px-[22px] pt-5 pb-5 relative overflow-hidden shadow-[0_8px_24px_-10px_hsl(148_75%_12%_/_0.5)]">
          <div className="text-[11px] font-semibold tracking-[1px] uppercase text-bronze-400">
            Mix this tank
          </div>
          <div className="flex items-baseline gap-1.5 mt-1.5">
            <span className="tp-display tp-num text-[48px] font-bold leading-none tracking-[-0.03em]">
              {r.ozPerTank.toFixed(1)}
            </span>
            <span className="text-[18px] font-semibold text-[#cfead8]">oz / tank</span>
          </div>
          <div className="text-[13px] text-[#cfead8] mt-1">
            ≈{" "}
            <span className="tp-num font-bold text-white">{r.tanks}</span>{" "}
            tank{r.tanks === 1 ? "" : "s"} to cover the area
          </div>
          <div className="flex justify-between gap-4 mt-4 pt-3.5 border-t border-white/10">
            <ResultStat
              label="Total water"
              value={
                <>
                  {r.totalGal.toFixed(1)}
                  <span className="text-[11px] text-[#cfead8] font-medium ml-0.5">gal</span>
                </>
              }
            />
            <ResultStat
              label="Concentrate"
              value={
                <>
                  {r.totalConcentrateOz.toFixed(1)}
                  <span className="text-[11px] text-[#cfead8] font-medium ml-0.5">oz</span>
                </>
              }
            />
            <ResultStat
              label="Tanks"
              value={<span className="tp-num">{r.tanks}</span>}
            />
          </div>
        </div>
      </Section>
    </>
  );
}

// =====================================================================
// Lime mode body
// =====================================================================
function LimeMode(props: {
  sqft: string;
  setSqft: (v: string) => void;
  rate: string;
  setRate: (v: string) => void;
  bag: string;
  setBag: (v: string) => void;
  product: string;
  setProduct: (v: string) => void;
  sqftFromProperty: boolean;
  result: { totalLb: number; bags: number };
}) {
  const r = props.result;
  return (
    <>
      <Section title="Product">
        <div className="tp-card p-3.5">
          <input
            type="text"
            value={props.product}
            onChange={(e) => props.setProduct(e.target.value)}
            placeholder="Product name (e.g. pelletized lime)"
            className="w-full bg-transparent text-[14.5px] font-semibold text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          <div className="text-[11px] text-ink-500 mt-1">
            Maintenance rate 40 lb/1000 sqft. Soil-test results trump this.
          </div>
        </div>
      </Section>

      <Section>
        <div className="grid grid-cols-2 gap-2.5">
          <InputCard
            label="Lawn area"
            value={props.sqft}
            onChange={props.setSqft}
            suffix="ft²"
            hint={props.sqftFromProperty ? "from property record" : undefined}
          />
          <InputCard
            label="Rate"
            value={props.rate}
            onChange={props.setRate}
            suffix="lb/1k"
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5 mt-2.5">
          <InputCard
            label="Bag size"
            value={props.bag}
            onChange={props.setBag}
            suffix="lb"
          />
          <div className="rounded-[14px] border border-ink-100 bg-card p-3 flex flex-col justify-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-ink-500">
              Spreader
            </div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="tp-num text-[20px] font-bold text-ink-900">
                {spreaderSetting(Number(props.rate) || 40)}
              </span>
              <span className="text-[11px] text-ink-500 font-semibold">setting</span>
            </div>
          </div>
        </div>
      </Section>

      <Section>
        <div className="rounded-[22px] bg-gradient-hero-deep text-white px-[22px] pt-5 pb-5 relative overflow-hidden shadow-[0_8px_24px_-10px_hsl(148_75%_12%_/_0.5)]">
          <div className="text-[11px] font-semibold tracking-[1px] uppercase text-bronze-400">
            Apply this visit
          </div>
          <div className="flex items-baseline gap-1.5 mt-1.5">
            <span className="tp-display tp-num text-[48px] font-bold leading-none tracking-[-0.03em]">
              {r.totalLb.toFixed(0)}
            </span>
            <span className="text-[18px] font-semibold text-[#cfead8]">lb total</span>
          </div>
          <div className="text-[13px] text-[#cfead8] mt-1">
            ≈ <span className="tp-num font-bold text-white">{r.bags}</span> bag
            {r.bags === 1 ? "" : "s"} of {props.bag} lb
          </div>
        </div>
      </Section>
    </>
  );
}

// =====================================================================
// Small layout / input primitives
// =====================================================================

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mx-4 mb-3">
      {title && (
        <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-ink-500 px-1 pb-2">
          {title}
        </div>
      )}
      {children}
    </section>
  );
}

function InputCard({
  label,
  value,
  onChange,
  suffix,
  hint,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  hint?: string;
  step?: string;
}) {
  return (
    <div className="rounded-[14px] border border-ink-100 bg-card p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-ink-500">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <input
          type="number"
          inputMode="decimal"
          step={step ?? "1"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="tp-num text-[22px] font-bold text-ink-900 w-full bg-transparent focus:outline-none placeholder:text-ink-300"
          placeholder="0"
        />
        <span className="text-[11px] text-ink-500 font-semibold whitespace-nowrap">
          {suffix}
        </span>
      </div>
      {hint && (
        <div className="text-[10.5px] text-green-700 font-semibold mt-0.5">{hint}</div>
      )}
    </div>
  );
}

function NPKChip({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  color: string;
}) {
  return (
    <label className="bg-ink-100 rounded-[10px] px-2.5 py-2 block">
      <div className={cn("text-[10px] font-bold tracking-[0.5px]", color)}>{label}</div>
      <div className="flex items-baseline gap-0.5 mt-0.5">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="tp-num text-[17px] font-bold text-ink-900 w-full bg-transparent focus:outline-none"
          placeholder="0"
        />
        <span className="text-[10px] text-ink-500 font-medium">%</span>
      </div>
    </label>
  );
}

function ResultStat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] text-[#a8c9b7] font-semibold tracking-[0.5px] uppercase">
        {label}
      </div>
      <div className="tp-num text-[18px] font-bold mt-0.5">{value}</div>
    </div>
  );
}
