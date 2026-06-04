"use client";

import clsx from "clsx";

/** Base shimmering placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

/** Mirrors a KpiCard: icon chip, label, value and a sparkline strip. */
function KpiCardSkeleton() {
  return (
    <div className="card flex flex-col justify-between overflow-hidden p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-2.5 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      </div>
      <Skeleton className="mt-3 h-10 w-full rounded-lg" />
    </div>
  );
}

/** Mirrors a StatTile: label, value, hint, optional meter. */
function StatTileSkeleton() {
  return (
    <div className="card space-y-2 p-4">
      <Skeleton className="h-2.5 w-1/2" />
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-2 w-3/4" />
    </div>
  );
}

/** A card-sized chart block with a faux plotted area. */
function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={clsx("card p-4", className)}>
      <Skeleton className="mb-4 h-3 w-40" />
      <Skeleton className="h-56 w-full rounded-lg" />
    </div>
  );
}

function KpiRow({ count }: { count: number }) {
  const cols =
    count >= 6 ? "lg:grid-cols-6" : count === 5 ? "lg:grid-cols-5" : count === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <div className={clsx("grid grid-cols-2 gap-4", cols)}>
      {Array.from({ length: count }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      <KpiRow count={5} />
      <KpiRow count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartSkeleton className="lg:col-span-2" />
        <ChartSkeleton />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartSkeleton />
        <ChartSkeleton className="lg:col-span-2" />
      </div>
    </div>
  );
}

function PaidSkeleton() {
  return (
    <div className="space-y-5">
      <KpiRow count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>
    </div>
  );
}

function PlatformSkeleton() {
  return (
    <div className="space-y-5">
      <KpiRow count={6} />
      <div className="card grid grid-cols-2 gap-px overflow-hidden bg-panel-border lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 bg-panel p-4">
            <Skeleton className="h-2.5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ))}
      </div>
      <ChartSkeleton />
      <ChartSkeleton />
    </div>
  );
}

function OrganicSkeleton() {
  return (
    <div className="space-y-5">
      <KpiRow count={6} />
      <ChartSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
      </div>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-5">
      <KpiRow count={5} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>
      <ChartSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}

export type SkeletonVariant = "overview" | "paid" | "platform" | "organic" | "analytics";

/** Layout-aware loading skeleton, fading in so a fast load doesn't flash. */
export function DashboardSkeleton({ variant }: { variant: SkeletonVariant }) {
  const content =
    variant === "overview" ? (
      <OverviewSkeleton />
    ) : variant === "paid" ? (
      <PaidSkeleton />
    ) : variant === "platform" ? (
      <PlatformSkeleton />
    ) : variant === "analytics" ? (
      <AnalyticsSkeleton />
    ) : (
      <OrganicSkeleton />
    );
  return (
    <div className="animate-fade-in-up" aria-busy="true" aria-live="polite">
      {content}
    </div>
  );
}

/** Thin indeterminate bar pinned to the top of a container for background refetches. */
export function TopProgressBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
      <div className="progress-bar" />
    </div>
  );
}
