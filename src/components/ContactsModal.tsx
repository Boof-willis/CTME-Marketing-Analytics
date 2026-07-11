"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Mail, Phone, ExternalLink, X, Users } from "lucide-react";
import type { Contact } from "@/lib/types";
import { formatCurrency, formatNumber, formatDate, titleCaseName } from "@/lib/format";

/** Modal listing the contacts behind a widget as a scrolling table
 *  (name, contact info, spend, transactions, link). */
export function ContactsModal({
  open,
  onClose,
  title,
  contacts,
  total,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  contacts: Contact[];
  /** Full widget value, so we can say "N · M total" when the list is sampled. */
  total?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Every drill-down table reads most-recent → least-recent. Rows carry a date
  // (purchase date, or a lead's date added); those without one keep their order.
  const rows = useMemo(
    () => [...contacts].sort((a, b) => (b.lastPurchaseAt || "").localeCompare(a.lastPurchaseAt || "")),
    [contacts],
  );

  // Client-side pagination keeps the table fast even with hundreds of rows.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => {
    setPage(0);
  }, [open, pageSize]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const shown = rows.length;
  const sampled = typeof total === "number" && total > shown;
  // Only purchase/refund drill-downs carry per-contact money; hide those columns
  // for plain contact lists (e.g. leads). Likewise hide Tags when none exist.
  const hasValue = rows.some((c) => typeof c.purchaseValue === "number");
  const hasTags = rows.some((c) => c.tags.length > 0);
  const hasPayment = rows.some((c) => c.paidStripe || c.paidCrypto);
  const hasDate = rows.some((c) => c.lastPurchaseAt);

  const pageCount = Math.max(1, Math.ceil(shown / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const pageItems = rows.slice(start, start + pageSize);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} contacts`}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in-up"
        onClick={onClose}
      />
      <div className="card relative z-10 flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden animate-fade-in-up sm:h-[80vh]">
        <div className="flex items-start justify-between gap-3 border-b border-panel-border p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-gold/15 text-brand-gold">
              <Users size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-ink">{title}</h3>
              <p className="text-[11px] text-ink-faint">
                {shown
                  ? `${formatNumber(shown)} ${shown === 1 ? "contact" : "contacts"}`
                  : "No contacts"}
                {sampled ? ` · ${formatNumber(total as number)} total` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-panel-light hover:text-ink"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {shown === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-faint">
              No contact details available for this period.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-panel">
                <tr className="border-b border-panel-border text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  {hasTags ? <th className="px-4 py-2.5 font-medium">Tags</th> : null}
                  {hasPayment ? <th className="px-4 py-2.5 font-medium">Paid via</th> : null}
                  {hasValue ? <th className="px-4 py-2.5 text-right font-medium">Spend</th> : null}
                  {hasValue ? <th className="px-4 py-2.5 text-right font-medium">Txns</th> : null}
                  {hasDate ? <th className="px-4 py-2.5 text-right font-medium">Date</th> : null}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {pageItems.map((c, i) => (
                  <ContactRow
                    key={`${c.id}-${start + i}`}
                    contact={c}
                    showValue={hasValue}
                    showTags={hasTags}
                    showPayment={hasPayment}
                    showDate={hasDate}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {shown > pageSize || pageSize !== 20 ? (
          <div className="flex items-center justify-between gap-3 border-t border-panel-border px-4 py-2.5 text-xs text-ink-faint">
            <div className="flex items-center gap-1.5">
              <span>Rows</span>
              {[20, 50].map((n) => (
                <button
                  key={n}
                  onClick={() => setPageSize(n)}
                  className={clsx(
                    "rounded px-1.5 py-0.5 font-medium transition-colors",
                    pageSize === n ? "bg-brand-gold/20 text-ink" : "hover:text-ink",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span>
                {start + 1}–{Math.min(start + pageSize, shown)} of {formatNumber(shown)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage === 0}
                  className="rounded border border-panel-border px-2 py-1 font-medium transition-colors hover:text-ink disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= pageCount - 1}
                  className="rounded border border-panel-border px-2 py-1 font-medium transition-colors hover:text-ink disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function ContactRow({
  contact: c,
  showValue,
  showTags,
  showPayment,
  showDate,
}: {
  contact: Contact;
  showValue: boolean;
  showTags: boolean;
  showPayment: boolean;
  showDate: boolean;
}) {
  return (
    <tr className="border-b border-panel-border/50 transition-colors hover:bg-panel-light/40">
      <td className="max-w-[14rem] px-4 py-2.5 align-top">
        <div className="truncate font-medium text-ink">{titleCaseName(c.name)}</div>
      </td>
      <td className="max-w-[16rem] px-4 py-2.5 align-top">
        <div className="flex flex-col gap-0.5">
          {c.email ? (
            <a
              href={`mailto:${c.email}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
            >
              <Mail size={12} className="shrink-0 text-ink-faint" />
              <span className="truncate">{c.email}</span>
            </a>
          ) : null}
          {c.phone ? (
            <a
              href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
            >
              <Phone size={12} className="shrink-0 text-ink-faint" />
              <span className="truncate">{c.phone}</span>
            </a>
          ) : null}
          {!c.email && !c.phone ? <span className="text-xs text-ink-faint">—</span> : null}
        </div>
      </td>
      {showTags ? (
        <td className="max-w-[18rem] px-4 py-2.5 align-top">
          {c.tags.length ? (
            <div className="flex flex-wrap gap-1">
              {c.tags.map((t) => (
                <span
                  key={t}
                  className="rounded border border-white/5 bg-panel-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-ink-faint">—</span>
          )}
        </td>
      ) : null}
      {showPayment ? (
        <td className="px-4 py-2.5 align-top">
          <div className="flex flex-wrap gap-1">
            {c.paidStripe ? (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: "#635bff22", color: "#9d97ff" }}
              >
                Stripe
              </span>
            ) : null}
            {c.paidCrypto ? (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: "#f7931a22", color: "#f7931a" }}
              >
                Crypto
              </span>
            ) : null}
            {!c.paidStripe && !c.paidCrypto ? (
              <span className="text-xs text-ink-faint">—</span>
            ) : null}
          </div>
        </td>
      ) : null}
      {showValue ? (
        <td
          className="whitespace-nowrap px-4 py-2.5 text-right align-top text-sm font-semibold"
          style={{ color: typeof c.purchaseValue === "number" ? "#22c55e" : undefined }}
        >
          {typeof c.purchaseValue === "number" ? formatCurrency(c.purchaseValue) : "—"}
        </td>
      ) : null}
      {showValue ? (
        <td className="whitespace-nowrap px-4 py-2.5 text-right align-top text-sm text-ink-muted">
          {typeof c.purchaseCount === "number" ? formatNumber(c.purchaseCount) : "—"}
        </td>
      ) : null}
      {showDate ? (
        <td className="whitespace-nowrap px-4 py-2.5 text-right align-top text-sm text-ink-muted">
          {c.lastPurchaseAt ? formatDate(c.lastPurchaseAt) : "—"}
        </td>
      ) : null}
      <td className="px-4 py-2.5 text-right align-top">
        {c.url ? (
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="pill inline-flex shrink-0 px-2.5 py-1.5 text-xs"
            title="Open contact record in a new tab"
          >
            Open
            <ExternalLink size={13} />
          </a>
        ) : null}
      </td>
    </tr>
  );
}

/** Self-contained "View contacts" button that opens a {@link ContactsModal}.
 *  Renders nothing when there are no contacts to show. */
export function ContactsTrigger({
  title,
  contacts,
  total,
  label = "View contacts",
  className,
}: {
  title: string;
  contacts?: Contact[];
  total?: number;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!contacts || contacts.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          "inline-flex items-center gap-1 rounded-lg border border-panel-border bg-panel-light/60 px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:border-brand-gold/50 hover:text-ink",
          className,
        )}
      >
        <Users size={12} />
        {label}
      </button>
      <ContactsModal open={open} onClose={() => setOpen(false)} title={title} contacts={contacts} total={total} />
    </>
  );
}
