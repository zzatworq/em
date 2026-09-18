import { create } from "zustand";
import { defaultTariff, DEFAULT_GENERAL } from "@/lib/engine/defaults";
import { rebuildCollectionChain, syncCollectionHistory } from "@/lib/engine/history";
import { availableMonths, computeDashboard, hourlyForDay } from "@/lib/engine/dashboard";
import { getHourlyDistributionProfile } from "@/lib/engine/hourly-profile";
import type { MonitorData } from "@/lib/monitor-data";
import type { Collection, GeneralSettings, HourlyPoint, Note, ReadingInput, Tariff } from "@/lib/engine/types";

export type TabId = "summary" | "bill" | "history" | "readings" | "notes" | "settings";
type State = MonitorData & { tab: TabId; selectedMonth: string | null; assume5050: boolean; hourlyDay: string; hourlyOverride: HourlyPoint[] | null; hydrated: boolean; dirty: boolean; setTab: (tab: TabId) => void; setMonth: (value: string) => void; setAssume5050: (v: boolean) => void; setHourlyDay: (v: string) => void; replaceData: (data: MonitorData) => void; markDirty: () => void; markSaved: () => void; addReading: (r: Omit<ReadingInput, "id">) => void; updateReading: (id: string, r: Partial<ReadingInput>) => void; deleteReading: (id: string) => void; clearAllReadings: () => void; addNote: (text: string) => void; deleteNote: (id: string) => void; addCollection: (c: Omit<Collection, "id">) => void; updateCollection: (id: string, c: Partial<Collection>) => void; deleteCollection: (id: string) => void; saveGeneral: (g: GeneralSettings) => void; saveTariffs: (t1: Tariff, t2: Tariff) => void; resetDemo: () => void; fixMeter2LegacyReadings: () => void };
function uid(prefix: string) { return `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`; }
const empty = (): MonitorData => ({ readings: [], collections: [], history: [], notes: [], general: { ...DEFAULT_GENERAL }, tariff1: defaultTariff(), tariff2: defaultTariff() });
export const useMonitor = create<State>()((set, get) => ({
  ...empty(), tab: "summary", selectedMonth: null, assume5050: false, hourlyDay: "last24", hourlyOverride: null, hydrated: false, dirty: false,
  setTab: (tab) => set({ tab }), setMonth: (value) => set({ selectedMonth: value, hourlyOverride: null }), setAssume5050: (assume5050) => set({ assume5050 }),
  setHourlyDay: (hourlyDay) => { const s = get(); set({ hourlyDay, hourlyOverride: hourlyForDay(s.readings, hourlyDay, new Date(), s.general) }); },
  replaceData: (data) => { const collections = rebuildCollectionChain(data.collections ?? []); set({ ...data, collections, history: syncCollectionHistory(data.history ?? [], collections), hydrated: true, dirty: false, selectedMonth: null, hourlyOverride: null }); },
  markDirty: () => set({ dirty: true }), markSaved: () => set({ dirty: false }),
  addReading: (r) => set({ readings: [...get().readings, { ...r, id: uid("r") }], dirty: true }),
  updateReading: (id, r) => set({ readings: get().readings.map((x) => x.id === id ? { ...x, ...r } : x), dirty: true }),
  deleteReading: (id) => set({ readings: get().readings.filter((x) => x.id !== id), dirty: true }), clearAllReadings: () => set({ readings: [], dirty: true }),
  addNote: (text) => set({ notes: [{ id: uid("n"), timestamp: Date.now(), text }, ...get().notes], dirty: true }), deleteNote: (id) => set({ notes: get().notes.filter((n) => n.id !== id), dirty: true }),
  addCollection: (c) => { const collections = rebuildCollectionChain([...get().collections, { ...c, id: uid("c") }]); set({ collections, history: syncCollectionHistory(get().history, collections), dirty: true }); },
  updateCollection: (id, patch) => { const collections = rebuildCollectionChain(get().collections.map((c) => c.id === id ? { ...c, ...patch } : c)); set({ collections, history: syncCollectionHistory(get().history, collections), dirty: true }); },
  deleteCollection: (id) => { const collections = rebuildCollectionChain(get().collections.filter((c) => c.id !== id)); set({ collections, history: syncCollectionHistory(get().history, collections), dirty: true }); },
  saveGeneral: (general) => set({ general, dirty: true }), saveTariffs: (tariff1, tariff2) => set({ tariff1, tariff2, dirty: true }), resetDemo: () => set({ ...empty(), dirty: true }),
  // One-time correction: the seeded/legacy Meter 2 "reading" values (Jul 25 – Jul 26)
  // were 1000 units higher than the actual meter, which the live pro-rata chain
  // already accounts for from the Aug 2026 collection onward (previousBaseline: 4854).
  // This patches the already-persisted rows to match. Safe to run more than once —
  // it only rewrites rows whose reading still matches the known stale value.
  fixMeter2LegacyReadings: () => {
    const OLD_TO_NEW: Record<string, [number, number]> = {
      "Jul 25": [4788, 3788], "Aug 25": [4910, 3910], "Sep 25": [5004, 4004], "Oct 25": [5108, 4108],
      "Nov 25": [5194, 4194], "Dec 25": [5244, 4244], "Jan 26": [5315, 4315], "Feb 26": [5356, 4356],
      "Mar 26": [5379, 4379], "Apr 26": [5416, 4416], "May 26": [5480, 4480], "Jun 26": [5645, 4645],
      "Jul 26": [5854, 4854],
    };
    const history = get().history.map((row) => {
      const entry = row.meter === "METER 2" ? OLD_TO_NEW[row.month] : undefined;
      return entry && Number(row.reading) === entry[0] ? { ...row, reading: entry[1] } : row;
    });
    set({ history, dirty: true });
  },
}));

export function useDashboard() {
  const readings = useMonitor((s) => s.readings), collections = useMonitor((s) => s.collections), general = useMonitor((s) => s.general), tariff1 = useMonitor((s) => s.tariff1), tariff2 = useMonitor((s) => s.tariff2), selectedMonth = useMonitor((s) => s.selectedMonth);
  const now = new Date(), months = availableMonths(readings, now, general), selectedStart = selectedMonth ? new Date(Number(selectedMonth)) : null;
  const dashboard = computeDashboard({ inputs: readings, now, selectedStart: selectedStart && !Number.isNaN(selectedStart.getTime()) ? selectedStart : null, gs: general, tariff1, tariff2, collections });
  const hourlyProfile = getHourlyDistributionProfile(readings, general, now);
  return { dashboard, months, now, hourlyProfile };
}
