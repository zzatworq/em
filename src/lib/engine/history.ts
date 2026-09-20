import { calculateProRata } from "./bill";
import type { Collection, HistoryRow, MeterId } from "./types";

function collectionTime(c: Collection): number {
  const value = new Date(`${c.date}T${c.time || "00:00"}:00`).getTime();
  return Number.isFinite(value) ? value : 0;
}

function fallbackBilledReading(c: Collection): number {
  const standardDays = Number(c.standardDays || 30);
  const extendedDays = Number(c.extendedDays || standardDays);
  const audit = calculateProRata(c.previousBaseline, c.rawReading, extendedDays, standardDays);
  return audit?.adjustedPresent ?? c.previousBaseline;
}

/**
 * Rebuild the pro-rata chain for each physical meter.
 *
 * The first collection keeps its stored starting baseline. Every later
 * collection starts from the previous collection's billed/adjusted reading,
 * not from the previous raw meter reading.
 */
export function rebuildCollectionChain(collections: Collection[]): Collection[] {
  const result = [...collections];
  for (const meter of ["METER 1", "METER 2"] as const) {
    const rows = result
      .filter((c) => c.meter === meter)
      .sort((a, b) => collectionTime(a) - collectionTime(b));

    let billedBaseline: number | null = null;
    for (const row of rows) {
      const baseline = billedBaseline == null ? Number(row.previousBaseline) : billedBaseline;
      const standardDays = Number(row.standardDays || 30);
      const extendedDays = Number(row.extendedDays || standardDays);
      const audit = calculateProRata(baseline, Number(row.rawReading), extendedDays, standardDays);
      const index = result.findIndex((c) => c.id === row.id);
      if (index < 0) continue;

      if (audit) {
        result[index] = {
          ...row,
          previousBaseline: audit.baseline,
          extendedDays,
          standardDays,
          billedReading: audit.adjustedPresent,
        };
        billedBaseline = audit.adjustedPresent;
      } else {
        result[index] = { ...row, previousBaseline: baseline, extendedDays, standardDays, billedReading: undefined };
        billedBaseline = fallbackBilledReading(result[index]);
      }
    }
  }
  return result;
}

function monthKey(month: string): number {
  const match = month.trim().match(/^([A-Za-z]{3})\s+(\d{2}|\d{4})$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIndex = months.findIndex((m) => m.toLowerCase() === match[1].toLowerCase());
  if (monthIndex < 0) return Number.POSITIVE_INFINITY;
  const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
  return year * 12 + monthIndex;
}

/**
 * Older stored History rows were created before the Reading column existed,
 * so they can still have `reading` missing in Durable Object storage. Fill
 * those rows from the known end-of-July-2026 meter readings and the recorded
 * billed units, working backward successively. Existing readings are never
 * overwritten.
 */
function backfillHistoricalReadings(history: HistoryRow[]): HistoryRow[] {
  const anchors: Record<MeterId, { month: string; reading: number }> = {
    "METER 1": { month: "Jul 26", reading: 2435 },
    "METER 2": { month: "Jul 26", reading: 4854 },
  };

  return (["METER 1", "METER 2"] as const).flatMap((meter) => {
    const rows = history
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.meter === meter)
      .sort((a, b) => monthKey(a.row.month) - monthKey(b.row.month));
    if (!rows.length) return [];

    const anchorIndex = rows.findIndex(({ row }) => row.month === anchors[meter].month);
    if (anchorIndex < 0) return rows.map(({ row }) => row);

    const readings = new Map<number, number>();
    readings.set(rows[anchorIndex].index, anchors[meter].reading);

    let reading = anchors[meter].reading;
    for (let i = anchorIndex - 1; i >= 0; i--) {
      reading -= Number(rows[i + 1].row.units) || 0;
      readings.set(rows[i].index, reading);
    }

    return rows.map(({ row, index }) => {
      if (row.reading != null && Number.isFinite(row.reading)) return row;
      const calculated = readings.get(index);
      return calculated == null ? row : { ...row, reading: calculated };
    });
  });
}


const LEGACY_HISTORY: HistoryRow[] = [
  // Meter 1: imported utility bill history through Jun 2025.
  ...[
    ["Mar 24", "NC", 24, 1420, 0, 49],
    ["Apr 24", "NC", 49, 1420, 1539, 98],
    ["May 24", "LS", 88, 1150, 1150, 186],
    ["Jun 24", "EX", 95, 1676, 1676, 281],
    ["Jul 24", "EX", 94, 1631, 1631, 375],
    ["Aug 24", "EX", 94, 1314, 1314, 469],
    ["Sep 24", "EX", 79, 890, 890, 548],
    ["Oct 24", "EX", 69, 949, 949, 617],
    ["Nov 24", "EX", 26, 432, 432, 643],
    ["Dec 24", "EX", 18, 286, 286, 661],
    ["Jan 25", "EX", 32, 469, 489, 693],
    ["Feb 25", "EX", 33, 479, 479, 726],
    ["Mar 25", "EX", 50, 726, 726, 776],
    ["Apr 25", "EX", 74, 950, 1029, 850],
    ["May 25", "EX", 185, 1999, 1999, 1035],
    ["Jun 25", "EX", 122, 1163, 1163, 1157],
  ].map(([month, status, units, bill, payment, reading], i) => ({
    id: `legacy-m1-${i}`,
    month: String(month),
    meter: "METER 1" as const,
    status: String(status),
    units: Number(units),
    reading: Number(reading),
    bill: Number(bill),
    payment: Number(payment),
  })),
  // Meter 2: imported utility bill history through Jun 2025.
  ...[
    ["Aug 23", "", 366, 17937, 17937, 1070],
    ["Sep 23", "", 344, 16321, 16321, 1414],
    ["Oct 23", "", 314, 15281, 15281, 1728],
    ["Nov 23", "", 191, 6893, 6893, 1919],
    ["Dec 23", "", 152, 6513, 6513, 2071],
    ["Jan 24", "", 141, 5986, 5986, 2212],
    ["Feb 24", "", 151, 6359, 6359, 2363],
    ["Mar 24", "", 128, 5878, 5878, 2491],
    ["Apr 24", "", 126, 5407, 5785, 2617],
    ["May 24", "LS", 114, 1963, 1963, 2731],
    ["Jun 24", "", 98, 1866, 1866, 2829],
    ["Jul 24", "", 96, 1762, 1762, 2925],
    ["Aug 24", "EX", 129, 1786, 1786, 3054],
    ["Sep 24", "EX", 114, 1323, 1323, 3168],
    ["Oct 24", "EX", 88, 1211, 1211, 3256],
    ["Nov 24", "EX", 77, 1278, 1278, 3333],
    ["Dec 24", "EX", 32, 507, 507, 3365],
    ["Jan 25", "EX", 34, 498, 519, 3399],
    ["Feb 25", "EX", 37, 537, 537, 3436],
    ["Mar 25", "EX", 39, 566, 566, 3475],
    ["Apr 25", "EX", 74, 950, 1029, 3549],
    ["May 25", "EX", 5, 93, 93, 3554],
    ["Jun 25", "EX", 123, 1174, 1174, 3677],
  ].map(([month, status, units, bill, payment, reading], i) => ({
    id: `legacy-m2-${i}`,
    month: String(month),
    meter: "METER 2" as const,
    status: String(status),
    units: Number(units),
    reading: Number(reading),
    bill: Number(bill),
    payment: Number(payment),
  })),
];

export function collectionHistory(collections: Collection[]): HistoryRow[] {
  const chained = rebuildCollectionChain(collections);
  return chained.map((c) => {
    const standardDays = Number(c.standardDays || 30);
    const extendedDays = Number(c.extendedDays || standardDays);
    const actualUnits = c.rawReading - c.previousBaseline;
    const billedUnits = Math.max(0, Math.floor((extendedDays > 0 ? actualUnits / extendedDays : 0) * standardDays));
    return {
      id: `collection-history-${c.id}`,
      month: c.month,
      meter: c.meter,
      status: c.status || "EX",
      units: billedUnits,
      reading: c.billedReading,
      bill: Number.isFinite(c.bill) ? Number(c.bill) : 0,
      payment: Number.isFinite(c.payment) ? Number(c.payment) : 0,
    };
  });
}

/**
 * Keep manually seeded/imported history rows, but replace every row generated
 * from collection data on every synchronization.
 */
export function syncCollectionHistory(history: HistoryRow[], collections: Collection[]): HistoryRow[] {
  const generated = collectionHistory(collections);
  const generatedHistoryIds = new Set(generated.map((h) => h.id));
  const manualOrLegacy = history.filter((h) => !h.id.startsWith("collection-history-") && !generatedHistoryIds.has(h.id));
  const existingIds = new Set(manualOrLegacy.map((h) => h.id));
  const imported = LEGACY_HISTORY.filter((h) => !existingIds.has(h.id));
  return [...backfillHistoricalReadings([...manualOrLegacy, ...imported]), ...generated];
}
