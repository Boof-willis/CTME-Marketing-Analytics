"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatDelta } from "@/lib/format";

/** Period-over-period change badge. higherIsBetter flips the color logic. */
export function DeltaBadge({
  value,
  higherIsBetter = true,
  className,
}: {
  value: number | null;
  higherIsBetter?: boolean;
  className?: string;
}) {
  if (value === null || Number.isNaN(value)) {
    return <span className={clsx("text-xs text-ink-faint", className)}>—</span>;
  }
  const positive = value >= 0;
  const good = higherIsBetter ? positive : !positive;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 text-xs font-semibold",
        good ? "text-good" : "text-bad",
        className,
      )}
    >
      <Icon size={13} strokeWidth={2.5} />
      {formatDelta(value)}
    </span>
  );
}

export function SectionTitle({
  icon: Icon,
  children,
  className,
}: {
  icon?: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      {Icon ? <Icon size={18} className="text-ink-muted" /> : null}
      <h3 className="text-base font-semibold text-ink">{children}</h3>
    </div>
  );
}

/** Small "what does this measure" definition shown under KPI tiles. */
export function Formula({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] leading-tight text-ink-faint">{children}</p>;
}
