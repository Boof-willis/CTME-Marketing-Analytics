"use client";

import clsx from "clsx";
import type { DashboardData } from "@/lib/types";

export function SourcesBadge({ sources }: { sources: DashboardData["meta"]["sources"] }) {
  const entries = Object.entries(sources);
  const anyLive = entries.some(([, v]) => v === "live");
  return (
    <div
      className="group relative flex items-center gap-1.5 rounded-lg border border-panel-border bg-panel-light px-2.5 py-2"
      title="Data source status"
    >
      <span
        className={clsx(
          "h-2 w-2 rounded-full",
          anyLive ? "bg-good" : "bg-amber-400",
        )}
      />
      <span className="text-xs text-ink-muted">{anyLive ? "Live" : "Demo data"}</span>
      <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-48 rounded-lg border border-panel-border bg-panel p-2 text-xs shadow-card group-hover:block">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-0.5">
            <span className="capitalize text-ink-muted">{k}</span>
            <span
              className={
                v === "live" ? "text-good" : v === "disconnected" ? "text-amber-400" : "text-ink-faint"
              }
            >
              {v === "live" ? "live" : v === "disconnected" ? "reconnect" : "not connected"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
