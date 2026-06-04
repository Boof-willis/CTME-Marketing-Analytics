"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/types";

export interface RangeState {
  preset: "today" | "7d" | "28d" | "90d" | "mtd" | "lifetime" | "custom";
  start: string;
  end: string;
}

function toQuery(range: RangeState): string {
  const p = new URLSearchParams();
  if (range.preset === "lifetime") {
    p.set("lifetime", "1");
  } else {
    p.set("start", range.start);
    p.set("end", range.end);
  }
  // Pass through the optional access key from the embed URL.
  if (typeof window !== "undefined") {
    const k = new URLSearchParams(window.location.search).get("k");
    if (k) p.set("k", k);
  }
  return p.toString();
}

export function useMetrics(range: RangeState) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/metrics?${toQuery(range)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((d: DashboardData) => {
        if (!cancelled) setData(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return { data, loading, error };
}
