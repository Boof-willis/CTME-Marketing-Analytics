"use client";

import type { FunnelStage } from "@/lib/types";
import { FunnelChart, type FunnelStage as ChartStage } from "@/components/funnel-chart";
import { formatNumber } from "@/lib/format";

// Animated, layered funnel built on the FunnelChart component. Keeps the same
// external API the dashboard already used (stages + accent) and adapts our
// funnel data into the chart's stage shape.
export function Funnel({
  stages,
  accent = "#3b82f6",
  orientation = "horizontal",
}: {
  stages: FunnelStage[];
  accent?: string;
  orientation?: "horizontal" | "vertical";
}) {
  // Funnels often drop off steeply (e.g. 195 clicks -> a handful of purchases),
  // which would render later stages as invisible slivers. Give each stage a
  // floored geometry thickness so it stays legible, while the percentage badge
  // still reflects the true share of the top stage.
  const top = Math.max(...stages.map((s) => s.value), 1);
  const data: ChartStage[] = stages.map((s) => {
    const frac = s.value / top;
    const geomFrac = s.value > 0 ? 0.18 + 0.82 * frac : 0.07;
    return {
      label: s.label,
      value: s.value,
      geometryValue: geomFrac * top,
      displayValue: formatNumber(s.value, { compact: true }),
      // Subtle gradient on each segment for a richer, glassy look.
      gradient: [
        { offset: 0, color: accent },
        { offset: 1, color: shade(accent, -0.25) },
      ],
    };
  });

  const horizontal = orientation === "horizontal";

  return (
    <div
      className={
        horizontal
          ? "mx-auto w-full max-w-4xl px-2 sm:px-4"
          : "mx-auto w-full max-w-md px-4"
      }
    >
      <FunnelChart
        data={data}
        orientation={orientation}
        color={accent}
        layers={3}
        edges="curved"
        gap={6}
        staggerDelay={0.1}
        // Percentage badge = share of the top-of-funnel stage.
        formatPercentage={(p) => `${Math.round(p)}%`}
        // Fixed height + auto aspect-ratio so the funnel fills the card width
        // without ballooning to an enormous size on wide screens.
        style={{ aspectRatio: "auto", height: horizontal ? 260 : 460 }}
      />
    </div>
  );
}

// Lighten (positive amt) or darken (negative amt) a hex color.
function shade(hex: string, amt: number): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const num = parseInt(full, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  r = Math.round((t - r) * p) + r;
  g = Math.round((t - g) * p) + g;
  b = Math.round((t - b) * p) + b;
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
