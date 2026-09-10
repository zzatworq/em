import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { defaultTariff, DEFAULT_GENERAL } from "@/lib/engine/defaults";
import { syncCollectionHistory } from "@/lib/engine/history";
import { seedCollections, seedHistory, seedNotes, seedReadings } from "@/lib/engine/seed";
import type { Collection, GeneralSettings, HistoryRow, Note, ReadingInput, Tariff } from "@/lib/engine/types";

export type MonitorData = {
  readings: ReadingInput[];
  collections: Collection[];
  history: HistoryRow[];
  notes: Note[];
  general: GeneralSettings;
  tariff1: Tariff;
  tariff2: Tariff;
};

function demo(): MonitorData {
  const collections = seedCollections();
  return {
    readings: seedReadings(),
    collections,
    history: syncCollectionHistory(seedHistory(), collections),
    notes: seedNotes(),
    general: { ...DEFAULT_GENERAL },
    tariff1: defaultTariff(),
    tariff2: defaultTariff(),
  };
}

function normalize(value: unknown): MonitorData {
  const fallback = demo();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const v = value as Partial<MonitorData>;
  const collections = Array.isArray(v.collections) ? v.collections.map((c) => ({ ...c })) : fallback.collections;
  return {
    readings: Array.isArray(v.readings) ? v.readings : fallback.readings,
    collections,
    history: syncCollectionHistory(Array.isArray(v.history) ? v.history : fallback.history, collections),
    notes: Array.isArray(v.notes) ? v.notes : fallback.notes,
    general: v.general && typeof v.general === "object" ? { ...fallback.general, ...v.general } : fallback.general,
    tariff1: v.tariff1 && typeof v.tariff1 === "object" ? v.tariff1 : fallback.tariff1,
    tariff2: v.tariff2 && typeof v.tariff2 === "object" ? v.tariff2 : fallback.tariff2,
  };
}

type DurableObjectId = { readonly name?: string };
type DurableObjectStub = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
type MonitorBinding = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): DurableObjectStub };

function monitorStore(): DurableObjectStub {
  const binding = (env as unknown as { MONITOR_STATE?: MonitorBinding }).MONITOR_STATE;
  if (!binding) throw new Error("Cloudflare MONITOR_STATE binding is missing. Deploy the Worker with the current wrangler.jsonc configuration.");
  return binding.get(binding.idFromName("default"));
}

async function readStoredData(): Promise<unknown> {
  const response = await monitorStore().fetch("https://monitor-state/data");
  if (!response.ok) throw new Error(`Monitor storage read failed (${response.status})`);
  const body = (await response.json()) as { payload?: unknown };
  return body.payload ?? null;
}

async function writeStoredData(data: MonitorData): Promise<void> {
  const response = await monitorStore().fetch("https://monitor-state/data", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(`Monitor storage write failed (${response.status})`);
}

export const loadMonitorData = createServerFn({ method: "GET" }).handler(async (): Promise<MonitorData> => {
  const stored = await readStoredData();
  if (!stored || (typeof stored === "object" && Object.keys(stored).length === 0)) {
    const initial = demo(); await writeStoredData(initial); return initial;
  }
  return normalize(stored);
});

export const saveMonitorData = createServerFn({ method: "POST" }).validator((data: MonitorData) => data).handler(async ({ data }): Promise<MonitorData> => {
  const normalized = normalize(data); await writeStoredData(normalized); return normalized;
});
