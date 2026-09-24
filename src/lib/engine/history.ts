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

    const output = rows.map(({ row }) => row);
    // Work backwards from each known reading, stopping at the next known
    // reading. This preserves real historical anchors and prevents a later
    // meter reading from being propagated across a meter reset/gap.
    for (let anchorIndex = rows.length - 1; anchorIndex >= 0; anchorIndex--) {
      const anchor = output[anchorIndex];
      if (anchor.reading == null || !Number.isFinite(anchor.reading) || anchor.reading < 0) continue;

      let reading = anchor.reading;
      for (let i = anchorIndex - 1; i >= 0; i--) {
        if (output[i].reading != null && Number.isFinite(output[i].reading)) break;
        reading -= Number(output[i + 1].units) || 0;
        if (reading < 0) break;
        output[i] = { ...output[i], reading };
      }
    }

    return output;
  });
}

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
  return [...backfillHistoricalReadings(manualOrLegacy), ...generated];
}
