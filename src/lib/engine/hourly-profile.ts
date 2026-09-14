import type { CarriedReading, GeneralSettings, HourlyProfilePoint, ReadingInput } from "./types";
import { calculateDifference, estimateReadingAt, applyCarryForward } from "./readings";
import { getFivePmDayStart } from "./time";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds a historical 24-hour consumption profile from every completed
 * billing-day in the dataset. Each day's normalized hourly shape is weighted
 * by the number of real readings recorded during that day.
 */
export function getHourlyDistributionProfile(
  inputs: ReadingInput[],
  gs: GeneralSettings,
  now: Date,
): HourlyProfilePoint[] {
  const readings = applyCarryForward([...inputs].sort((a, b) => a.datetime - b.datetime));
  if (!readings.length) return [];

  const clock = { billingHour: gs.billingHour, billingMinute: gs.billingMinute };
  const dayKeys = new Set<number>();
  for (const input of inputs) {
    const dayStart = getFivePmDayStart(new Date(input.datetime), clock);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    if (dayEnd.getTime() <= now.getTime()) dayKeys.add(dayStart.getTime());
  }

  const weighted = Array.from({ length: 24 }, () => 0);
  let totalWeight = 0;

  for (const key of [...dayKeys].sort((a, b) => a - b)) {
    const dayStart = new Date(key);
    const dayEnd = new Date(key + DAY_MS);
    const dayReadings = inputs.filter((r) => r.datetime >= key && r.datetime < key + DAY_MS);
    if (!dayReadings.length) continue;

    const hourly: number[] = [];
    let total = 0;
    let cursor = new Date(dayStart);
    for (let hour = 0; hour < 24; hour++) {
      const next = new Date(cursor);
      next.setHours(next.getHours() + 1);
      const newDelta = calculateDifference(
        estimateReadingAt(readings, cursor, "new"),
        estimateReadingAt(readings, next, "new"),
      );
      const oldDelta = calculateDifference(
        estimateReadingAt(readings, cursor, "old"),
        estimateReadingAt(readings, next, "old"),
      );
      const value = Math.max(0, Number(newDelta === "" ? 0 : newDelta) + Number(oldDelta === "" ? 0 : oldDelta));
      hourly.push(value);
      total += value;
      cursor = next;
    }

    if (!(total > 0)) continue;
    const weight = dayReadings.length;
    for (let hour = 0; hour < 24; hour++) weighted[hour] += (hourly[hour] / total) * weight;
    totalWeight += weight;
  }

  if (!(totalWeight > 0)) return [];
  const fractions = weighted.map((value) => value / totalWeight);
  const fractionSum = fractions.reduce((a, b) => a + b, 0);
  return fractions.map((fraction, hour) => ({
    hour,
    fraction: fractionSum > 0 ? fraction / fractionSum : 0,
    percent: fractionSum > 0 ? (fraction / fractionSum) * 100 : 0,
  }));
}
