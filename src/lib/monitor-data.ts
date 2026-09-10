import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { defaultTariff, DEFAULT_GENERAL } from "@/lib/engine/defaults";
import { seedCollections, seedHistory, seedNotes, seedReadings } from "@/lib/engine/seed";
import type {
  Collection,
  GeneralSettings,
  HistoryRow,
  Note,
  ReadingInput,
  Tariff,
} from "@/lib/engine/types";

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
  return {
    readings: seedReadings(),
    collections: seedCollections(),
    history: seedHistory(),
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
  return {
    readings: Array.isArray(v.readings) ? v.readings : fallback.readings,
    collections: Array.isArray(v.collections) ? v.collections : fallback.collections,
    history: Array.isArray(v.history) ? v.history : fallback.history,
    notes: Array.isArray(v.notes) ? v.notes : fallback.notes,
    general: v.general && typeof v.general === "object" ? v.general : fallback.general,
    tariff1: v.tariff1 && typeof v.tariff1 === "object" ? v.tariff1 : fallback.tariff1,
    tariff2: v.tariff2 && typeof v.tariff2 === "object" ? v.tariff2 : fallback.tariff2,
  };
}

export const loadMonitorData = createServerFn({ method: "GET" })
  .handler(async (): Promise<MonitorData> => {
    const sql = await getSql();
    const rows = await sql<{ payload: MonitorData }>`
      SELECT payload FROM monitor_state WHERE id = ${"default"} LIMIT 1
    `;
    if (!rows[0]?.payload || Object.keys(rows[0].payload).length === 0) {
      const initial = demo();
      await sql.query(
        "UPDATE monitor_state SET payload = $1::jsonb, updated_at = now() WHERE id = $2",
        [JSON.stringify(initial), "default"],
      );
      return initial;
    }
    return normalize(rows[0].payload);
  });

export const saveMonitorData = createServerFn({ method: "POST" })
  .validator((data: MonitorData) => data)
  .handler(async ({ data }): Promise<MonitorData> => {
    const normalized = normalize(data);
    const sql = await getSql();
    await sql.query(
      "INSERT INTO monitor_state (id, payload, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()",
      ["default", JSON.stringify(normalized)],
    );
    return normalized;
  });
