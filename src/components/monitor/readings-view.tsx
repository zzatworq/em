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

export function ReadingsView() {
  const readings = useMonitor((s) => s.readings);
  const addReading = useMonitor((s) => s.addReading);
  const deleteReading = useMonitor((s) => s.deleteReading);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>("");
  const latest = useMemo(
    () => [...readings].sort((a, b) => b.datetime - a.datetime)[0],
    [readings],
  );
  const [date, setDate] = useState(nowParts().date);
  const [time, setTime] = useState(nowParts().time);
  const [m1, setM1] = useState(latest?.newInput != null ? String(latest.newInput) : "");
  const [m2, setM2] = useState(latest?.oldInput != null ? String(latest.oldInput) : "");
  const [load, setLoad] = useState("");

  const [scanTarget, setScanTarget] = useState<"m1" | "m2">("m1");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<MeterReadingResult | null>(null);
  const [scanError, setScanError] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);

  async function handleScan(file: File) {
    setScanning(true);
    setScanError("");
    setScanResult(null);
    try {
      const base64 = await resizeToBase64(file);
      const result = await extractMeterReading({ data: { imageBase64: base64 } });
      setScanResult(result);
      if (result.value != null) {
        if (scanTarget === "m1") setM1(String(result.value));
        else setM2(String(result.value));
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Could not read the meter photo.");
    } finally {
      setScanning(false);
    }
  }

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
      setStatus("Full application backup restored successfully.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <h2 className="font-display text-2xl font-medium">Readings</h2>
        <p className="mt-1 text-sm text-muted">
          Add a snapshot. Blank meter fields keep the previous carry-forward.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line p-3">
          <span className="text-sm text-muted">Scan a meter photo into</span>
          <div className="flex overflow-hidden rounded-lg border border-line">
            <button
              type="button"
              className={`px-3 py-1.5 text-sm ${scanTarget === "m1" ? "bg-primary text-primary-foreground" : "text-muted"}`}
              onClick={() => setScanTarget("m1")}
            >
              Meter 1
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-sm ${scanTarget === "m2" ? "bg-primary text-primary-foreground" : "text-muted"}`}
              onClick={() => setScanTarget("m2")}
            >
              Meter 2
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={scanning}
            onClick={() => photoRef.current?.click()}
          >
            {scanning ? "Reading photo…" : "Choose photo"}
          </Button>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleScan(file);
              e.target.value = "";
            }}
          />
          {scanResult && (
            <span className="text-sm text-muted">
              Read {scanResult.digits ?? "—"} → {scanResult.value ?? "unreadable"} (
              {scanResult.confidence} confidence
              {scanResult.label ? `, ${scanResult.label}` : ""}) — filled into{" "}
              {scanTarget === "m1" ? "Meter 1" : "Meter 2"}, double-check before saving.
            </span>
          )}
          {scanError && <span className="text-sm text-danger">{scanError}</span>}
        </div>

        <form
          className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!date || !time) return;
            const [y, mo, d] = date.split("-").map(Number);
            const [h, mi] = time.split(":").map(Number);
            const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
            addReading({
              datetime: dt.getTime(),
              newInput: m1 === "" ? null : Number(m1),
              oldInput: m2 === "" ? null : Number(m2),
              loadKw: load === "" ? null : Number(load),
              notes: "",
            });
          }}
        >
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
          <Input type="number" step="0.01" placeholder="Meter 1" value={m1} onChange={(e) => setM1(e.target.value)} />
          <Input type="number" step="0.01" placeholder="Meter 2" value={m2} onChange={(e) => setM2(e.target.value)} />
          <Input type="number" step="0.01" placeholder="Inverter kW" value={load} onChange={(e) => setLoad(e.target.value)} />
          <Button type="submit">Add reading</Button>
        </form>
      </div>

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
