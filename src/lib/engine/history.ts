import type { Collection, HistoryRow } from "./types";

export function collectionHistory(collections: Collection[]): HistoryRow[] {
  return collections.map((c) => {
    const standardDays = Math.round(c.standardDays || 30);
    const extendedDays = Math.round(c.extendedDays || standardDays);
    const actualUnits = c.rawReading - c.previousBaseline;
    const billedUnits = Math.floor((extendedDays > 0 ? actualUnits / extendedDays : 0) * standardDays);
    return {
      id: `collection-history-${c.id}`,
      month: c.month,
      meter: c.meter,
      status: c.status || "EX",
      units: Math.max(0, billedUnits),
      bill: Number.isFinite(c.bill) ? Number(c.bill) : 0,
      payment: Number.isFinite(c.payment) ? Number(c.payment) : 0,
    };
  });
}

export function syncCollectionHistory(history: HistoryRow[], collections: Collection[]): HistoryRow[] {
  const generated = collectionHistory(collections);
  const generatedKeys = new Set(generated.map((h) => `${h.meter}|${h.month}`));
  return [...history.filter((h) => !generatedKeys.has(`${h.meter}|${h.month}`)), ...generated];
}
