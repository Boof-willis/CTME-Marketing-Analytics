"use client";

import { useState } from "react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { Users } from "lucide-react";
import type { Contact, Metric } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { DeltaBadge } from "./ui";
import { ContactsModal } from "./ContactsModal";

export function KpiCard({
  label,
  metric,
  display,
  icon: Icon,
  color = "#3b82f6",
  higherIsBetter = true,
  sublabel,
  clickableWhenEmpty = false,
}: {
  label: string;
  metric: Metric;
  display: string;
  icon: LucideIcon;
  color?: string;
  higherIsBetter?: boolean;
  sublabel?: string;
  /** Allow opening the drill-down even with no contacts (e.g. a zero-value
   *  Refunds card that should still open to confirm "no refunds this period"). */
  clickableWhenEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contacts = metric.contacts ?? [];
  const clickable = contacts.length > 0 || clickableWhenEmpty;

  return (
    <div
      className={clsx(
        "card card-hover flex flex-col justify-between overflow-hidden p-4",
        clickable && "group cursor-pointer hover:border-brand-gold/40",
      )}
      onClick={clickable ? () => setOpen(true) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen(true);
              }
            }
          : undefined
      }
    >
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
        {clickable ? (
          <span
            className="flex items-center gap-1 text-[10px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
            title="View contacts"
          >
            <Users size={12} />
          </span>
        ) : null}
      </div>
      <div className={clsx("mt-3 -mx-4 -mb-4")}>
        <Sparkline data={metric.series} color={color} />
      </div>
      {clickable ? (
        <ContactsModal
          open={open}
          onClose={() => setOpen(false)}
          title={label}
          contacts={contacts}
          total={metric.value}
        />
      ) : null}
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
  contacts,
  contactsTitle,
  contactsTotal,
}: {
  label: string;
  value: string;
  color?: string;
  hint?: string;
  good?: boolean | null;
  fillPct?: number | null;
  /** Optional drill-down: the contacts behind this tile. */
  contacts?: Contact[];
  /** Heading for the drill-down modal (defaults to the tile label). */
  contactsTitle?: string;
  /** Full count behind the tile, so the modal can say "showing N of M". */
  contactsTotal?: number;
}) {
  const [open, setOpen] = useState(false);
  const list = contacts ?? [];
  const clickable = list.length > 0;
  const hasMeter = typeof fillPct === "number" && Number.isFinite(fillPct);
  const width = hasMeter ? Math.max(0, Math.min(100, fillPct as number)) : 0;
  return (
    <div
      className={clsx("card p-4", clickable && "group cursor-pointer card-hover hover:border-brand-gold/40")}
      onClick={clickable ? () => setOpen(true) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen(true);
              }
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between">
        <p className="label">{label}</p>
        {clickable ? (
          <Users
            size={12}
            className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
          />
        ) : null}
      </div>
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
      {clickable ? (
        <ContactsModal
          open={open}
          onClose={() => setOpen(false)}
          title={contactsTitle ?? label}
          contacts={list}
          total={contactsTotal}
        />
      ) : null}
    </div>
  );
}
