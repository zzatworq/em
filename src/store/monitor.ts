import { create } from "zustand";
import { defaultTariff, DEFAULT_GENERAL } from "@/lib/engine/defaults";
import { availableMonths, computeDashboard, hourlyForDay } from "@/lib/engine/dashboard";
import type { MonitorData } from "@/lib/monitor-data";
import type {
  Collection,
  GeneralSettings,
  HistoryRow,
  HourlyPoint,
  Note,
  ReadingInput,
  Tariff,
} from "@/lib/engine/types";

export type TabId = "summary" | "bill" | "history" | "readings" | "notes" | "settings";

type State = MonitorData & {
  tab: TabId;
  selectedMonth: string | null;
  assume5050: boolean;
  hourlyDay: string;
  hourlyOverride: HourlyPoint[] | null;
  hydrated: boolean;
  dirty: boolean;
  setTab: (tab: TabId) => void;
  setMonth: (value: string) => void;
  setAssume5050: (v: boolean) => void;
  setHourlyDay: (v: string) => void;
  replaceData: (data: MonitorData) => void;
  markDirty: () => void;
  markSaved: () => void;
  addReading: (r: Omit<ReadingInput, "id">) => void;
  updateReading: (id: string, r: Partial<ReadingInput>) => void;
  deleteReading: (id: string) => void;
  clearAllReadings: () => void;
  addNote: (text: string) => void;
  deleteNote: (id: string) => void;
  addCollection: (c: Omit<Collection, "id">) => void;
  saveGeneral: (g: GeneralSettings) => void;
  saveTariffs: (t1: Tariff, t2: Tariff) => void;
};

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
}

const empty = (): MonitorData => ({
  readings: [],
  collections: [],
  history: [],
  notes: [],
  general: { ...DEFAULT_GENERAL },
  tariff1: defaultTariff(),
  tariff2: defaultTariff(),
});

export const useMonitor = create<State>()((set, get) => ({
  ...empty(),
  tab: "summary",
  selectedMonth: null,
  assume5050: true,
  hourlyDay: "last24",
  hourlyOverride: null,
  hydrated: false,
  dirty: false,
  setTab: (tab) => set({ tab }),
  setMonth: (value) => set({ selectedMonth: value, hourlyOverride: null }),
  setAssume5050: (assume5050) => set({ assume5050 }),
  setHourlyDay: (hourlyDay) => {
    const s = get();
    set({
      hourlyDay,
      hourlyOverride: hourlyForDay(s.readings, hourlyDay, new Date(), s.general),
    });
  },
  replaceData: (data) => set({ ...data, hydrated: true, dirty: false, selectedMonth: null, hourlyOverride: null }),
  markDirty: () => set({ dirty: true }),
  markSaved: () => set({ dirty: false }),
  addReading: (r) => set({ readings: [...get().readings, { ...r, id: uid("r") }], dirty: true }),
  updateReading: (id, r) => set({ readings: get().readings.map((x) => (x.id === id ? { ...x, ...r } : x)), dirty: true }),
  deleteReading: (id) => set({ readings: get().readings.filter((x) => x.id !== id), dirty: true }),
  clearAllReadings: () => set({ readings: [], dirty: true }),
  addNote: (text) => set({ notes: [{ id: uid("n"), timestamp: Date.now(), text }, ...get().notes], dirty: true }),
  deleteNote: (id) => set({ notes: get().notes.filter((n) => n.id !== id), dirty: true }),
  addCollection: (c) => set({ collections: [...get().collections, { ...c, id: uid("c") }], dirty: true }),
  saveGeneral: (general) => set({ general, dirty: true }),
  saveTariffs: (tariff1, tariff2) => set({ tariff1, tariff2, dirty: true }),
}));

export function useDashboard() {
  const readings = useMonitor((s) => s.readings);
  const collections = useMonitor((s) => s.collections);
  const general = useMonitor((s) => s.general);
  const tariff1 = useMonitor((s) => s.tariff1);
  const tariff2 = useMonitor((s) => s.tariff2);
  const selectedMonth = useMonitor((s) => s.selectedMonth);
  const now = new Date();
  const months = availableMonths(readings, now, general);
  const selectedStart = selectedMonth ? new Date(Number(selectedMonth)) : null;
  const dashboard = computeDashboard({
    inputs: readings,
    now,
    selectedStart: selectedStart && !Number.isNaN(selectedStart.getTime()) ? selectedStart : null,
    gs: general,
    tariff1,
    tariff2,
    collections,
  });
  return { dashboard, months, now };
}
