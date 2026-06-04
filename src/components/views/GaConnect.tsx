"use client";

import { useState } from "react";
import { BarChart3, ExternalLink, Loader2 } from "lucide-react";

// Shown on the Web Analytics tab when GA4 is configured but has no valid token
// (never connected, or access was revoked). Sends the user through the in-app
// OAuth flow; whoever completes it owns the connection going forward.
export function GaConnect({ revoked }: { revoked?: boolean }) {
  const [loading, setLoading] = useState(false);

  function connect() {
    setLoading(true);
    const k = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("k") : null;
    window.location.href = `/api/ga/connect${k ? `?k=${encodeURIComponent(k)}` : ""}`;
  }

  return (
    <div className="card flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-panel-border bg-panel-light/50">
        <BarChart3 size={26} className="text-brand-gold" />
      </div>
      <h3 className="text-lg font-semibold text-ink">
        {revoked ? "Google Analytics needs reconnecting" : "Connect Google Analytics"}
      </h3>
      <p className="max-w-md text-sm text-ink-muted">
        {revoked
          ? "Access to the Google Analytics account was removed or expired, so live data can't be loaded. Sign in with a Google account that has access to the property to restore it."
          : "Sign in with a Google account that has access to the GA4 property to load sessions, traffic sources, top pages and conversions. The account you use owns the connection."}
      </p>
      <button
        onClick={connect}
        disabled={loading}
        className="pill border-brand-gold/40 bg-brand-gold/15 font-medium text-ink hover:border-brand-gold disabled:opacity-60"
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
        {revoked ? "Reconnect Google Analytics" : "Connect Google Analytics"}
      </button>
      <p className="max-w-md text-[11px] text-ink-faint">
        You&apos;ll be redirected to Google to grant read-only Analytics access.
      </p>
    </div>
  );
}

// Thin dismissible banner reflecting the result of the OAuth round-trip
// (?ga=connected|error|noref in the URL after returning from Google).
export function GaConnectBanner({ status }: { status: string }) {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  const ok = status === "connected";
  const msg = ok
    ? "Google Analytics connected. Live data will appear shortly."
    : status === "noref"
      ? "Google didn't return a refresh token. Please try connecting again."
      : "Couldn't connect Google Analytics. Please try again.";
  return (
    <div
      className={`card flex items-center justify-between gap-3 px-4 py-3 text-sm ${
        ok ? "border-good/40 text-good" : "border-bad/40 text-bad"
      }`}
    >
      <span>{msg}</span>
      <button onClick={() => setShown(false)} className="text-ink-faint hover:text-ink">
        Dismiss
      </button>
    </div>
  );
}
