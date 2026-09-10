import { useEffect, useRef, useState } from "react";
import { ExternalLink, Zap } from "lucide-react";
import { Link, Outlet } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { loadMonitorData, saveMonitorData, type MonitorData } from "@/lib/monitor-data";
import { useDashboard, useMonitor } from "@/store/monitor";

const PAGES = [
  { to: "/", label: "Summary" },
  { to: "/bill", label: "Bill" },
  { to: "/history", label: "History" },
  { to: "/notes", label: "Notes" },
  { to: "/settings", label: "Settings" },
  { to: "/readings", label: "Readings" },
] as const;

function dataFromStore(): MonitorData {
  const s = useMonitor.getState();
  return { readings: s.readings, collections: s.collections, history: s.history, notes: s.notes, general: s.general, tariff1: s.tariff1, tariff2: s.tariff2 };
}

export function AppShell() {
  const hydrated = useMonitor((s) => s.hydrated);
  const replaceData = useMonitor((s) => s.replaceData);
  const markSaved = useMonitor((s) => s.markSaved);
  const dirty = useMonitor((s) => s.dirty);
  const general = useMonitor((s) => s.general);
  const selectedMonth = useMonitor((s) => s.selectedMonth);
  const setMonth = useMonitor((s) => s.setMonth);
  const { months } = useDashboard();
  const saveTimer = useRef<number | null>(null);
  const saving = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = general.theme;
    document.documentElement.style.setProperty("--color-meter1", general.meter1Color);
    document.documentElement.style.setProperty("--color-meter2", general.meter2Color);
    return () => { delete document.documentElement.dataset.theme; };
  }, [general.theme, general.meter1Color, general.meter2Color]);

  useEffect(() => {
    let cancelled = false;
    loadMonitorData().then((data) => { if (!cancelled) replaceData(data); }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load shared meter data."); });
    return () => { cancelled = true; };
  }, [replaceData]);

  useEffect(() => {
    if (!hydrated || !dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      if (saving.current) return;
      saving.current = true;
      try { await saveMonitorData({ data: dataFromStore() }); markSaved(); setError(""); }
      catch (err) { setError(err instanceof Error ? err.message : "Could not save shared meter data."); }
      finally { saving.current = false; }
    }, 400);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [dirty, hydrated, markSaved]);

  if (!hydrated) return <div className="flex min-h-dvh items-center justify-center bg-background text-muted"><p className="text-sm">{error ? `Loading failed: ${error}` : "Loading shared meter data…"}</p></div>;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {error ? <div className="sticky top-0 z-50 bg-red-600 px-4 py-2 text-center text-sm text-white">{error}</div> : null}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background"><Zap className="size-4" strokeWidth={1.75} /></div>
            <div className="min-w-0"><h1 className="truncate font-display text-lg font-medium tracking-tight">Electricity Monitor</h1><p className="truncate text-xs text-muted">{months.length ? `Latest ${months[0]?.label}` : "No readings yet"}</p></div>
          </Link>
          {general.v1Url.trim() ? <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5"><a href={general.v1Url.trim()} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /><span className="hidden sm:inline">V1</span></a></Button> : null}
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex gap-1 overflow-x-auto rounded-xl bg-elevated p-1.5 shadow-border">
            {PAGES.map((page) => (
              <Link
                key={page.to}
                to={page.to}
                activeOptions={{ exact: true }}
                className={cn("inline-flex h-10 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors", "text-foreground hover:bg-background", "data-[status=active]:bg-foreground data-[status=active]:text-background")}
              >
                {page.label}
              </Link>
            ))}
          </nav>
          {months.length ? <label className="flex h-12 items-center gap-2 rounded-xl bg-elevated px-3 shadow-border"><span className="text-xs font-medium uppercase tracking-wider text-muted">Month</span><select className="bg-transparent text-sm font-medium outline-none" value={selectedMonth ?? months[0]?.value} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label> : null}
        </div>
        <Outlet />
      </div>
    </div>
  );
}
