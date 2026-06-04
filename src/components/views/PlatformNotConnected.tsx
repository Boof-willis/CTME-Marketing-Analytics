"use client";

import { PlugZap } from "lucide-react";

// Shown in a platform tab (Meta / Google) when that integration has no live
// credentials. We intentionally render NO numbers here — an unconnected source
// must never display demo/placeholder data that could be mistaken for real.
export function PlatformNotConnected({
  platform,
  icon: Icon,
  envHint,
}: {
  platform: string;
  icon?: React.ElementType;
  envHint?: string;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-panel-border bg-panel-light/50">
        {Icon ? <Icon size={26} /> : <PlugZap size={26} className="text-ink-muted" />}
      </div>
      <h3 className="text-lg font-semibold text-ink">{platform} isn’t connected</h3>
      <p className="max-w-md text-sm text-ink-muted">
        No live {platform} data is available, so nothing is shown here. Connect the
        {" "}
        {platform} integration to populate this tab with spend, clicks and results.
      </p>
      {envHint ? (
        <p className="mt-1 rounded-lg border border-panel-border bg-panel px-3 py-1.5 font-mono text-[11px] text-ink-faint">
          {envHint}
        </p>
      ) : null}
    </div>
  );
}
