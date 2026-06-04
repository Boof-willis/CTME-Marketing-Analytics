"use client";

import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { Metric } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { DeltaBadge } from "./ui";

export function KpiCard({
  label,
  metric,
  display,
  icon: Icon,
  color = "#3b82f6",
  higherIsBetter = true,
  sublabel,
}: {
  label: string;
  metric: Metric;
  display: string;
  icon: LucideIcon;
  color?: string;
  higherIsBetter?: boolean;
  sublabel?: string;
}) {
  return (
    <div className="card card-hover flex flex-col justify-between overflow-hidden p-4">
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}1f`, color }}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="label truncate">{label}</p>
          <p className="mt-0.5 truncate text-2xl font-bold leading-tight text-ink">
            {display}
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            <DeltaBadge value={metric.deltaPct} higherIsBetter={higherIsBetter} />
            {sublabel ? (
              <span className="truncate text-[11px] text-ink-faint">{sublabel}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className={clsx("mt-3 -mx-4 -mb-4")}>
        <Sparkline data={metric.series} color={color} />
      </div>
    </div>
  );
}

/** Compact KPI tile without a sparkline — used for ratio/cost KPIs.
 *  Pass `fillPct` (0–100) for percentage metrics to show a meter that reflects
 *  the actual value. Omit it for unbounded metrics (currency, counts) — the bar
 *  is hidden rather than shown at an arbitrary fixed width. */
export function StatTile({
  label,
  value,
  color = "#3b82f6",
  hint,
  good,
  fillPct,
}: {
  label: string;
  value: string;
  color?: string;
  hint?: string;
  good?: boolean | null;
  fillPct?: number | null;
}) {
  const hasMeter = typeof fillPct === "number" && Number.isFinite(fillPct);
  const width = hasMeter ? Math.max(0, Math.min(100, fillPct as number)) : 0;
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p
        className="mt-1 text-2xl font-bold leading-tight"
        style={{ color: good === undefined || good === null ? "#e7ecf6" : good ? "#22c55e" : "#f59e0b" }}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] leading-tight text-ink-faint">{hint}</p> : null}
      {hasMeter ? (
        <div className="mt-2 h-1 w-full rounded-full bg-panel-light">
          <div
            className="h-1 rounded-full transition-all"
            style={{ width: `${width}%`, backgroundColor: color }}
          />
        </div>
      ) : null}
    </div>
  );
}
