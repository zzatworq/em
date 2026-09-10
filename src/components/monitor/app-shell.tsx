import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { BillView } from "@/components/monitor/bill-view";
import { HistoryView } from "@/components/monitor/history-view";
import { NotesView } from "@/components/monitor/notes-view";
import { ReadingsView } from "@/components/monitor/readings-view";
import { SettingsView } from "@/components/monitor/settings-view";
import { SummaryView } from "@/components/monitor/summary-view";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { loadMonitorData, saveMonitorData, type MonitorData } from "@/lib/monitor-data";
import { useDashboard, useMonitor, type TabId } from "@/store/monitor";

const TABS: { id: TabId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "bill", label: "Bill" },
  { id: "history", label: "History" },
  { id: "readings", label: "Readings" },
  { id: "notes", label: "Notes" },
  { id: "settings", label: "Settings" },
];

function dataFromStore(): MonitorData {
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
}

function ShellBody() {
  const tab = useMonitor((s) => s.tab);
  const setTab = useMonitor((s) => s.setTab);
  const selectedMonth = useMonitor((s) => s.selectedMonth);
  const setMonth = useMonitor((s) => s.setMonth);
  const { dashboard, months } = useDashboard();
  const latest = dashboard.empty ? "No readings yet" : `Latest ${dashboard.latestDate}`;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background">
              <Zap className="size-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-medium tracking-tight">Electricity Monitor</h1>
              <p className="truncate text-xs text-muted">{latest}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex gap-1 overflow-x-auto rounded-xl bg-elevated p-1.5 shadow-border">
            {TABS.map((t) => (
              <Button
                key={t.id}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-10 shrink-0 rounded-lg px-3",
                  tab === t.id && "bg-foreground text-background hover:bg-foreground",
                )}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </nav>
          {months.length ? (
            <label className="flex h-12 items-center gap-2 rounded-xl bg-elevated px-3 shadow-border">
              <span className="text-xs font-medium uppercase tracking-wider text-muted">Month</span>
              <select
                className="bg-transparent text-sm font-medium outline-none"
                value={selectedMonth ?? months[0]?.value}
                onChange={(e) => setMonth(e.target.value)}
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {tab === "summary" ? <SummaryView /> : null}
        {tab === "bill" ? <BillView /> : null}
        {tab === "history" ? <HistoryView /> : null}
        {tab === "readings" ? <ReadingsView /> : null}
        {tab === "notes" ? <NotesView /> : null}
        {tab === "settings" ? <SettingsView /> : null}
      </div>
    </div>
  );
}

export function AppShell() {
  const hydrated = useMonitor((s) => s.hydrated);
  const dirty = useMonitor((s) => s.dirty);
  const replaceData = useMonitor((s) => s.replaceData);
  const markSaved = useMonitor((s) => s.markSaved);
  const saveTimer = useRef<number | null>(null);
  const saving = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadMonitorData()
      .then((data) => {
        if (!cancelled) replaceData(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load shared meter data.");
      });
    return () => { cancelled = true; };
  }, [replaceData]);

  useEffect(() => {
    if (!hydrated || !dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      if (saving.current) return;
      saving.current = true;
      try {
        await saveMonitorData({ data: dataFromStore() });
        markSaved();
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save shared meter data.");
      } finally {
        saving.current = false;
      }
    }, 400);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [dirty, hydrated, markSaved]);

  if (!hydrated) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-muted">
        <p className="text-sm">{error ? `Loading failed: ${error}` : "Loading shared meter data…"}</p>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <div className="sticky top-0 z-50 bg-red-600 px-4 py-2 text-center text-sm text-white">
          {error}
        </div>
      ) : null}
      <ShellBody />
    </>
  );
}
