import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { TIERS, type TierId } from "@/lib/stripe";
import { cn } from "@/lib/utils";

// Breakeven calculator for the public Pricing page.
//
// Helps an operator decide whether the per-transaction Base fee (1.5%) or one
// of the flat-rate paid tiers is cheaper at their monthly card volume.
// We compute Base cost from the entered volume (volume * rate, rate read from
// the tier table) and compare against the flat Solo / Crew prices; the row
// with the lowest monthly cost gets a "Best value" bronze badge.
//
// Tie-points (informational; the math arrives at them naturally; shift with
// the rate — at 1.5%: Solo $15/0.015 = $1,000/mo, Crew $49/0.015 ≈ $3,267/mo).
//
// Default volume is $5,000 — the median operator monthly volume per the
// product brief. Operators type their actual number; we deliberately use
// a numeric input (not a slider) so they can punch in exact values.

const DEFAULT_VOLUME = 5000;
// PAYG fee is sourced from the tier table so the math stays in sync if
// the contract ever changes — we always read it via the TIERS array.
const PAYG_TIER = TIERS.find((t) => t.id === "payg")!;
const PAYG_RATE = PAYG_TIER.applicationFeePercent / 100;

type Row = {
  id: TierId;
  label: string;
  cost: number;
  formula: string;
};

function formatMoney(n: number): string {
  // Round to nearest cent; trim trailing .00 so flat tiers read as "$25"
  // rather than "$25.00". PAYG, which usually has cents, keeps them.
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0
    ? `$${rounded.toFixed(0)}`
    : `$${rounded.toFixed(2)}`;
}

export default function BreakevenCalc() {
  const [volume, setVolume] = useState<number>(DEFAULT_VOLUME);

  const rows: Row[] = useMemo(() => {
    const safeVolume = Number.isFinite(volume) && volume > 0 ? volume : 0;
    const paygCost = safeVolume * PAYG_RATE;
    return [
      {
        id: "payg",
        label: "Base",
        cost: paygCost,
        formula: `${formatMoney(safeVolume)} × ${PAYG_TIER.applicationFeePercent}%`,
      },
      ...TIERS.filter((t) => t.id !== "payg").map<Row>((t) => ({
        id: t.id,
        label: t.name,
        cost: t.monthly.price,
        formula: `${formatMoney(t.monthly.price)} flat`,
      })),
    ];
  }, [volume]);

  // Find the cheapest row. On exact ties (the breakeven points above),
  // prefer the paid tier — once volume meets the threshold, the
  // subscription becomes the more interesting recommendation than
  // continuing on the variable PAYG rate.
  const winnerId: TierId = useMemo(() => {
    let bestIdx = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].cost < rows[bestIdx].cost) {
        bestIdx = i;
      } else if (rows[i].cost === rows[bestIdx].cost && rows[bestIdx].id === "payg") {
        // Tie with PAYG → recommend the paid tier instead.
        bestIdx = i;
      }
    }
    return rows[bestIdx].id;
  }, [rows]);

  const handleVolumeChange = (raw: string) => {
    // Strip everything but digits + a single decimal, then parse.
    // Keeping it forgiving so an operator pasting "$5,000" works.
    const cleaned = raw.replace(/[^0-9.]/g, "");
    if (cleaned === "") {
      setVolume(0);
      return;
    }
    const parsed = parseFloat(cleaned);
    if (Number.isFinite(parsed)) {
      setVolume(parsed);
    }
  };

  return (
    <section className="tp-card p-5 sm:p-6 max-w-2xl mx-auto">
      <div className="mb-4">
        <h2 className="font-display font-extrabold text-[18px] sm:text-xl text-ink-900">
          Which tier fits you?
        </h2>
        <p className="text-[12px] sm:text-[13px] text-ink-500 mt-1">
          Enter your monthly card volume and we'll show the cheapest tier
          at that level.
        </p>
      </div>

      {/* Volume input */}
      <label
        htmlFor="payg-volume"
        className="block text-[11px] font-semibold uppercase tracking-wide text-ink-500 mb-1.5"
      >
        Monthly card volume
      </label>
      <div className="relative mb-5">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 font-semibold text-sm pointer-events-none">
          $
        </span>
        <input
          id="payg-volume"
          type="text"
          inputMode="decimal"
          value={volume === 0 ? "" : volume.toString()}
          onChange={(e) => handleVolumeChange(e.target.value)}
          placeholder="5,000"
          className="w-full h-12 rounded-xl border-[1.5px] border-ink-200 bg-card pl-7 pr-3 text-ink-900 font-semibold focus:outline-none focus:ring-2 focus:ring-green-700"
        />
      </div>

      {/* Per-tier rows */}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const isWinner = row.id === winnerId;
          return (
            <li
              key={row.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-[14px] px-3.5 py-3 border",
                isWinner
                  ? "border-bronze-500 bg-bronze-500/5"
                  : "border-ink-100 bg-card",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold text-sm text-ink-900">
                    {row.label}
                  </span>
                  {isWinner && (
                    <span className="inline-flex items-center gap-1 bg-bronze-500 text-white px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-[0.06em]">
                      <Sparkles className="h-2.5 w-2.5" strokeWidth={3} />
                      Best value at your volume
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-ink-500 mt-0.5">
                  {row.formula}
                </div>
              </div>
              <div
                className={cn(
                  "font-display font-bold text-lg leading-none shrink-0",
                  isWinner ? "text-bronze-600" : "text-ink-900",
                )}
              >
                {formatMoney(row.cost)}
                <span className="text-[11px] font-semibold text-ink-500 ml-0.5">
                  /mo
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] text-ink-500 mt-4 leading-relaxed">
        Quick reference: under $1,000/mo stay on Base; $1,000–$3,267
        Solo wins; $3,267+ Crew wins.
      </p>
    </section>
  );
}
