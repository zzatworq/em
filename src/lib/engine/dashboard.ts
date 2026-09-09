import type {
  CarriedReading,
  Collection,
  DailyPoint,
  GeneralSettings,
  GoalPace,
  HourlyPoint,
  MeterId,
  ReadingInput,
  Tariff,
} from "./types";
import { calculateMeterBill, calculateProRata } from "./bill";
import {
  applyCarryForward,
  calculateDifference,
  estimateReadingAt,
  interpolatedReadingsAt,
  readingsAtOrBefore,
  sumKnown,
} from "./readings";
import {
  addMonth,
  billingPeriodLengthDays,
  formatBillingMonth,
  formatDateTime,
  getBillingPeriodStart,
  getFivePmDayStart,
  profileWeightBetween,
  ymd,
} from "./time";

const PRIOR_SHRINKAGE_DAYS = 3;

function goalPace(
  currentUsage: number,
  billingStart: Date,
  billingEnd: Date,
  now: Date,
  goal: number,
): GoalPace {
  const usage = Number(currentUsage || 0);
  const totalDays = (billingEnd.getTime() - billingStart.getTime()) / 86400000;
  const elapsedDays = Math.max(
    0,
    Math.min(totalDays, (now.getTime() - billingStart.getTime()) / 86400000),
  );
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const remainingUnits = goal - usage;
  const dailyAverage = elapsedDays > 0 ? usage / elapsedDays : 0;
  const targetDailyAverage = totalDays > 0 ? goal / totalDays : 0;
  let requiredDailyAverage: number | "" = "";
  if (remainingDays > 0 && remainingUnits > 0) {
    requiredDailyAverage = remainingUnits / remainingDays;
  }
  return {
    goal,
    elapsedDays,
    remainingDays,
    remainingUnits,
    dailyAverage,
    targetDailyAverage,
    requiredDailyAverage,
    overGoal: remainingUnits < 0,
  };
}

function last24(readings: CarriedReading[], now: Date) {
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startR = interpolatedReadingsAt(readings, start);
  const endR = readingsAtOrBefore(readings, now);
  const n = calculateDifference(startR.newReading, endR.newReading);
  const o = calculateDifference(startR.oldReading, endR.oldReading);
  return { newMeter: n, oldMeter: o, total: sumKnown(n, o) };
}

export function getHourlyChartData(
  readings: CarriedReading[],
  dayStart: Date,
  dayEnd: Date,
): HourlyPoint[] {
  const output: HourlyPoint[] = [];
  let cursor = new Date(dayStart);
  while (cursor < dayEnd) {
    const next = new Date(cursor);
    next.setHours(next.getHours() + 1);
    const newMeter = calculateDifference(
      estimateReadingAt(readings, cursor, "new"),
      estimateReadingAt(readings, next, "new"),
    );
    const oldMeter = calculateDifference(
      estimateReadingAt(readings, cursor, "old"),
      estimateReadingAt(readings, next, "old"),
    );
    output.push({
      label: cursor.toLocaleTimeString("en-US", { hour: "numeric" }),
      start: cursor.getTime(),
      end: next.getTime(),
      newMeter,
      oldMeter,
      total: sumKnown(newMeter, oldMeter),
    });
    cursor = next;
  }
  return output;
}

export function getDailyChartData(
  readings: CarriedReading[],
  periodStart: Date,
  periodEnd: Date,
  calculationNow: Date,
  gs: GeneralSettings,
): DailyPoint[] {
  if (!readings.length) return [];
  const output: DailyPoint[] = [];
  const day = new Date(periodStart);
  while (day < periodEnd) {
    const start = new Date(day);
    const end = new Date(day);
    end.setDate(end.getDate() + 1);
    const startR = interpolatedReadingsAt(readings, start);
    const completed = calculationNow >= end;
    let endR = { newReading: null as number | null, oldReading: null as number | null };
    if (completed) {
      endR = interpolatedReadingsAt(readings, end);
    } else {
      const actual = readingsAtOrBefore(readings, calculationNow);
      const elapsedWeight = profileWeightBetween(start, calculationNow);
      const fullWeight = profileWeightBetween(start, end);
      if (elapsedWeight > 0 && fullWeight > 0 && startR.newReading != null && actual.newReading != null) {
        const observed = calculateDifference(startR.newReading, actual.newReading);
        if (observed !== "") {
          endR.newReading = Number(startR.newReading) + Number(observed) * fullWeight / elapsedWeight;
        }
      }
      if (elapsedWeight > 0 && fullWeight > 0 && startR.oldReading != null && actual.oldReading != null) {
        const observed = calculateDifference(startR.oldReading, actual.oldReading);
        if (observed !== "") {
          endR.oldReading = Number(startR.oldReading) + Number(observed) * fullWeight / elapsedWeight;
        }
      }
    }
    const newMeter = calculateDifference(startR.newReading, endR.newReading);
    const oldMeter = calculateDifference(startR.oldReading, endR.oldReading);
    if (endR.newReading != null || endR.oldReading != null) {
      output.push({
        label: start.toLocaleDateString("en-GB", { day: "2-digit" }),
        date: ymd(start),
        period: `${start.toLocaleString("en-GB", { day: "2-digit", month: "short" })} ${gs.billingHour}:00 → ${end.toLocaleString("en-GB", { day: "2-digit", month: "short" })} ${gs.billingHour}:00`,
        newMeter,
        oldMeter,
        total: sumKnown(newMeter, oldMeter),
        completed,
      });
    }
    day.setDate(day.getDate() + 1);
  }
  return output;
}

function blendedDailyRate(observedTotal: number, observedDays: number, priorPerDay: number | null) {
  if (priorPerDay == null) return observedDays > 0 ? observedTotal / observedDays : 0;
  return (observedTotal + priorPerDay * PRIOR_SHRINKAGE_DAYS) / (observedDays + PRIOR_SHRINKAGE_DAYS);
}

function priorPeriodDailyAverages(readings: CarriedReading[], billingStart: Date) {
  if (!readings.length || readings[0].datetime >= billingStart.getTime()) return null;
  const priorStart = new Date(
    billingStart.getFullYear(),
    billingStart.getMonth() - 1,
    billingStart.getDate(),
    billingStart.getHours(),
    billingStart.getMinutes(),
    0,
    0,
  );
  const days = (billingStart.getTime() - priorStart.getTime()) / 86400000;
  if (days <= 0) return null;
  const startR = interpolatedReadingsAt(readings, priorStart);
  const endR = interpolatedReadingsAt(readings, billingStart);
  const newTotal = calculateDifference(startR.newReading, endR.newReading);
  const oldTotal = calculateDifference(startR.oldReading, endR.oldReading);
  return {
    newPerDay: newTotal === "" ? null : newTotal / days,
    oldPerDay: oldTotal === "" ? null : oldTotal / days,
  };
}

function projectMonth(
  daily: DailyPoint[],
  billingStart: Date,
  billingEnd: Date,
  now: Date,
  readings: CarriedReading[],
) {
  const startKey = ymd(billingStart);
  const endKey = ymd(billingEnd);
  const periodDaily = daily.filter((d) => d.date >= startKey && d.date < endKey);
  let completedNew = 0;
  let completedOld = 0;
  let completedDays = 0;
  let currentDay: DailyPoint | null = null;
  for (const d of periodDaily) {
    if (d.completed) {
      if (d.newMeter !== "") completedNew += Number(d.newMeter);
      if (d.oldMeter !== "") completedOld += Number(d.oldMeter);
      completedDays++;
    } else currentDay = d;
  }
  const fullPeriodDays = (billingEnd.getTime() - billingStart.getTime()) / 86400000;
  let partialFullNew = 0;
  let partialFullOld = 0;
  if (currentDay) {
    const gsDummy = {
      billingHour: billingStart.getHours(),
      billingMinute: billingStart.getMinutes(),
    };
    const dayStart = getFivePmDayStart(now, {
      goalCombinedUnits: 0,
      billingDay: 13,
      billingHour: gsDummy.billingHour,
      billingMinute: gsDummy.billingMinute,
      solarStartHour: 7,
      solarStartMinute: 30,
      solarEndHour: 17,
      solarEndMinute: 30,
    });
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const elapsedWeight = profileWeightBetween(dayStart, now);
    const fullWeight = profileWeightBetween(dayStart, dayEnd);
    const fraction = fullWeight > 0 ? elapsedWeight / fullWeight : 0;
    const partialNew = currentDay.newMeter === "" ? 0 : Number(currentDay.newMeter);
    const partialOld = currentDay.oldMeter === "" ? 0 : Number(currentDay.oldMeter);
    const completedDailyNew = periodDaily
      .filter((d) => d.completed && d.newMeter !== "")
      .map((d) => Number(d.newMeter));
    const fallbackNew = completedDailyNew.length
      ? completedDailyNew.reduce((a, b) => a + b, 0) / completedDailyNew.length
      : 0;
    const completedDailyOld = periodDaily
      .filter((d) => d.completed && d.oldMeter !== "")
      .map((d) => Number(d.oldMeter));
    const fallbackOld = completedDailyOld.length
      ? completedDailyOld.reduce((a, b) => a + b, 0) / completedDailyOld.length
      : 0;
    if (fraction >= 0.1 && elapsedWeight > 0 && fullWeight > 0) {
      partialFullNew = (partialNew * fullWeight) / elapsedWeight;
      partialFullOld = (partialOld * fullWeight) / elapsedWeight;
    } else {
      partialFullNew = Math.max(partialNew, fallbackNew);
      partialFullOld = Math.max(partialOld, fallbackOld);
    }
  }
  const futureDays = Math.max(0, fullPeriodDays - completedDays - (currentDay ? 1 : 0));
  const prior = priorPeriodDailyAverages(readings, billingStart);
  const observedDaysCount = completedDays + (currentDay ? 1 : 0);
  const futureNew = blendedDailyRate(
    completedNew + partialFullNew,
    observedDaysCount,
    prior?.newPerDay ?? null,
  );
  const futureOld = blendedDailyRate(
    completedOld + partialFullOld,
    observedDaysCount,
    prior?.oldPerDay ?? null,
  );
  const projectedNew = completedNew + partialFullNew + futureNew * futureDays;
  const projectedOld = completedOld + partialFullOld + futureOld * futureDays;
  return { newMeter: projectedNew, oldMeter: projectedOld, total: projectedNew + projectedOld };
}

function collectionDateTime(c: Collection): Date | null {
  const dt = new Date(`${c.date}T${c.time || "00:00"}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function carryFromCollections(
  meter: MeterId,
  boundary: Date,
  collections: Collection[],
  readings: CarriedReading[],
) {
  const label = formatBillingMonth(boundary).toLowerCase();
  const list = collections.filter((c) => c.meter === meter);
  const byLabel = list.filter((c) => c.month.trim().toLowerCase() === label);
  const prior = (byLabel.length ? byLabel : list)
    .map((c) => ({ c, dt: collectionDateTime(c) }))
    .filter((x) => x.dt)
    .sort((a, b) => a.dt!.getTime() - b.dt!.getTime())
    .at(-1)?.c;
  if (!prior) return null;
  const std = billingPeriodLengthDays(boundary);
  const billed = calculateProRata(prior.previousBaseline, prior.rawReading, prior.extendedDays || std, std);
  if (!billed) return null;
  const at = interpolatedReadingsAt(readings, boundary);
  const boundaryReading = meter === "METER 1" ? at.newReading : at.oldReading;
  let carryForward = billed.carryForward;
  if (boundaryReading != null && isFinite(Number(boundaryReading))) {
    carryForward = Number(boundaryReading) - billed.adjustedPresent;
  }
  return { ...billed, carryForward, boundaryReading };
}

export function availableMonths(readings: { datetime: number }[], now: Date, gs: GeneralSettings) {
  const map = new Map<string, Date>();
  const current = getBillingPeriodStart(now, gs);
  map.set(ymd(current), current);
  for (const r of readings) {
    const start = getBillingPeriodStart(new Date(r.datetime), gs);
    map.set(ymd(start), start);
  }
  return [...map.values()]
    .sort((a, b) => b.getTime() - a.getTime())
    .map((start) => {
      const end = addMonth(start);
      return { key: ymd(start), value: String(start.getTime()), label: formatBillingMonth(end) };
    });
}

export function computeDashboard(opts: {
  inputs: ReadingInput[];
  now: Date;
  selectedStart?: Date | null;
  gs: GeneralSettings;
  tariff1: Tariff;
  tariff2: Tariff;
  collections: Collection[];
}) {
  const { inputs, now, gs, tariff1, tariff2, collections } = opts;
  const readings = applyCarryForward([...inputs].sort((a, b) => a.datetime - b.datetime));
  if (!readings.length) {
    return { empty: true as const, message: "No meter readings yet. Add one on the Readings tab." };
  }

  const currentStart = getBillingPeriodStart(now, gs);
  const billingStart = opts.selectedStart ?? currentStart;
  const billingEnd = addMonth(billingStart);
  const isCurrent = billingStart.getTime() === currentStart.getTime();
  const periodNow = isCurrent ? now : billingEnd;

  const startR = interpolatedReadingsAt(readings, billingStart);
  const endR =
    isCurrent && now < billingEnd
      ? readingsAtOrBefore(readings, now)
      : interpolatedReadingsAt(readings, billingEnd);

  const billingNew = calculateDifference(startR.newReading, endR.newReading);
  const billingOld = calculateDifference(startR.oldReading, endR.oldReading);
  const billingTotal = sumKnown(billingNew, billingOld);

  const fullPeriodDays = (billingEnd.getTime() - billingStart.getTime()) / 86400000;
  const elapsedDays = isCurrent
    ? Math.max(0, Math.min(fullPeriodDays, (periodNow.getTime() - billingStart.getTime()) / 86400000))
    : fullPeriodDays;

  const daily = getDailyChartData(readings, billingStart, billingEnd, isCurrent ? now : billingEnd, gs);
  const projection = isCurrent
    ? projectMonth(daily, billingStart, billingEnd, now, readings)
    : {
        newMeter: billingNew === "" ? 0 : Number(billingNew),
        oldMeter: billingOld === "" ? 0 : Number(billingOld),
        total: (billingNew === "" ? 0 : Number(billingNew)) + (billingOld === "" ? 0 : Number(billingOld)),
      };

  const periodReadings = readings.filter(
    (r) => r.datetime >= billingStart.getTime() && r.datetime < billingEnd.getTime(),
  );
  const latest = (periodReadings.length ? periodReadings : readings).at(-1) ?? null;
  const last24h = last24(readings, now);

  const carry1 = carryFromCollections("METER 1", billingStart, collections, readings);
  const carry2 = carryFromCollections("METER 2", billingStart, collections, readings);
  const carryForwardNew = carry1?.carryForward ?? 0;
  const carryForwardOld = carry2?.carryForward ?? 0;
  const totalConsumptionNew = (billingNew === "" ? 0 : billingNew) + carryForwardNew;
  const totalConsumptionOld = (billingOld === "" ? 0 : billingOld) + carryForwardOld;
  const totalConsumptionCombined = totalConsumptionNew + totalConsumptionOld;

  const currentBill1 = calculateMeterBill(billingNew === "" ? 0 : billingNew, tariff1);
  const currentBill2 = calculateMeterBill(billingOld === "" ? 0 : billingOld, tariff2);
  const projectedBill1 = calculateMeterBill(projection.newMeter, tariff1);
  const projectedBill2 = calculateMeterBill(projection.oldMeter, tariff2);
  const assumedUnits = isCurrent ? projection.total : Number(billingTotal || 0);
  const half = assumedUnits / 2;
  const split1 = calculateMeterBill(half, tariff1);
  const split2 = calculateMeterBill(half, tariff2);

  const periodStd = billingPeriodLengthDays(billingStart);
  const pro1 = calculateProRata(startR.newReading, latest?.newReading ?? null, elapsedDays, periodStd);
  const pro2 = calculateProRata(startR.oldReading, latest?.oldReading ?? null, elapsedDays, periodStd);

  const hourlyStart = isCurrent
    ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
    : getFivePmDayStart(billingEnd, gs);
  const hourlyEnd = isCurrent ? now : billingEnd;
  const hourly = getHourlyChartData(readings, hourlyStart, hourlyEnd);

  const hourlyDays = daily
    .filter((d) => d.total !== "")
    .map((d) => ({
      value: d.date,
      label: new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    }));
  if (isCurrent) hourlyDays.unshift({ value: "last24", label: "Last 24 hours" });

  const shareBase = billingTotal === "" || billingTotal <= 0 ? 0 : billingTotal;

  return {
    empty: false as const,
    latestDate: latest ? formatDateTime(new Date(latest.datetime)) : formatBillingMonth(billingStart),
    latestTimestamp: latest?.datetime ?? billingStart.getTime(),
    currentNew: latest?.newReading ?? null,
    currentOld: latest?.oldReading ?? null,
    initialNew: startR.newReading,
    initialOld: startR.oldReading,
    billingNew,
    billingOld,
    billingTotal,
    elapsedDays,
    averageNew: billingNew !== "" && elapsedDays > 0 ? billingNew / elapsedDays : "",
    averageOld: billingOld !== "" && elapsedDays > 0 ? billingOld / elapsedDays : "",
    last24Total: last24h.total,
    last24New: last24h.newMeter,
    last24Old: last24h.oldMeter,
    projectedNew: projection.newMeter,
    projectedOld: projection.oldMeter,
    projectedTotal: projection.total,
    meter1Share: shareBase ? (Number(billingNew || 0) / shareBase) * 100 : 0,
    meter2Share: shareBase ? (Number(billingOld || 0) / shareBase) * 100 : 0,
    carryForwardNew,
    carryForwardOld,
    totalConsumptionNew,
    totalConsumptionOld,
    totalConsumptionCombined,
    currentBillNew: currentBill1.total,
    currentBillOld: currentBill2.total,
    currentBillDetails: { meter1: currentBill1, meter2: currentBill2 },
    projectedBillDetails: { meter1: split1, meter2: split2 },
    projectedBillActualDetails: { meter1: projectedBill1, meter2: projectedBill2 },
    projectedBill5050Total: split1.total + split2.total,
    projectedBillActualTotal: projectedBill1.total + projectedBill2.total,
    proRata: { meter1: pro1, meter2: pro2, standardDays: periodStd },
    billingMonth: formatBillingMonth(billingEnd),
    billingStart: formatDateTime(billingStart),
    billingEnd: formatDateTime(billingEnd),
    billingProgress: isCurrent
      ? Math.max(0, Math.min(100, ((now.getTime() - billingStart.getTime()) / (billingEnd.getTime() - billingStart.getTime())) * 100))
      : 100,
    goalPace: goalPace(totalConsumptionCombined, billingStart, billingEnd, isCurrent ? now : billingEnd, gs.goalCombinedUnits),
    daily,
    hourly,
    hourlyDay: isCurrent ? "last24" : hourlyDays.at(-1)?.value ?? "",
    hourlyDays,
    isCurrentBillingMonth: isCurrent,
    availableMonthKey: ymd(billingStart),
    effectiveCurrentRate:
      (isCurrent ? projection.total : Number(billingTotal || 0)) > 0
        ? (isCurrent ? split1.total + split2.total : currentBill1.total + currentBill2.total) /
          (isCurrent ? projection.total : Number(billingTotal || 0))
        : 0,
    carried: readings,
  };
}

export function hourlyForDay(inputs: ReadingInput[], dayKey: string, now: Date, gs: GeneralSettings) {
  const readings = applyCarryForward([...inputs].sort((a, b) => a.datetime - b.datetime));
  if (dayKey === "last24") {
    return getHourlyChartData(readings, new Date(now.getTime() - 24 * 3600000), now);
  }
  const dayStart = new Date(`${dayKey}T${String(gs.billingHour).padStart(2, "0")}:${String(gs.billingMinute).padStart(2, "0")}:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  let end = dayEnd;
  if (now >= dayStart && now < dayEnd) end = now;
  return getHourlyChartData(readings, dayStart, end);
}
