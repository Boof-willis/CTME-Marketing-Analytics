"use client";

import clsx from "clsx";
import Image from "next/image";
import { LayoutDashboard, Megaphone, Sprout, BarChart3, type LucideIcon } from "lucide-react";

export type ViewId = "overview" | "paid" | "organic" | "analytics";

const NAV: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "paid", label: "Paid Traffic", icon: Megaphone },
  { id: "organic", label: "Organic Traffic", icon: Sprout },
  { id: "analytics", label: "Web Analytics", icon: BarChart3 },
];

export function Sidebar({
  active,
  onChange,
}: {
  active: ViewId;
  onChange: (v: ViewId) => void;
}) {
  return (
    <aside className="sticky top-0 flex h-screen w-[76px] flex-col items-center gap-1 border-r border-panel-border bg-canvas-800/60 py-5 lg:w-[200px] lg:items-stretch lg:px-3">
      <div className="mb-7 flex flex-col items-center gap-1.5 px-2 lg:items-start lg:px-1">
        <Image
          src="/ctme-logo.png"
          alt="Crypto Tax Made Easy"
          width={1024}
          height={576}
          priority
          className="h-auto w-[42px] object-contain lg:w-[150px]"
        />
        <p className="hidden text-[10px] uppercase tracking-[0.2em] text-ink-faint lg:block">
          Marketing
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={clsx(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                "justify-center lg:justify-start",
                isActive
                  ? "bg-brand-gold/15 text-ink shadow-[inset_0_0_0_1px_rgba(190,176,134,0.4)]"
                  : "text-ink-muted hover:bg-panel-light/60 hover:text-ink",
              )}
              title={item.label}
            >
              <Icon size={19} className={isActive ? "text-brand-gold" : ""} />
              <span className="hidden lg:inline">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto hidden px-2 lg:block">
        <p className="text-[10px] leading-tight text-ink-faint">
          GHL · Stripe · Meta · Google · GA4
        </p>
      </div>
    </aside>
  );
}
