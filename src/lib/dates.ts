import { addDays, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import type { DateRange } from "./types";

export function toISO(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Build an inclusive list of ISO dates between start and end. */
export function eachDay(range: DateRange): string[] {
  const start = parseISO(range.start);
  const end = parseISO(range.end);
  const out: string[] = [];
  const n = Math.max(0, differenceInCalendarDays(end, start));
  for (let i = 0; i <= n; i++) out.push(toISO(addDays(start, i)));
  return out;
}

/** Number of inclusive days in the range. */
export function rangeLength(range: DateRange): number {
  return differenceInCalendarDays(parseISO(range.end), parseISO(range.start)) + 1;
}

/** The immediately-preceding period of equal length (for delta calculations). */
export function previousRange(range: DateRange): DateRange {
  const len = rangeLength(range);
  const prevEnd = subDays(parseISO(range.start), 1);
  const prevStart = subDays(prevEnd, len - 1);
  return { start: toISO(prevStart), end: toISO(prevEnd), lifetime: false };
}

export function humanRange(range: DateRange): string {
  if (range.lifetime) return "Lifetime";
  const s = parseISO(range.start);
  const e = parseISO(range.end);
  // Single-day range (e.g. the "Today" preset) reads better as one date.
  if (range.start === range.end) return format(s, "MMM d, yyyy");
  return `${format(s, "MMM d, yyyy")} – ${format(e, "MMM d, yyyy")}`;
}

/** Parse query params into a normalized DateRange. */
export function parseRange(params: URLSearchParams): DateRange {
  const lifetime = params.get("lifetime") === "1" || params.get("preset") === "lifetime";
  if (lifetime) {
    // Lifetime: anchor a wide window so demo series have history to draw.
    const end = new Date();
    const start = subDays(end, 365 * 2);
    return { start: toISO(start), end: toISO(end), lifetime: true };
  }
  const end = params.get("end") ? parseISO(params.get("end")!) : new Date();
  const start = params.get("start")
    ? parseISO(params.get("start")!)
    : subDays(end, 27);
  return { start: toISO(start), end: toISO(end), lifetime: false };
}
