import type { Collection, GeneralSettings, HistoryRow, Note, ReadingInput, Tariff } from "@/lib/engine/types";

export type MonitorBackup = {
  format: "emonitor-backup";
  version: 1;
  exportedAt: string;
  data: {
    readings: ReadingInput[];
    collections: Collection[];
    history: HistoryRow[];
    notes: Note[];
    general: GeneralSettings;
    tariff1: Tariff;
    tariff2: Tariff;
  };
};

export function makeBackup(state: MonitorBackup["data"]): MonitorBackup {
  return {
    format: "emonitor-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      readings: structuredClone(state.readings),
      collections: structuredClone(state.collections),
      history: structuredClone(state.history),
      notes: structuredClone(state.notes),
      general: structuredClone(state.general),
      tariff1: structuredClone(state.tariff1),
      tariff2: structuredClone(state.tariff2),
    },
  };
}

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadBackup(data: MonitorBackup["data"]) {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(
    `emonitor-backup-${stamp}.json`,
    JSON.stringify(makeBackup(data), null, 2),
    "application/json",
  );
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function localDateTime(timestamp: number) {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  ];
}

export function downloadReadingsCsv(readings: ReadingInput[]) {
  const rows = [
    ["ID", "Date", "Time", "Meter 1", "Meter 2", "Inverter Reading (kW)", "Notes"],
    ...[...readings]
      .sort((a, b) => a.datetime - b.datetime)
      .map((r) => {
        const [date, time] = localDateTime(r.datetime);
        return [r.id, date, time, r.newInput, r.oldInput, r.loadKw, r.notes];
      }),
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(
    `emonitor-readings-${stamp}.csv`,
    rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }
  return rows;
}

function column(headers: string[], ...names: string[]) {
  return headers.findIndex((h) => names.includes(h.trim().toLowerCase()));
}

function numberValue(value: string | undefined, row: number, field: string) {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Row ${row}: ${field} is not a valid number.`);
  return n;
}

function parseDateParts(date: string, row: number) {
  const parts = date.trim().split(/[\/-]/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Row ${row}: invalid date.`);
  }
  const [a, b, c] = parts;
  if (a >= 1000) return { year: a, month: b, day: c };
  return { year: c < 100 ? 2000 + c : c, month: b, day: a };
}

function legacyDateTime(date: string, time: string, row: number) {
  const { year, month, day } = parseDateParts(date, row);
  const match = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) throw new Error(`Row ${row}: invalid time.`);
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  const meridiem = match[4]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const dt = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day ||
    dt.getHours() !== hour ||
    dt.getMinutes() !== minute
  ) {
    throw new Error(`Row ${row}: invalid date/time.`);
  }
  return dt.getTime();
}

export function parseReadingsCsv(text: string, existing: ReadingInput[]) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("The CSV contains no reading rows.");

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const dateI = column(headers, "date");
  const timeI = column(headers, "time");
  const m1I = column(headers, "meter 1", "meter1");
  const m2I = column(headers, "meter 2", "meter2");
  const legacyNewI = column(headers, "new meter reading (kwh)", "new meter reading");
  const legacyOldI = column(headers, "old meter reading (kwh)", "old meter reading");
  const loadI = column(headers, "inverter reading (kw)", "inverter kw", "load", "load kw");
  const notesI = column(headers, "notes", "note");
  const idI = column(headers, "id");

  const legacySwapFormat = legacyNewI >= 0 && legacyOldI >= 0;
  if (dateI < 0 || timeI < 0 || (!legacySwapFormat && (m1I < 0 || m2I < 0))) {
    throw new Error(
      "CSV must contain Date and Time plus either Meter 1/Meter 2 or New Meter Reading/Old Meter Reading columns.",
    );
  }

  const existingKeys = new Set(existing.map((r) => `${r.datetime}|${r.newInput}|${r.oldInput}|${r.loadKw}`));
  const imported: ReadingInput[] = [];
  let duplicates = 0;
  let activeMeter: "new" | "old" = "new";
  let seenLegacySwap = false;
  let meter1: number | null = null;
  let meter2: number | null = null;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const rowNumber = i + 1;
    if (!row[dateI]?.trim() && !row[timeI]?.trim()) continue;

    const datetime = legacyDateTime(row[dateI] ?? "", row[timeI] ?? "", rowNumber);
    const rawNew = legacySwapFormat
      ? numberValue(row[legacyNewI], rowNumber, "New Meter Reading")
      : numberValue(row[m1I], rowNumber, "Meter 1");
    const rawOld = legacySwapFormat
      ? numberValue(row[legacyOldI], rowNumber, "Old Meter Reading")
      : numberValue(row[m2I], rowNumber, "Meter 2");

    if (legacySwapFormat) {
      const isSwap = rawNew !== null && rawOld !== null;
      if (isSwap) {
        if (!seenLegacySwap) {
          meter1 = rawNew;
          meter2 = rawOld;
          activeMeter = "new";
          seenLegacySwap = true;
        } else {
          meter1 = rawNew;
          meter2 = rawOld;
          activeMeter = activeMeter === "new" ? "old" : "new";
        }
      } else if (rawNew !== null || rawOld !== null) {
        const activeValue = rawNew ?? rawOld;
        if (!seenLegacySwap) {
          if (rawNew !== null) meter1 = rawNew;
          if (rawOld !== null) meter2 = rawOld;
        } else if (activeMeter === "new") {
          meter1 = activeValue;
        } else {
          meter2 = activeValue;
        }
      }
    } else {
      if (rawNew !== null) meter1 = rawNew;
      if (rawOld !== null) meter2 = rawOld;
    }

    const reading: ReadingInput = {
      id: idI >= 0 && row[idI]?.trim() ? row[idI].trim() : `r-import-${Date.now().toString(36)}-${i}`,
      datetime,
      newInput: legacySwapFormat ? meter1 : rawNew,
      oldInput: legacySwapFormat ? meter2 : rawOld,
      loadKw: loadI >= 0 ? numberValue(row[loadI], rowNumber, "Inverter Reading") : null,
      notes: notesI >= 0 ? row[notesI] ?? "" : "",
    };

    const key = `${reading.datetime}|${reading.newInput}|${reading.oldInput}|${reading.loadKw}`;
    if (existingKeys.has(key)) {
      duplicates += 1;
      continue;
    }
    existingKeys.add(key);
    imported.push(reading);
  }

  return { readings: imported, duplicates, rows: rows.length - 1 };
}

export function parseBackup(text: string): MonitorBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid eMonitor backup.");
  const backup = parsed as Partial<MonitorBackup>;
  if (backup.format !== "emonitor-backup" || backup.version !== 1 || !backup.data) {
    throw new Error("Unsupported eMonitor backup format or version.");
  }
  const d = backup.data as Partial<MonitorBackup["data"]>;
  if (
    !Array.isArray(d.readings) ||
    !Array.isArray(d.collections) ||
    !Array.isArray(d.history) ||
    !Array.isArray(d.notes) ||
    !d.general ||
    !d.tariff1 ||
    !d.tariff2
  ) {
    throw new Error("The backup is incomplete or corrupted.");
  }
  return backup as MonitorBackup;
}
