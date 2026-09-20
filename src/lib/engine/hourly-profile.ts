import type { GeneralSettings, HourlyProfilePoint, ReadingInput } from "./types";
import { applyCarryForward } from "./readings";
import { getFivePmDayStart } from "./time";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds a self-learning 24-hour household consumption profile from actual
 * meter-reading intervals. No predefined usage curve is used.
 *
 * A measured interval is distributed uniformly across elapsed time because
 * the exact intra-interval consumption is unknown. Each completed 5pm-to-5pm
 * day contributes equally, so days with more readings do not dominate.
 */
export function getHourlyDistributionProfile(
  inputs: ReadingInput[],
  gs: GeneralSettings,
  now: Date,
): HourlyProfilePoint[] {
  const source = [...inputs].sort((a, b) => a.datetime - b.datetime);
  const readings = applyCarryForward(source);
  if (readings.length < 2) return [];

  const dayBuckets = new Map<number, number[]>();

  for (let i = 1; i < readings.length; i++) {
    const start = readings[i - 1];
    const end = readings[i];
    if (end.datetime <= start.datetime) continue;

    const newDelta = start.newReading != null && end.newReading != null
      ? Math.max(0, end.newReading - start.newReading) : 0;
    const oldDelta = start.oldReading != null && end.oldReading != null
      ? Math.max(0, end.oldReading - start.oldReading) : 0;
    const consumption = newDelta + oldDelta;
    if (!(consumption > 0)) continue;

    const intervalMs = end.datetime - start.datetime;
    let cursor = new Date(start.datetime);

    while (cursor.getTime() < end.datetime) {
      const dayStart = getFivePmDayStart(cursor, {
        billingHour: gs.billingHour,
        billingMinute: gs.billingMinute,
      });
      const dayEndMs = dayStart.getTime() + DAY_MS;
      const segmentEndMs = Math.min(end.datetime, dayEndMs);

      if (dayEndMs <= now.getTime()) {
        const bucket = dayBuckets.get(dayStart.getTime())
          ?? Array.from({ length: 24 }, () => 0);

        let hourCursor = cursor.getTime();
        while (hourCursor < segmentEndMs) {
          const hourStart = new Date(hourCursor);
          hourStart.setMinutes(0, 0, 0);
          const hourEndMs = Math.min(
            segmentEndMs,
            hourStart.getTime() + 60 * 60 * 1000,
          );
          const minutes = hourEndMs - hourCursor;
          const hourIndex = Math.floor(
            (hourStart.getTime() - dayStart.getTime()) / (60 * 60 * 1000),
          );
          if (hourIndex >= 0 && hourIndex < 24) {
            bucket[hourIndex] += consumption * (minutes / intervalMs);
          }
          hourCursor = hourEndMs;
        }

        dayBuckets.set(dayStart.getTime(), bucket);
      }

      cursor = new Date(segmentEndMs);
    }
  }

  const days = [...dayBuckets.values()].filter((day) => day.some((v) => v > 0));
  if (!days.length) return [];

  const profile = Array.from({ length: 24 }, () => 0);
  for (const day of days) {
    const total = day.reduce((sum, value) => sum + value, 0);
    if (total <= 0) continue;
    for (let hour = 0; hour < 24; hour++) profile[hour] += day[hour] / total;
  }

  const sum = profile.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return [];

  const firstDay = new Date(
    [...dayBuckets.keys()].sort((a, b) => a - b)[0],
  );

  return profile.map((value, hour) => {
    const label = new Date(firstDay.getTime() + hour * 60 * 60 * 1000);
    return {
      hour: label.getHours(),
      minute: label.getMinutes(),
      fraction: value / sum,
      percent: (value / sum) * 100,
    };
  });
}
