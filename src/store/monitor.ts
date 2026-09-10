import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultTariff, DEFAULT_GENERAL } from "@/lib/engine/defaults";
import { availableMonths, computeDashboard, hourlyForDay } from "@/lib/engine/dashboard";
import { seedCollections, seedHistory, seedNotes, seedReadings } from "@/lib/engine/seed";
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

type State = {
  readings: ReadingInput[];
  collections: Collection[];
  history: HistoryRow[];
  notes: Note[];
  general: GeneralSettings;
  tariff1: Tariff;
  tariff2: Tariff;
  tab: TabId;
  selectedMonth: string | null;
  assume5050: boolean;
  hourlyDay: string;
  hourlyOverride: HourlyPoint[] | null;
  setTab: (tab: TabId) => void;
  setMonth: (value: string) => void;
  setAssume5050: (v: boolean) => void;
  setHourlyDay: (v: string) => void;
  addReading: (r: Omit<ReadingInput, "id">) => void;
  updateReading: (id: string, r: Partial<ReadingInput>) => void;
  deleteReading: (id: string) => void;
  clearAllReadings: () => void;
  addNote: (text: string) => void;
  deleteNote: (id: string) => void;
  addCollection: (c: Omit<Collection, "id">) => void;
  saveGeneral: (g: GeneralSettings) => void;
  saveTariffs: (t1: Tariff, t2: Tariff) => void;
  resetDemo: () => void;
};

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

const demo = () => ({
  readings: seedReadings(),
  collections: seedCollections(),
  history: seedHistory(),
  notes: seedNotes(),
  general: { ...DEFAULT_GENERAL },
  tariff1: defaultTariff(),
  tariff2: defaultTariff(),
});

export const useMonitor = create<State>()(
  persist(
    (set, get) => ({
      ...demo(),
      tab: "summary",
      selectedMonth: null,
      assume5050: true,
      hourlyDay: "last24",
      hourlyOverride: null,
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
      addReading: (r) => set({ readings: [...get().readings, { ...r, id: uid("r") }] }),
      updateReading: (id, r) =>
        set({
          readings: get().readings.map((x) => (x.id === id ? { ...x, ...r } : x)),
        }),
      deleteReading: (id) => set({ readings: get().readings.filter((x) => x.id !== id) }),
      clearAllReadings: () => set({ readings: [] }),
      addNote: (text) =>
        set({
          notes: [{ id: uid("n"), timestamp: Date.now(), text }, ...get().notes],
        }),
      deleteNote: (id) => set({ notes: get().notes.filter((n) => n.id !== id) }),
      addCollection: (c) =>
        set({ collections: [...get().collections, { ...c, id: uid("c") }] }),
      saveGeneral: (general) => set({ general }),
      saveTariffs: (tariff1, tariff2) => set({ tariff1, tariff2 }),
      resetDemo: () => set({ ...demo(), selectedMonth: null, hourlyOverride: null }),
    }),
    {
      name: "electricity-monitor-v1",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({
        readings: s.readings,
        collections: s.collections,
        history: s.history,
        notes: s.notes,
        general: s.general,
        tariff1: s.tariff1,
        tariff2: s.tariff2,
      }),
    },
  ),
);

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
