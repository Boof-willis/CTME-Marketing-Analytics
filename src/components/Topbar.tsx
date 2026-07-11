"use client";

import { useState } from "react";
import clsx from "clsx";
import { Calendar, Infinity as InfinityIcon, RefreshCw } from "lucide-react";
import type { RangeState } from "@/hooks/useMetrics";
import { format, subDays, startOfMonth } from "date-fns";

const PRESETS: { id: RangeState["preset"]; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7D" },
  { id: "28d", label: "28D" },
  { id: "90d", label: "90D" },
  { id: "mtd", label: "MTD" },
  { id: "lifetime", label: "Lifetime" },
];

function rangeForPreset(preset: RangeState["preset"]): RangeState {
  const end = new Date();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  switch (preset) {
    case "today":
      return { preset, start: iso(end), end: iso(end) };
    case "7d":
      return { preset, start: iso(subDays(end, 6)), end: iso(end) };
    case "90d":
      return { preset, start: iso(subDays(end, 89)), end: iso(end) };
    case "mtd":
      return { preset, start: iso(startOfMonth(end)), end: iso(end) };
    case "lifetime":
      return { preset, start: iso(subDays(end, 730)), end: iso(end) };
    case "28d":
    default:
      return { preset: "28d", start: iso(subDays(end, 27)), end: iso(end) };
  }
}

export { rangeForPreset };

export function Topbar({
  title,
  subtitle,
  accent,
  range,
  onRangeChange,
  rangeLabel,
  onRefresh,
  sourcesBadge,
  rangeControl,
}: {
  title: React.ReactNode;
  subtitle: string;
  accent: string;
  range: RangeState;
  onRangeChange: (r: RangeState) => void;
  rangeLabel: string;
  onRefresh: () => void;
  sourcesBadge?: React.ReactNode;
  /** Replaces the preset/date picker with a custom control (e.g. the Operations
   *  tab's Year / Lifetime selector), so a tab has a single date control. */
  rangeControl?: React.ReactNode;
}) {
  const [custom, setCustom] = useState(false);

  return (
    <div className="card mb-5 flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xl font-bold text-ink">{title}</div>
        <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {sourcesBadge}

        {rangeControl ? (
          rangeControl
        ) : (
          <>
        <div className="flex items-center rounded-lg border border-panel-border bg-panel-light p-0.5">
          {PRESETS.map((p) => {
            const active = range.preset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setCustom(false);
                  onRangeChange(rangeForPreset(p.id));
                }}
                className={clsx(
                  "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active ? "font-semibold" : "text-ink-muted hover:text-ink",
                )}
                style={active ? { backgroundColor: accent, color: "#0A0A0F" } : undefined}
              >
                {p.id === "lifetime" ? <InfinityIcon size={13} /> : null}
                {p.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setCustom((c) => !c)}
          className={clsx("pill", custom && "border-[#beb086]/60")}
          title="Custom date range"
        >
          <Calendar size={15} />
          <span className="hidden sm:inline">{range.preset === "custom" ? rangeLabel : "Custom"}</span>
        </button>
          </>
        )}

        {!rangeControl && custom ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={range.start}
              max={range.end}
              onChange={(e) => onRangeChange({ ...range, preset: "custom", start: e.target.value })}
              className="rounded-lg border border-panel-border bg-panel-light px-2 py-1.5 text-xs text-ink [color-scheme:dark]"
            />
            <span className="text-ink-faint">–</span>
            <input
              type="date"
              value={range.end}
              min={range.start}
              onChange={(e) => onRangeChange({ ...range, preset: "custom", end: e.target.value })}
              className="rounded-lg border border-panel-border bg-panel-light px-2 py-1.5 text-xs text-ink [color-scheme:dark]"
            />
          </div>
        ) : null}

        <button onClick={onRefresh} className="pill" title="Refresh data">
          <RefreshCw size={15} />
        </button>
      </div>
    </div>
  );
}
