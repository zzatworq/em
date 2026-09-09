import type { GeneralSettings } from "./types";
import { ESTIMATION_PROFILE } from "./defaults";

const DAY_MS = 86400000;

export function getBillingPeriodStart(datetime: Date, gs: GeneralSettings): Date {
  const start = new Date(
    datetime.getFullYear(),
    datetime.getMonth(),
    gs.billingDay,
    gs.billingHour,
    gs.billingMinute,
    0,
    0,
  );
  if (datetime < start) {
    return new Date(
      datetime.getFullYear(),
      datetime.getMonth() - 1,
      gs.billingDay,
      gs.billingHour,
      gs.billingMinute,
      0,
      0,
    );
  }
  return start;
}

export function addMonth(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

export function getFivePmDayStart(datetime: Date, gs: GeneralSettings): Date {
  const d = new Date(
    datetime.getFullYear(),
    datetime.getMonth(),
    datetime.getDate(),
    gs.billingHour,
    gs.billingMinute,
    0,
    0,
  );
  if (datetime < d) d.setDate(d.getDate() - 1);
  return d;
}

export function billingPeriodLengthDays(periodEnd: Date): number {
  const start = new Date(
    periodEnd.getFullYear(),
    periodEnd.getMonth() - 1,
    periodEnd.getDate(),
    periodEnd.getHours(),
    periodEnd.getMinutes(),
    periodEnd.getSeconds(),
    periodEnd.getMilliseconds(),
  );
  const days = (periodEnd.getTime() - start.getTime()) / DAY_MS;
  return days > 0 ? days : 30;
}

export function formatBillingMonth(date: Date): string {
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function profileWeightAt(datetime: Date): number {
  return Math.max(0.000001, Number(ESTIMATION_PROFILE[datetime.getHours()] || 0));
}

export function profileWeightBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let total = 0;
  let cursor = new Date(start);
  while (cursor < end) {
    const nextHour = new Date(cursor);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    const segmentEnd = nextHour < end ? nextHour : end;
    const minutes = (segmentEnd.getTime() - cursor.getTime()) / 60000;
    total += profileWeightAt(cursor) * minutes;
    cursor = segmentEnd;
  }
  return total;
}

export function money(value: number | "" | null | undefined): string {
  if (value === "" || value == null || Number.isNaN(Number(value))) return "—";
  return `Rs ${Number(value).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

export function units(value: number | "" | null | undefined, digits = 2): string {
  if (value === "" || value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}
