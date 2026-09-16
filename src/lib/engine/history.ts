import { calculateProRata } from "./bill";
import type { Collection, HistoryRow } from "./types";

function collectionTime(c: Collection): number {
  const value = new Date(`${c.date}T${c.time || "00:00"}:00`).getTime();
  return Number.isFinite(value) ? value : 0;
}

function fallbackBilledReading(c: Collection): number {
  const standardDays = Math.round(c.standardDays || 30);
  const extendedDays = Math.round(c.extendedDays || standardDays);
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
      const standardDays = Math.round(row.standardDays || 30);
      const extendedDays = Math.round(row.extendedDays || standardDays);
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

export function collectionHistory(collections: Collection[]): HistoryRow[] {
  const chained = rebuildCollectionChain(collections);
  return chained.map((c) => {
    const standardDays = Math.round(c.standardDays || 30);
    const extendedDays = Math.round(c.extendedDays || standardDays);
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
 * from collection data on every synchronization. This is deliberately based
 * on the generated ID prefix rather than month/meter, because a collection
 * can be edited to a different date/month or deleted entirely.
 */
export function syncCollectionHistory(history: HistoryRow[], collections: Collection[]): HistoryRow[] {
  const generated = collectionHistory(collections);
  const generatedHistoryIds = new Set(generated.map((h) => h.id));
  const manualOrLegacy = history.filter((h) => !h.id.startsWith("collection-history-") && !generatedHistoryIds.has(h.id));
  return [...manualOrLegacy, ...generated];
}
