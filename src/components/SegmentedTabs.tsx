"use client";

import clsx from "clsx";

export interface SegmentTab<T extends string> {
  id: T;
  label: string;
  icon?: React.ElementType;
}

/** Pill-style segmented control used as an in-page tab header. */
export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: SegmentTab<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "inline-flex items-center gap-1 rounded-xl border border-panel-border bg-panel-light/50 p-1",
        className,
      )}
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={clsx(
              "inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-brand-gold/20 text-ink shadow-[inset_0_0_0_1px_rgba(190,176,134,0.45)]"
                : "text-ink-muted hover:bg-panel-light hover:text-ink",
            )}
          >
            {Icon ? <Icon size={15} className={isActive ? "text-brand-gold" : ""} /> : null}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
