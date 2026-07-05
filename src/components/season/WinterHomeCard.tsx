import { Link } from "react-router-dom";
import { ArrowRight, CloudSnow, Snowflake } from "lucide-react";
import { useForecast, useUserZip } from "@/lib/weather";

// WinterHomeCard — replaces the "Today's route" card on Home when the
// operator is in winter mode. Two states:
//
//   - Storm imminent (any snow-condition day in the next 3): show a CTA
//     to start a storm route + the storm days strip.
//   - No snow in the lookahead: standby card with tomorrow's icon.
//
// The "+ Start storm route" CTA links to the existing Routes page which
// has the universal "+ create" affordance — we deliberately don't
// duplicate route creation here.
//
// TODO: wire real snow-accumulation lookahead. The forecast edge fn
// returns precipitation_pct but not snowfall-inches. For v1 we treat any
// day where condition === 'snow' as a storm day.

export default function WinterHomeCard() {
  const zipQ = useUserZip();
  const forecast = useForecast(zipQ.data);

  const lookahead = (forecast.data ?? []).slice(0, 3);
  const stormDays = lookahead.filter((d) => d.condition === "snow");
  const hasStorm = stormDays.length > 0;

  // The "tomorrow" cell is index 1 in the canonical forecast list (today
  // is index 0). When the forecast hasn't loaded we leave the icon area
  // blank rather than skeletoning — it's a tiny secondary visual.
  const tomorrow = forecast.data?.[1];

  return (
    <section className="mx-4 mb-3">
      <div className="flex items-center justify-between px-1 pb-2">
        <h2 className="text-[13px] font-semibold text-neutral-700 tracking-[0.2px]">
          Today's storm
        </h2>
        <span className="text-xs text-neutral-500 inline-flex items-center gap-1">
          <Snowflake className="h-3 w-3" strokeWidth={1.8} />
          Winter mode
        </span>
      </div>

      <div className="tp-card p-4">
        {hasStorm ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-11 w-11 rounded-full bg-[hsl(var(--rain-bg))] text-[hsl(var(--rain))] grid place-items-center shrink-0">
                <CloudSnow className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-neutral-900">
                  Snow expected — storm route ready
                </div>
                <div className="text-[11.5px] text-neutral-500 mt-0.5">
                  {stormDays.length} snow day
                  {stormDays.length === 1 ? "" : "s"} in the next 72h
                </div>
              </div>
            </div>

            {/* Tiny strip showing the next 3 lookahead days */}
            <div className="flex gap-1.5 mb-3">
              {lookahead.map((d) => {
                const isSnow = d.condition === "snow";
                return (
                  <div
                    key={d.date}
                    className={
                      isSnow
                        ? "flex-1 rounded-lg bg-[hsl(var(--rain-bg))] text-[hsl(var(--rain))] flex flex-col items-center py-2"
                        : "flex-1 rounded-lg bg-neutral-100/50 text-neutral-500 flex flex-col items-center py-2"
                    }
                  >
                    <CloudSnow
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                      style={{ opacity: isSnow ? 1 : 0.35 }}
                    />
                    <div className="tp-num text-[11.5px] font-semibold mt-0.5">
                      {d.temp_high}°
                    </div>
                  </div>
                );
              })}
            </div>

            <Link
              to="/routes"
              className="w-full rounded-[14px] bg-[hsl(var(--rain))] text-white py-3.5 font-bold text-[15px] tracking-[0.2px] flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              <CloudSnow className="h-4 w-4" strokeWidth={2} />
              Start storm route
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
            </Link>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-full bg-neutral-100 text-neutral-500 grid place-items-center shrink-0">
                <Snowflake className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-neutral-900">
                  No snow in the forecast — standby
                </div>
                <div className="text-[11.5px] text-neutral-500 mt-0.5">
                  {tomorrow
                    ? `Tomorrow: ${tomorrow.conditions_label || tomorrow.condition} · ${tomorrow.temp_high}°`
                    : "Watching the next 3 days"}
                </div>
              </div>
            </div>

            <Link
              to="/routes"
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[hsl(var(--rain))] hover:underline"
            >
              Open Routes
              <ArrowRight className="h-3 w-3" strokeWidth={2.4} />
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
