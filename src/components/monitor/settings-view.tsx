import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { downloadBackup, downloadReadingsCsv, parseBackup, parseReadingsCsv } from "@/lib/backup";
import type { GeneralSettings, Tariff } from "@/lib/engine/types";
import { useMonitor } from "@/store/monitor";

function Field({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (v: string) => void; type?: string }) {
  return <div><Label>{label}</Label><Input className="mt-1" type={type} value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}

function TariffEditor({ title, value, onChange }: { title: string; value: Tariff; onChange: (t: Tariff) => void }) {
  const setAdj = (key: keyof Tariff["adjustments"], v: string) => onChange({ ...value, adjustments: { ...value.adjustments, [key]: Number(v) } });
  const setSlab = (i: number, field: "rate" | "fixed", v: string) => onChange({ ...value, slabs: value.slabs.map((s, idx) => idx === i ? { ...s, [field]: Number(v) } : s) });
  return (
    <details className="rounded-xl border border-border p-4" open={title.includes("1")}>
      <summary className="cursor-pointer font-medium">{title}</summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Consumer type" value={value.consumerType} onChange={(v) => onChange({ ...value, consumerType: v as Tariff["consumerType"] })} />
        <Field label="Slab mode" value={value.slabMode} onChange={(v) => onChange({ ...value, slabMode: v as Tariff["slabMode"] })} />
        <Field label="GST %" value={value.adjustments.GST} type="number" onChange={(v) => setAdj("GST", v)} />
        <Field label="Electricity duty %" value={value.adjustments.ED} type="number" onChange={(v) => setAdj("ED", v)} />
        <Field label="TV fee" value={value.adjustments.TV} type="number" onChange={(v) => setAdj("TV", v)} />
        <Field label="Other fixed" value={value.adjustments.OtherFixed} type="number" onChange={(v) => setAdj("OtherFixed", v)} />
      </div>
      <p className="mt-4 text-xs uppercase tracking-wider text-muted">Slabs (rate / fixed)</p>
      <div className="mt-2 grid gap-2">
        {value.slabs.map((s, i) => (
          <div key={s.min} className="grid grid-cols-[7rem_1fr_1fr] items-center gap-2">
            <span className="text-xs text-muted">{s.max === Infinity ? "Above 700" : `${s.min}–${s.max}`}</span>
            <Input type="number" step="0.01" value={s.rate} onChange={(e) => setSlab(i, "rate", e.target.value)} aria-label={`${s.min} rate`} />
            <Input type="number" step="0.01" value={s.fixed} onChange={(e) => setSlab(i, "fixed", e.target.value)} aria-label={`${s.min} fixed`} />
          </div>
        ))}
      </div>
    </details>
  );
}

function dataForBackup() {
  const s = useMonitor.getState();
  return { readings: s.readings, collections: s.collections, history: s.history, notes: s.notes, general: s.general, tariff1: s.tariff1, tariff2: s.tariff2 };
}

export function SettingsView() {
  const general = useMonitor((s) => s.general);
  const t1 = useMonitor((s) => s.tariff1);
  const t2 = useMonitor((s) => s.tariff2);
  const saveGeneral = useMonitor((s) => s.saveGeneral);
  const saveTariffs = useMonitor((s) => s.saveTariffs);
  const replaceData = useMonitor((s) => s.replaceData);
  const markDirty = useMonitor((s) => s.markDirty);
  const resetDemo = useMonitor((s) => s.resetDemo);
  const fileRef = useRef<HTMLInputElement>(null);
  const [g, setG] = useState<GeneralSettings>(general);
  const [a, setA] = useState<Tariff>(t1);
  const [b, setB] = useState<Tariff>(t2);
  const [status, setStatus] = useState("");

  function exportAll() { downloadBackup(dataForBackup()); setStatus("Full application backup exported."); }
  function exportCsv() { downloadReadingsCsv(useMonitor.getState().readings); setStatus("Readings CSV exported."); }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".csv")) {
        const result = parseReadingsCsv(text, useMonitor.getState().readings);
        if (!result.readings.length) { setStatus(`No new readings found. ${result.duplicates} duplicate rows skipped.`); return; }
        if (!window.confirm(`Import ${result.readings.length} new readings?\n\n${result.duplicates} duplicate rows will be skipped.`)) return;
        useMonitor.setState({ readings: [...useMonitor.getState().readings, ...result.readings].sort((x, y) => x.datetime - y.datetime) });
        markDirty();
        setStatus(`Imported ${result.readings.length} readings; skipped ${result.duplicates} duplicates.`);
        return;
      }
      const backup = parseBackup(text);
      const current = dataForBackup();
      downloadBackup(current);
      if (!window.confirm(`Restore this full backup?\n\nReadings: ${backup.data.readings.length}\nCollections: ${backup.data.collections.length}\nHistory: ${backup.data.history.length}\nNotes: ${backup.data.notes.length}\n\nA safety backup has just been downloaded.`)) return;
      replaceData(backup.data);
      markDirty();
      setG(backup.data.general);
      setA(backup.data.tariff1);
      setB(backup.data.tariff2);
      setStatus("Full application backup restored successfully.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Import failed."); }
  }

  function restoreDemo() {
    resetDemo();
    const next = useMonitor.getState();
    setG(next.general); setA(next.tariff1); setB(next.tariff2);
    setStatus("Demo data restored.");
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <h2 className="font-display text-2xl font-medium">Appearance & links</h2>
        <p className="mt-1 text-sm text-muted">Interface theme, meter colours and the V1 shortcut.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><Label>Theme</Label><select className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" value={g.theme} onChange={(e) => setG({ ...g, theme: e.target.value as GeneralSettings["theme"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
          <div><Label>Meter 1 colour</Label><div className="mt-1 flex gap-2"><input className="h-10 w-12 cursor-pointer rounded-md border border-border bg-background p-1" type="color" value={g.meter1Color} onChange={(e) => setG({ ...g, meter1Color: e.target.value })} /><Input value={g.meter1Color} onChange={(e) => setG({ ...g, meter1Color: e.target.value })} /></div></div>
          <div><Label>Meter 2 colour</Label><div className="mt-1 flex gap-2"><input className="h-10 w-12 cursor-pointer rounded-md border border-border bg-background p-1" type="color" value={g.meter2Color} onChange={(e) => setG({ ...g, meter2Color: e.target.value })} /><Input value={g.meter2Color} onChange={(e) => setG({ ...g, meter2Color: e.target.value })} /></div></div>
          <div className="sm:col-span-2 lg:col-span-3"><Field label="V1 app URL" value={g.v1Url} onChange={(v) => setG({ ...g, v1Url: v })} /></div>
        </div>
        <Button className="mt-5" onClick={() => { saveGeneral(g); setStatus("Appearance and V1 link saved."); }}>Save appearance</Button>
      </section>

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <h2 className="font-display text-2xl font-medium">General</h2>
        <p className="mt-1 text-sm text-muted">Monitoring target, billing boundary and solar window.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Goal combined units" type="number" value={g.goalCombinedUnits} onChange={(v) => setG({ ...g, goalCombinedUnits: Number(v) })} />
          <Field label="Billing day" type="number" value={g.billingDay} onChange={(v) => setG({ ...g, billingDay: Number(v) })} />
          <Field label="Billing hour" type="number" value={g.billingHour} onChange={(v) => setG({ ...g, billingHour: Number(v) })} />
          <Field label="Billing minute" type="number" value={g.billingMinute} onChange={(v) => setG({ ...g, billingMinute: Number(v) })} />
          <Field label="Solar start hour" type="number" value={g.solarStartHour} onChange={(v) => setG({ ...g, solarStartHour: Number(v) })} />
          <Field label="Solar end hour" type="number" value={g.solarEndHour} onChange={(v) => setG({ ...g, solarEndHour: Number(v) })} />
        </div>
        <Button className="mt-5" onClick={() => { saveGeneral(g); setStatus("General settings saved."); }}>Save general</Button>
      </section>

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <h2 className="font-display text-2xl font-medium">Meter tariffs</h2>
        <p className="mt-1 text-sm text-muted">MEPCO A-1 residential slabs. Each meter remains independently configurable.</p>
        <div className="mt-4 space-y-3"><TariffEditor title="Meter 1" value={a} onChange={setA} /><TariffEditor title="Meter 2" value={b} onChange={setB} /></div>
        <div className="mt-5 flex flex-wrap gap-3"><Button onClick={() => { saveTariffs(a, b); setStatus("Tariffs saved."); }}>Save tariffs</Button><Button variant="outline" onClick={restoreDemo}>Restore demo data</Button></div>
      </section>

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <h2 className="font-display text-2xl font-medium">Data & backup</h2>
        <p className="mt-1 text-sm text-muted">All monitor data is stored server-side. Use a full JSON backup before major changes; CSV is for readings exchange.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-4"><p className="font-medium">Full application backup</p><p className="mt-1 text-sm text-muted">Readings, collections, billing history, notes, settings and both tariffs.</p><div className="mt-3 flex flex-wrap gap-2"><Button onClick={exportAll}>Export all data</Button><Button variant="outline" onClick={() => fileRef.current?.click()}>Import backup</Button></div></div>
          <div className="rounded-xl border border-border p-4"><p className="font-medium">Readings CSV</p><p className="mt-1 text-sm text-muted">Exchange readings with Excel or Google Sheets. Imports add new rows and skip duplicates.</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" onClick={exportCsv}>Export readings CSV</Button><Button variant="outline" onClick={() => fileRef.current?.click()}>Import readings CSV</Button></div></div>
        </div>
        <input ref={fileRef} type="file" accept=".json,.csv,application/json,text/csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void handleImport(file); }} />
        {status ? <p className="mt-4 rounded-lg bg-background px-3 py-2 text-sm" role="status">{status}</p> : null}
      </section>
    </div>
  );
}
