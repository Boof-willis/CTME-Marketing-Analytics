"use client";

import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DonutSlice } from "@/lib/types";
import { shortDate, formatNumber } from "@/lib/format";

const axisStyle = { fontSize: 10, fill: "#5d6b88" };

/** Shared dark-theme tooltip styling with readable, high-contrast text. */
const tooltipContentStyle = {
  background: "#16161F",
  border: "1px solid #2e2e3a",
  borderRadius: 10,
  boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
} as const;
const tooltipLabelStyle = { color: "#a1a1aa", fontSize: 11, marginBottom: 2 } as const;
const tooltipItemStyle = { color: "#f4f4f5", fontSize: 12 } as const;

/** Dual-series area/line chart (e.g. Revenue vs Purchases, Investment vs Conversions). */
export function ComboChart({
  data,
  series,
  height = 260,
}: {
  data: Record<string, number | string>[];
  series: { key: string; label: string; color: string; type?: "area" | "line"; yAxis?: "left" | "right" }[];
  height?: number;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a2438" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => shortDate(String(v))}
            tick={axisStyle}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            yAxisId="left"
            tick={axisStyle}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => formatNumber(Number(v), { compact: true })}
          />
          <YAxis yAxisId="right" orientation="right" hide />
          <Tooltip
            labelFormatter={(v) => shortDate(String(v))}
            formatter={(value: number, name: string) => [formatNumber(value, { compact: true }), name]}
            contentStyle={tooltipContentStyle}
            labelStyle={tooltipLabelStyle}
            itemStyle={tooltipItemStyle}
            cursor={{ stroke: "#3f3f46", strokeWidth: 1 }}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, color: "#8a99b8", paddingBottom: 6 }}
          />
          {series.map((s) =>
            s.type === "line" ? (
              <Line
                key={s.key}
                yAxisId={s.yAxis ?? "left"}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2.2}
                dot={false}
                isAnimationActive={false}
              />
            ) : (
              <Area
                key={s.key}
                yAxisId={s.yAxis ?? "left"}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2.2}
                fill={`url(#g-${s.key})`}
                isAnimationActive={false}
                dot={false}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({
  slices,
  centerLabel,
  centerValue,
  height = 240,
  showLegend = true,
}: {
  slices: DonutSlice[];
  centerLabel?: string;
  centerValue?: string;
  height?: number;
  showLegend?: boolean;
}) {
  const total = slices.reduce((a, b) => a + b.value, 0);
  return (
    <div style={{ height }} className="flex w-full items-center gap-3">
      <div className="relative h-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.label} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [formatNumber(value), name]}
              contentStyle={tooltipContentStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-ink">{centerValue ?? formatNumber(total)}</span>
          {centerLabel ? <span className="text-[10px] text-ink-faint">{centerLabel}</span> : null}
        </div>
      </div>
      {showLegend ? (
      <ul className="flex max-h-full flex-col gap-1.5 overflow-y-auto pr-1 text-xs">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="truncate text-ink-muted">{s.label}</span>
            <span className="ml-auto font-medium text-ink">
              {total ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
      ) : null}
    </div>
  );
}
