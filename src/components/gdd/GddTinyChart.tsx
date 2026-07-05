// GddTinyChart — small inline AreaChart (~80px tall) showing the trailing +
// forward cumulative GDD curve, with horizontal reference lines at the 100 /
// 200 thresholds that bracket the crabgrass pre-emergent window. Used inside
// PreEmergentAlert when the operator is in the actionable zone.
//
// Deliberately minimal: no axes, no tooltip, no grid. The numbers live in the
// parent card; the chart is just a "trend hint" so the operator can see at a
// glance whether they're early in the window or late.
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from "recharts";
import type { GddSeriesPoint } from "@/lib/gdd";

interface Props {
  series: GddSeriesPoint[];
  // Color hint: "open" / "closing" tints the area fill to match the status
  // banner. Anything else gets the default green.
  tone?: "open" | "closing";
  height?: number;
}

export default function GddTinyChart({ series, tone = "open", height = 80 }: Props) {
  if (!series || series.length === 0) return null;

  const stroke = tone === "closing" ? "hsl(var(--accent-500))" : "hsl(var(--brand-700))";
  const fill =
    tone === "closing" ? "hsl(var(--accent-500) / 0.18)" : "hsl(var(--brand-700) / 0.18)";

  // Slight padding above the highest value so the 200 reference line is
  // always visible even if cumulative hasn't reached it yet.
  const maxValue = Math.max(...series.map((s) => s.cumulative), 220);

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={series}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
        >
          {/* Hidden Y axis fixes the value domain so the reference lines sit
              consistently regardless of zip-to-zip variation. */}
          <YAxis hide domain={[0, maxValue]} />
          <ReferenceLine
            y={100}
            stroke="hsl(var(--brand-700))"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <ReferenceLine
            y={200}
            stroke="hsl(var(--accent-500))"
            strokeDasharray="3 3"
            strokeOpacity={0.6}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke={stroke}
            strokeWidth={1.8}
            fill={fill}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
