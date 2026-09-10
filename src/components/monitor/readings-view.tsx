import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { units } from "@/lib/engine/time";
import {
  downloadBackup,
  downloadReadingsCsv,
  parseBackup,
  parseReadingsCsv,
} from "@/lib/backup";
import { extractMeterReading, type MeterReadingResult } from "@/lib/meter-vision";
import { useMonitor } from "@/store/monitor";

async function resizeToBase64(file: File, maxDim = 1200): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height = Math.round(height * (maxDim / width));
        width = maxDim;
      } else if (height >= width && height > maxDim) {
        width = Math.round(width * (maxDim / height));
        height = maxDim;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => reject(new Error("Could not decode the image"));
    img.src = dataUrl;
  });
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function nowParts() {
  const n = new Date();
  return {
    date: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`,
    time: `${pad(n.getHours())}:${pad(n.getMinutes())}`,
  };
}

type MeterKey = "m1" | "m2";

type MeterSlotState = {
  value: string;
  thumb: string | null;
  status: "idle" | "scanning" | "done" | "error";
  result: MeterReadingResult | null;
  error: string;
};

function emptySlot(value: string): MeterSlotState {
  return { value, thumb: null, status: "idle", result: null, error: "" };
}

function MeterSlot({
  label,
  slot,
  onPhoto,
  onValueChange,
}: {
  label: string;
  slot: MeterSlotState;
  onPhoto: (file: File) => void;
  onValueChange: (value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">{label}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={slot.status === "scanning"}
          onClick={() => fileRef.current?.click()}
        >
          {slot.status === "scanning" ? "Reading…" : slot.thumb ? "Retake photo" : "Photograph"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPhoto(file);
            e.target.value = "";
          }}
        />
      </div>

      {slot.thumb && (
        <img
          src={`data:image/jpeg;base64,${slot.thumb}`}
          alt=""
          className="mt-3 h-32 w-full rounded-lg object-cover"
        />
      )}

      {slot.status === "done" && slot.result && (
        <p className="mt-2 text-sm text-muted">
          Detected {slot.result.digits ?? "—"} → <strong>{slot.result.value ?? "unreadable"}</strong>{" "}
          ({slot.result.confidence} confidence{slot.result.label ? `, ${slot.result.label}` : ""}).
          Check it below before saving.
        </p>
      )}
      {slot.status === "error" && <p className="mt-2 text-sm text-danger">{slot.error}</p>}

      <Input
        className="mt-3"
        type="number"
        step="0.01"
        placeholder={label}
        value={slot.value}
        onChange={(e) => onValueChange(e.target.value)}
      />
    </div>
  );
}

function AddReadingModal({ onClose }: { onClose: () => void }) {
  const addReading = useMonitor((s) => s.addReading);
  const readings = useMonitor((s) => s.readings);
  const latest = useMemo(
    () => [...readings].sort((a, b) => b.datetime - a.datetime)[0],
    [readings],
  );

  const [date, setDate] = useState(nowParts().date);
  const [time, setTime] = useState(nowParts().time);
  const [load, setLoad] = useState("");
  const [m1, setM1] = useState<MeterSlotState>(
    emptySlot(latest?.newInput != null ? String(latest.newInput) : ""),
  );
  const [m2, setM2] = useState<MeterSlotState>(
    emptySlot(latest?.oldInput != null ? String(latest.oldInput) : ""),
  );

  async function handlePhoto(which: MeterKey, file: File) {
    const set = which === "m1" ? setM1 : setM2;
    set((prev) => ({ ...prev, status: "scanning", error: "" }));
    try {
      const base64 = await resizeToBase64(file);
      const result = await extractMeterReading({ data: { imageBase64: base64 } });
      set((prev) => ({
        ...prev,
        thumb: base64,
        status: "done",
        result,
        value: result.value != null ? String(result.value) : prev.value,
      }));
    } catch (err) {
      set((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : "Could not read the meter photo.",
      }));
    }
  }

  const scanning = m1.status === "scanning" || m2.status === "scanning";

  function handleSave() {
    if (!date || !time) return;
    const [y, mo, d] = date.split("-").map(Number);
    const [h, mi] = time.split(":").map(Number);
    const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
    addReading({
      datetime: dt.getTime(),
      newInput: m1.value === "" ? null : Number(m1.value),
      oldInput: m2.value === "" ? null : Number(m2.value),
      loadKw: load === "" ? null : Number(load),
      notes: "",
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-medium">Add reading</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <p className="mt-1 text-sm text-muted">
          Photograph each meter, confirm the reading, then save. Blank fields keep the previous
          carry-forward.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <MeterSlot
            label="Meter 1"
            slot={m1}
            onPhoto={(f) => handlePhoto("m1", f)}
            onValueChange={(v) => setM1((prev) => ({ ...prev, value: v }))}
          />
          <MeterSlot
            label="Meter 2"
            slot={m2}
            onPhoto={(f) => handlePhoto("m2", f)}
            onValueChange={(v) => setM2((prev) => ({ ...prev, value: v }))}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
          <Input
            type="number"
            step="0.01"
            placeholder="Inverter kW"
            value={load}
            onChange={(e) => setLoad(e.target.value)}
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={scanning}>
            {scanning ? "Waiting for photo…" : "Save reading"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ReadingsView() {
  const readings = useMonitor((s) => s.readings);
  const deleteReading = useMonitor((s) => s.deleteReading);
  const clearAllReadings = useMonitor((s) => s.clearAllReadings);
  const markDirty = useMonitor((s) => s.markDirty);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);

  const sorted = useMemo(
    () => [...readings].sort((a, b) => b.datetime - a.datetime),
    [readings],
  );

  const dataForBackup = () => {
    const s = useMonitor.getState();
    return {
      readings: s.readings,
      collections: s.collections,
      history: s.history,
      notes: s.notes,
      general: s.general,
      tariff1: s.tariff1,
      tariff2: s.tariff2,
    };
  };

  function exportAll() {
    downloadBackup(dataForBackup());
    setStatus("Full application backup exported.");
  }

  function exportCsv() {
    downloadReadingsCsv(readings);
    setStatus("Readings CSV exported.");
  }

  function handleClearAll() {
    if (readings.length === 0) return;
    const confirmed = window.confirm(
      `Delete all ${readings.length} readings? Export a backup first if you're not sure — this can't be undone.`,
    );
    if (!confirmed) return;
    clearAllReadings();
    setStatus("All readings cleared.");
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".csv")) {
        const result = parseReadingsCsv(text, useMonitor.getState().readings);
        if (!result.readings.length) {
          setStatus(`No new readings found. ${result.duplicates} duplicate rows skipped.`);
          return;
        }
        const confirmed = window.confirm(
          `Import ${result.readings.length} new readings?\n\n${result.duplicates} duplicate rows will be skipped.`,
        );
        if (!confirmed) return;
        useMonitor.setState({
          readings: [...useMonitor.getState().readings, ...result.readings].sort(
            (a, b) => a.datetime - b.datetime,
          ),
        });
        markDirty();
        setStatus(`Imported ${result.readings.length} readings; skipped ${result.duplicates} duplicates.`);
        return;
      }

      const backup = parseBackup(text);
      const current = useMonitor.getState();
      const safety = {
        readings: current.readings,
        collections: current.collections,
        history: current.history,
        notes: current.notes,
        general: current.general,
        tariff1: current.tariff1,
        tariff2: current.tariff2,
      };

      downloadBackup(safety);
      const confirmed = window.confirm(
        `Restore this full backup?\n\nReadings: ${backup.data.readings.length}\nCollections: ${backup.data.collections.length}\nHistory: ${backup.data.history.length}\nNotes: ${backup.data.notes.length}\n\nThe current application data will be replaced. A safety backup has just been downloaded.`,
      );
      if (!confirmed) return;

      useMonitor.setState({
        readings: backup.data.readings,
        collections: backup.data.collections,
        history: backup.data.history,
        notes: backup.data.notes,
        general: backup.data.general,
        tariff1: backup.data.tariff1,
        tariff2: backup.data.tariff2,
        selectedMonth: null,
        hourlyOverride: null,
      });
      markDirty();
      setStatus("Full application backup restored successfully.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-medium">Readings</h2>
            <p className="mt-1 text-sm text-muted">
              Photograph both meters, confirm, and save.
            </p>
          </div>
          <Button onClick={() => setModalOpen(true)}>Add reading</Button>
        </div>
      </div>

      {modalOpen && <AddReadingModal onClose={() => setModalOpen(false)} />}

      <div className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-xl font-medium">Import & Export</h3>
            <p className="mt-1 text-sm text-muted">
              Back up the complete application or exchange readings with Excel and Google Sheets.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportAll}>Export all data</Button>
            <Button variant="outline" onClick={exportCsv}>Export readings CSV</Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>Import</Button>
            <Button variant="outline" onClick={handleClearAll}>Clear all readings</Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleImport(file);
              }}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-4">
            <p className="font-medium">Full application backup</p>
            <p className="mt-1 text-sm text-muted">
              JSON containing readings, swaps/collections, monthly history, notes, general settings and both tariffs.
            </p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <p className="font-medium">Readings CSV</p>
            <p className="mt-1 text-sm text-muted">
              Date, time, both meters, inverter reading and notes. CSV imports add new rows and skip duplicates.
            </p>
          </div>
        </div>

        {status ? (
          <p className="mt-4 rounded-lg bg-background px-3 py-2 text-sm" role="status">{status}</p>
        ) : null}
      </div>

      <div className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-medium">Recent readings</h3>
          <span className="text-sm text-muted">{readings.length} total</span>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="pb-2 font-medium">When</th>
                <th className="pb-2 text-right font-medium">Meter 1</th>
                <th className="pb-2 text-right font-medium">Meter 2</th>
                <th className="pb-2 text-right font-medium">Load</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 80).map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2.5">
                    {new Date(r.datetime).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{units(r.newInput)}</td>
                  <td className="py-2.5 text-right tabular-nums">{units(r.oldInput)}</td>
                  <td className="py-2.5 text-right tabular-nums">{units(r.loadKw)}</td>
                  <td className="py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => deleteReading(r.id)}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
