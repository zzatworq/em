import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyPoint, HourlyPoint } from "@/lib/engine/types";
import { units } from "@/lib/engine/time";

type Row = { label: string; meter1: number; meter2: number };

function toRows(points: Array<DailyPoint | HourlyPoint>): Row[] {
  return points.map((p) => ({
    label: p.label,
    meter1: p.newMeter === "" ? 0 : Number(p.newMeter),
    meter2: p.oldMeter === "" ? 0 : Number(p.oldMeter),
  }));
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const m1 = payload.find((p) => p.dataKey === "meter1")?.value ?? 0;
  const m2 = payload.find((p) => p.dataKey === "meter2")?.value ?? 0;
  return (
    <div className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs shadow-border">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <p className="text-meter1">Meter 1 · {units(m1)} kWh</p>
      <p className="text-meter2">Meter 2 · {units(m2)} kWh</p>
      <p className="mt-1 text-muted">Total · {units(m1 + m2)} kWh</p>
    </div>
  );
}

function themeColor(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function UsageChart({
  points,
  onBarClick,
}: {
  points: Array<DailyPoint | HourlyPoint>;
  onBarClick?: (index: number) => void;
}) {
  const [ready, setReady] = useState(false);
  const [fills, setFills] = useState({ m1: "#e7e4d8", m2: "#7d9e94", grid: "#3a3c36" });
  useEffect(() => {
    setFills({
      m1: themeColor("--color-meter1", "#e7e4d8"),
      m2: themeColor("--color-meter2", "#7d9e94"),
      grid: themeColor("--color-border", "#3a3c36"),
    });
    setReady(true);
  }, []);
  const data = toRows(points);
  if (!ready) return <div className="h-80 w-full rounded-lg bg-muted/40" />;

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 4, left: -18, bottom: 0 }}
          onClick={(state) => {
            if (onBarClick && state?.activeTooltipIndex != null) {
              onBarClick(Number(state.activeTooltipIndex));
            }
          }}
        >
          <CartesianGrid stroke={fills.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: "rgba(236,235,228,0.06)" }}
          />
          <Bar dataKey="meter1" stackId="s" fill={fills.m1} maxBarSize={22} />
          <Bar dataKey="meter2" stackId="s" fill={fills.m2} radius={[3, 3, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
