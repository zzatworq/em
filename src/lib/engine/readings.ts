import type { CarriedReading, ReadingInput } from "./types";
import { profileWeightBetween } from "./time";

export function applyCarryForward(readings: ReadingInput[]): CarriedReading[] {
  let lastNew: number | null = null;
  let lastOld: number | null = null;
  return readings.map((r) => {
    if (r.newInput !== null) lastNew = r.newInput;
    if (r.oldInput !== null) lastOld = r.oldInput;
    return { ...r, newReading: lastNew, oldReading: lastOld };
  });
}

export function calculateDifference(start: number | null, end: number | null): number | "" {
  if (start == null || end == null) return "";
  const d = end - start;
  return d < 0 ? "" : d;
}

export function sumKnown(a: number | "", b: number | ""): number | "" {
  if (a === "" && b === "") return "";
  return (a === "" ? 0 : a) + (b === "" ? 0 : b);
}

function interpolateMeter(
  before: CarriedReading | null,
  after: CarriedReading | null,
  target: Date,
  meter: "new" | "old",
): number | null {
  const key = meter === "new" ? "newReading" : "oldReading";
  if (!before || before[key] == null) return null;
  if (before.datetime === target.getTime()) return before[key];
  if (!after || after[key] == null || after.datetime <= before.datetime) return before[key];
  const b = before[key] as number;
  const a = after[key] as number;
  if (a < b) return null;
  const beforeDt = new Date(before.datetime);
  const afterDt = new Date(after.datetime);
  const totalWeight = profileWeightBetween(beforeDt, afterDt);
  if (totalWeight <= 0) {
    const fraction = (target.getTime() - before.datetime) / (after.datetime - before.datetime);
    return b + (a - b) * fraction;
  }
  const targetWeight = profileWeightBetween(beforeDt, target);
  const fraction = Math.max(0, Math.min(1, targetWeight / totalWeight));
  return b + (a - b) * fraction;
}

export function interpolatedReadingsAt(readings: CarriedReading[], boundary: Date) {
  let before: CarriedReading | null = null;
  let after: CarriedReading | null = null;
  const t = boundary.getTime();
  for (const r of readings) {
    if (r.datetime <= t) {
      if (r.newReading != null || r.oldReading != null) before = r;
    } else {
      after = r;
      break;
    }
  }
  return {
    newReading: interpolateMeter(before, after, boundary, "new"),
    oldReading: interpolateMeter(before, after, boundary, "old"),
  };
}

export function readingsAtOrBefore(readings: CarriedReading[], boundary: Date) {
  let newReading: number | null = null;
  let oldReading: number | null = null;
  const t = boundary.getTime();
  for (const r of readings) {
    if (r.datetime > t) break;
    if (r.newReading != null) newReading = r.newReading;
    if (r.oldReading != null) oldReading = r.oldReading;
  }
  return { newReading, oldReading };
}

export function estimateReadingAt(
  readings: CarriedReading[],
  target: Date,
  meter: "new" | "old",
): number | null {
  let before: CarriedReading | null = null;
  let after: CarriedReading | null = null;
  const key = meter === "new" ? "newReading" : "oldReading";
  const t = target.getTime();
  for (const r of readings) {
    if (r.datetime <= t && r[key] != null) before = r;
    if (r.datetime > t && r[key] != null) {
      after = r;
      break;
    }
  }
  return interpolateMeter(before, after, target, meter);
}
