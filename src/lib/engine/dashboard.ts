import type {
  CarriedReading,
  Collection,
  DailyPoint,
  GeneralSettings,
  GoalPace,
  HistoryRow,
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

type BillingClock = Pick<GeneralSettings, "billingHour" | "billingMinute">;

function goalPace(currentUsage: number, billingStart: Date, billingEnd: Date, now: Date, goal: number): GoalPace {
  const usage = Number(currentUsage || 0);
  const totalDays = (billingEnd.getTime() - billingStart.getTime()) / 86400000;
  const elapsedDays = Math.max(0, Math.min(totalDays, (now.getTime() - billingStart.getTime()) / 86400000));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const remainingUnits = goal - usage;
  const dailyAverage = elapsedDays > 0 ? usage / elapsedDays : 0;
  const targetDailyAverage = totalDays > 0 ? goal / totalDays : 0;
  let requiredDailyAverage: number | "" = "";
  if (remainingDays > 0 && remainingUnits > 0) requiredDailyAverage = remainingUnits / remainingDays;
  return { goal, elapsedDays, remainingDays, remainingUnits, dailyAverage, targetDailyAverage, requiredDailyAverage, overGoal: remainingUnits < 0 };
}

function last24(readings: CarriedReading[], now: Date) {
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startR = interpolatedReadingsAt(readings, start);
  const endR = readingsAtOrBefore(readings, now);
  const n = calculateDifference(startR.newReading, endR.newReading);
  const o = calculateDifference(startR.oldReading, endR.oldReading);
  return { newMeter: n, oldMeter: o, total: sumKnown(n, o) };
}

export function getHourlyChartData(readings: CarriedReading[], dayStart: Date, dayEnd: Date): HourlyPoint[] {
  const output: HourlyPoint[] = [];
  let cursor = new Date(dayStart);
  while (cursor < dayEnd) {
    const next = new Date(cursor);
    next.setHours(next.getHours() + 1);
    const newMeter = calculateDifference(estimateReadingAt(readings, cursor, "new"), estimateReadingAt(readings, next, "new"));
    const oldMeter = calculateDifference(estimateReadingAt(readings, cursor, "old"), estimateReadingAt(readings, next, "old"));
    output.push({ label: cursor.toLocaleTimeString("en-US", { hour: "numeric" }), start: cursor.getTime(), end: next.getTime(), newMeter, oldMeter, total: sumKnown(newMeter, oldMeter) });
    cursor = next;
  }
  return output;
}

export function getDailyChartData(readings: CarriedReading[], periodStart: Date, periodEnd: Date, calculationNow: Date, gs: GeneralSettings): DailyPoint[] {
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
        if (observed !== "") endR.newReading = Number(startR.newReading) + Number(observed) * fullWeight / elapsedWeight;
      }
      if (elapsedWeight > 0 && fullWeight > 0 && startR.oldReading != null && actual.oldReading != null) {
        const observed = calculateDifference(startR.oldReading, actual.oldReading);
        if (observed !== "") endR.oldReading = Number(startR.oldReading) + Number(observed) * fullWeight / elapsedWeight;
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

function projectMonth(daily: DailyPoint[], billingStart: Date, billingEnd: Date, now: Date, readings: CarriedReading[]) {
  const startKey = ymd(billingStart);
  const endKey = ymd(billingEnd);
  const periodDaily = daily.filter((d) => d.date >= startKey && d.date < endKey);

  // Future usage is intentionally meter-agnostic. Use the arithmetic mean of
  // the last 15 completed billing-day totals, regardless of which meter was
  // active on those days. This replaces the previous per-meter blended-rate
  // projection.
  const completed = periodDaily.filter((d) => d.completed && d.total !== "");
  const rollingDays = completed.slice(-15);
  const rolling15Total = rollingDays.reduce((sum, d) => sum + Number(d.total), 0);
  const rolling15Days = rollingDays.length;
  const rolling15Average = rolling15Days > 0 ? rolling15Total / rolling15Days : 0;

  const fullPeriodDays = (billingEnd.getTime() - billingStart.getTime()) / 86400000;
  const elapsedDays = Math.max(0, Math.min(fullPeriodDays, (now.getTime() - billingStart.getTime()) / 86400000));
  const remainingDays = Math.max(0, fullPeriodDays - elapsedDays);

  // billingNew/billingOld already represent actual current-period usage. The
  // projection therefore adds only future usage and never adds carry-forward.
  const startR = interpolatedReadingsAt(readings, billingStart);
  const currentR = readingsAtOrBefore(readings, now);
  const actualNew = calculateDifference(startR.newReading, currentR.newReading);
  const actualOld = calculateDifference(startR.oldReading, currentR.oldReading);
  const actualTotal = sumKnown(actualNew, actualOld);

  const futureTotal = rolling15Average * remainingDays;
  const projectedTotal = (actualTotal === "" ? 0 : Number(actualTotal)) + futureTotal;

  // Future units cannot be assigned to a physical meter from a combined
  // average. Allocate them in proportion to current-period actual usage only
  // for the meter-specific bill estimate; this does not affect projected total.
  const actualNewNumber = actualNew === "" ? 0 : Number(actualNew);
  const actualOldNumber = actualOld === "" ? 0 : Number(actualOld);
  const actualMeterBase = actualNewNumber + actualOldNumber;
  const newFuture = actualMeterBase > 0 ? futureTotal * actualNewNumber / actualMeterBase : futureTotal / 2;
  const oldFuture = futureTotal - newFuture;

  return {
    newMeter: actualNewNumber + newFuture,
    oldMeter: actualOldNumber + oldFuture,
    total: projectedTotal,
    actualNew: actualNewNumber,
    actualOld: actualOldNumber,
    futureNew: newFuture,
    futureOld: oldFuture,
    futureTotal,
    remainingDays,
    rolling15Total,
    rolling15Days,
    rolling15Average,
  };
}

function activeDaysForMeter(readings: CarriedReading[], billingStart: Date, periodNow: Date, meter: "new" | "old"): number {
  const start = billingStart.getTime();
  const end = periodNow.getTime();
  if (end <= start) return 0;

  const points = [
    { datetime: start, ...interpolatedReadingsAt(readings, billingStart) },
    ...readings.filter((r) => r.datetime > start && r.datetime < end),
    { datetime: end, ...interpolatedReadingsAt(readings, periodNow) },
  ].sort((a, b) => a.datetime - b.datetime);

  let activeMs = 0;
  let lastActive: "new" | "old" | null = null;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const duration = b.datetime - a.datetime;
    if (duration <= 0) continue;

    const newDelta = a.newReading == null || b.newReading == null ? 0 : Number(b.newReading) - Number(a.newReading);
    const oldDelta = a.oldReading == null || b.oldReading == null ? 0 : Number(b.oldReading) - Number(a.oldReading);
    const newActive = newDelta > 0.0001;
    const oldActive = oldDelta > 0.0001;

    if (newActive && !oldActive) {
      lastActive = "new";
      if (meter === "new") activeMs += duration;
    } else if (oldActive && !newActive) {
      lastActive = "old";
      if (meter === "old") activeMs += duration;
    } else if (newActive && oldActive) {
      const share = meter === "new" ? newDelta / (newDelta + oldDelta) : oldDelta / (newDelta + oldDelta);
      activeMs += duration * share;
      lastActive = null;
    } else if (lastActive === meter) {
      activeMs += duration;
    }
  }
  return activeMs / 86400000;
}

function collectionDateTime(c: Collection): Date | null {
  const dt = new Date(`${c.date}T${c.time || "00:00"}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function carryFromCollections(meter: MeterId, boundary: Date, collections: Collection[], readings: CarriedReading[]) {
  const label = formatBillingMonth(boundary).toLowerCase();
  const list = collections.filter((c) => c.meter === meter);
  const byLabel = list.filter((c) => c.month.trim().toLowerCase() === label);
  const prior = (byLabel.length ? byLabel : list).map((c) => ({ c, dt: collectionDateTime(c) })).filter((x) => x.dt).sort((a, b) => a.dt!.getTime() - b.dt!.getTime()).at(-1)?.c;
  if (!prior) return null;
  const std = billingPeriodLengthDays(boundary);
  const billed = calculateProRata(prior.previousBaseline, prior.rawReading, prior.extendedDays || std, std);
  if (!billed) return null;
  const at = interpolatedReadingsAt(readings, boundary);
  const boundaryReading = meter === "METER 1" ? at.newReading : at.oldReading;
  let carryForward = billed.carryForward;
  if (boundaryReading != null && isFinite(Number(boundaryReading))) carryForward = Number(boundaryReading) - billed.adjustedPresent;
  return { ...billed, carryForward, boundaryReading };
}

export function availableMonths(readings: { datetime: number }[], now: Date, gs: GeneralSettings) {
  const map = new Map<string, Date>();
  const current = getBillingPeriodStart(now, gs);
  map.set(ymd(current), current);
  for (const r of readings) map.set(ymd(getBillingPeriodStart(new Date(r.datetime), gs)), getBillingPeriodStart(new Date(r.datetime), gs));
  return [...map.values()].sort((a, b) => b.getTime() - a.getTime()).map((start) => {
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
  history?: HistoryRow[];
}) {
  const { inputs, now, gs, tariff1, tariff2, collections, history = [] } = opts;
  const readings = applyCarryForward([...inputs].sort((a, b) => a.datetime - b.datetime));
  if (!readings.length) return { empty: true as const, message: "No meter readings yet. Add one on the Readings tab." };

  const currentStart = getBillingPeriodStart(now, gs);
  const billingStart = opts.selectedStart ?? currentStart;
  const billingEnd = addMonth(billingStart);
  const isCurrent = billingStart.getTime() === currentStart.getTime();
  const periodNow = isCurrent ? now : billingEnd;
  const startR = interpolatedReadingsAt(readings, billingStart);
  const endR = isCurrent && now < billingEnd ? readingsAtOrBefore(readings, now) : interpolatedReadingsAt(readings, billingEnd);
  const billingNew = calculateDifference(startR.newReading, endR.newReading);
  const billingOld = calculateDifference(startR.oldReading, endR.oldReading);
  const billingTotal = sumKnown(billingNew, billingOld);
  const fullPeriodDays = (billingEnd.getTime() - billingStart.getTime()) / 86400000;
  const elapsedDays = isCurrent ? Math.max(0, Math.min(fullPeriodDays, (periodNow.getTime() - billingStart.getTime()) / 86400000)) : fullPeriodDays;
  const daily = getDailyChartData(readings, billingStart, billingEnd, isCurrent ? now : billingEnd, gs);
  const projection = isCurrent ? projectMonth(daily, billingStart, billingEnd, now, readings) : {
    newMeter: billingNew === "" ? 0 : Number(billingNew),
    oldMeter: billingOld === "" ? 0 : Number(billingOld),
    total: billingTotal === "" ? 0 : Number(billingTotal),
    actualNew: billingNew === "" ? 0 : Number(billingNew),
    actualOld: billingOld === "" ? 0 : Number(billingOld),
    futureNew: 0,
    futureOld: 0,
    futureTotal: 0,
    remainingDays: 0,
    rolling15Total: 0,
    rolling15Days: 0,
    rolling15Average: 0,
  };

  const periodReadings = readings.filter((r) => r.datetime >= billingStart.getTime() && r.datetime < billingEnd.getTime());
  const latest = (periodReadings.length ? periodReadings : readings).at(-1) ?? null;
  const last24h = last24(readings, now);
  const carry1 = carryFromCollections("METER 1", billingStart, collections, readings);
  const carry2 = carryFromCollections("METER 2", billingStart, collections, readings);
  const carryForwardNew = carry1?.carryForward ?? 0;
  const carryForwardOld = carry2?.carryForward ?? 0;
  const totalConsumptionNew = (billingNew === "" ? 0 : Number(billingNew)) + carryForwardNew;
  const totalConsumptionOld = (billingOld === "" ? 0 : Number(billingOld)) + carryForwardOld;
  const totalConsumptionCombined = totalConsumptionNew + totalConsumptionOld;
  const recentUnitsFor = (meter: MeterId) => history
    .filter((row) => row.meter === meter)
    .map((row) => Number(row.units))
    .filter(Number.isFinite)
    .slice(-6);
  const billContext1 = { recentMonthlyUnits: recentUnitsFor("METER 1") };
  const billContext2 = { recentMonthlyUnits: recentUnitsFor("METER 2") };
  const currentBill1 = calculateMeterBill(totalConsumptionNew, tariff1, billContext1);
  const currentBill2 = calculateMeterBill(totalConsumptionOld, tariff2, billContext2);
  const projectedConsumptionNew = projection.newMeter;
  const projectedConsumptionOld = projection.oldMeter;
  const projectedConsumptionCombined = projection.total;
  const actualNewSoFar = billingNew === "" ? 0 : Number(billingNew);
  const actualOldSoFar = billingOld === "" ? 0 : Number(billingOld);
  const remainingTotal = isCurrent ? Math.max(0, projection.total - (actualNewSoFar + actualOldSoFar)) : 0;
  const halfRemaining = remainingTotal / 2;
  const split1 = calculateMeterBill(actualNewSoFar + halfRemaining, tariff1, billContext1);
  const split2 = calculateMeterBill(actualOldSoFar + halfRemaining, tariff2, billContext2);
  const projectedActual1 = calculateMeterBill(projectedConsumptionNew, tariff1, billContext1);
  const projectedActual2 = calculateMeterBill(projectedConsumptionOld, tariff2, billContext2);
  const periodStd = billingPeriodLengthDays(billingStart);
  const pro1 = calculateProRata(startR.newReading, latest?.newReading ?? null, elapsedDays, periodStd);
  const pro2 = calculateProRata(startR.oldReading, latest?.oldReading ?? null, elapsedDays, periodStd);
  const hourlyStart = isCurrent ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : getFivePmDayStart(billingEnd, gs);
  const hourlyEnd = isCurrent ? now : billingEnd;
  const hourly = getHourlyChartData(readings, hourlyStart, hourlyEnd);
  const hourlyDays = daily.filter((d) => d.total !== "").map((d) => ({ value: d.date, label: new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }));
  if (isCurrent) hourlyDays.unshift({ value: "last24", label: "Last 24 hours" });
  const shareBase = billingNew !== "" || billingOld !== "" ? (Number(billingNew || 0) + Number(billingOld || 0)) : 0;
  const activeDaysNew = activeDaysForMeter(readings, billingStart, periodNow, "new");
  const activeDaysOld = activeDaysForMeter(readings, billingStart, periodNow, "old");

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
    averageNew: billingNew !== "" && activeDaysNew > 0 ? Number(billingNew) / activeDaysNew : "",
    averageOld: billingOld !== "" && activeDaysOld > 0 ? Number(billingOld) / activeDaysOld : "",
    activeDaysNew,
    activeDaysOld,
    last24Total: last24h.total,
    last24New: last24h.newMeter,
    last24Old: last24h.oldMeter,
    projectedNew: projectedConsumptionNew,
    projectedOld: projectedConsumptionOld,
    projectedTotal: projectedConsumptionCombined,
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
    projectedBillActualDetails: { meter1: projectedActual1, meter2: projectedActual2 },
    projectedBill5050Total: split1.total + split2.total,
    projectedBillActualTotal: projectedActual1.total + projectedActual2.total,
    proRata: { meter1: pro1, meter2: pro2, standardDays: periodStd },
    billingStart: formatDateTime(billingStart),
    billingEnd: formatDateTime(billingEnd),
    billingProgress: isCurrent ? Math.max(0, Math.min(100, ((now.getTime() - billingStart.getTime()) / (billingEnd.getTime() - billingStart.getTime())) * 100)) : 100,
    billingMonth: formatBillingMonth(billingEnd),
    goalPace: goalPace(billingTotal === "" ? 0 : Number(billingTotal), billingStart, billingEnd, isCurrent ? now : billingEnd, gs.goalCombinedUnits),
    daily,
    hourly,
    hourlyDay: isCurrent ? "last24" : hourlyDays.at(-1)?.value ?? "",
    hourlyDays,
    isCurrentBillingMonth: isCurrent,
    availableMonthKey: ymd(billingStart),
    effectiveCurrentRate: (isCurrent ? projectedConsumptionCombined : billingTotal === "" ? 0 : Number(billingTotal)) > 0
      ? (isCurrent ? projectedActual1.total + projectedActual2.total : currentBill1.total + currentBill2.total) / (isCurrent ? projectedConsumptionCombined : Number(billingTotal))
      : 0,
    carried: readings,
    billingStartDate: billingStart,
    billingEndDate: billingEnd,
    projection,
    billing: { newMeter: billingNew, oldMeter: billingOld, total: billingTotal },
    last24: last24h,
    goal: goalPace(billingTotal === "" ? 0 : Number(billingTotal), billingStart, billingEnd, isCurrent ? now : billingEnd, gs.goalCombinedUnits),
    bill1: currentBill1,
    bill2: currentBill2,
    carry1,
    carry2,
    readings,
    generatedAt: formatDateTime(now),
  };
}

export function hourlyForDay(inputs: ReadingInput[], dayKey: string, now: Date, gs: GeneralSettings) {
  const readings = applyCarryForward([...inputs].sort((a, b) => a.datetime - b.datetime));
  if (dayKey === "last24") return getHourlyChartData(readings, new Date(now.getTime() - 24 * 3600000), now);
  const dayStart = new Date(`${dayKey}T${String(gs.billingHour).padStart(2, "0")}:${String(gs.billingMinute).padStart(2, "0")}:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  let end = dayEnd;
  if (now >= dayStart && now < dayEnd) end = now;
  return getHourlyChartData(readings, dayStart, end);
}