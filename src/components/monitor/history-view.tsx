import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { calculateProRata } from "@/lib/engine/bill";
import { money, units } from "@/lib/engine/time";
import { useMonitor } from "@/store/monitor";
import type { HistoryRow, MeterId } from "@/lib/engine/types";

function historyMonthTime(month: string): number {
  const match = month.trim().match(/^([A-Za-z]{3,9})\s+(\d{2}|\d{4})$/);
  if (!match) return 0;
  const monthIndex = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(match[1].slice(0, 3).toLowerCase());
  if (monthIndex < 0) return 0;
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return new Date(year, monthIndex, 1).getTime();
}

function HistoryTable({ title, rows }: { title: string; rows: HistoryRow[] }) {
  const sorted = [...rows].sort((a, b) => historyMonthTime(b.month) - historyMonthTime(a.month));
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        <span className="text-xs text-muted">{sorted.length} periods</span>
      </div>
      <div className="grid gap-2 sm:hidden">
        {sorted.map((r) => (
          <div key={r.id} className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{r.month}</span>
              <span className="text-xs font-medium text-muted">{r.status}</span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-xs text-muted">Units</dt><dd className="tabular-nums">{units(r.units, 0)}</dd></div>
              <div><dt className="text-xs text-muted">Bill</dt><dd className="tabular-nums">{money(r.bill)}</dd></div>
              <div><dt className="text-xs text-muted">Paid</dt><dd className="tabular-nums">{money(r.payment)}</dd></div>
            </dl>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th className="pb-2 font-medium">Month</th>
              <th className="w-12 pb-2 text-center font-medium">Status</th>
              <th className="pb-2 text-right font-medium">Units</th>
              <th className="pb-2 text-right font-medium">Bill</th>
              <th className="pb-2 text-right font-medium">Unit cost</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-2.5">{r.month}</td>
                <td className="w-12 py-2.5 text-center text-xs font-medium text-muted">{r.status}</td>
                <td className="py-2.5 text-right tabular-nums">{units(r.units, 0)}</td>
                <td className="py-2.5 text-right tabular-nums">{money(r.bill)}</td>
                <td className="py-2.5 text-right tabular-nums">{r.units > 0 ? money(r.bill / r.units) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function localDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time || "00:00"}:00`);
}

function calendarDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function billingMonth(date: string): string {
  const value = new Date(`${date}T12:00:00`);
  return Number.isNaN(value.getTime()) ? "" : value.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function daysInMonth(date: string): number {
  const value = new Date(`${date}T12:00:00`);
  return Number.isNaN(value.getTime()) ? 0 : new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate();
}

export function HistoryView() {
  const history = useMonitor((s) => s.history);
  const collections = useMonitor((s) => s.collections);
  const addCollection = useMonitor((s) => s.addCollection);
  const [meter, setMeter] = useState<MeterId>("METER 1");
  const [date, setDate] = useState("2026-09-08");
  const [time, setTime] = useState("12:00");
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState("EX");
  const [bill, setBill] = useState("");
  const [payment, setPayment] = useState("");
  const [collectionOpen, setCollectionOpen] = useState(false);

  const calculated = useMemo(() => {
    const current = localDateTime(date, time);
    const prior = collections
      .filter((c) => c.meter === meter && localDateTime(c.date, c.time).getTime() < current.getTime())
      .sort((a, b) => localDateTime(b.date, b.time).getTime() - localDateTime(a.date, a.time).getTime())[0];
    const month = billingMonth(date);
    const standardDays = daysInMonth(date);
    const extendedDays = prior ? calendarDaysBetween(prior.date, date) : standardDays;
    return {
      month,
      baseline: prior?.rawReading ?? null,
      extendedDays,
      standardDays,
      prior,
    };
  }, [collections, date, meter, time]);

  const canSave = raw !== "" && calculated.baseline != null && calculated.extendedDays > 0 && calculated.standardDays > 0;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-medium">Collection audit</h2>
            <p className="mt-1 text-sm text-muted">Record official meter collections and automatically update billing history.</p>
          </div>
          <Button onClick={() => setCollectionOpen(true)}>Add collection</Button>
        </div>
      </section>

      {collectionOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 className="font-display text-2xl font-medium">Collection audit</h2>
          <p className="mt-1 text-sm text-muted">Enter only the official collection information. Billing month, previous baseline, day counts and billed units are calculated automatically.</p>
          </div><Button variant="ghost" size="sm" onClick={() => setCollectionOpen(false)}>Close</Button></div>
        <form
          className="mt-6 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSave || !date || !time) return;
            addCollection({
              meter,
              date,
              time,
              rawReading: Number(raw),
              previousBaseline: calculated.baseline as number,
              month: calculated.month,
              extendedDays: calculated.extendedDays,
              standardDays: calculated.standardDays,
              status: status || "EX",
              bill: bill === "" ? 0 : Number(bill),
              payment: payment === "" ? 0 : Number(payment),
            });
            setRaw("");
            setBill("");
            setPayment("");
            setCollectionOpen(false);
          }}
        >
          <div>
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Official inputs</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><Label htmlFor="col-meter">Meter</Label><select id="col-meter" value={meter} onChange={(e) => setMeter(e.target.value as MeterId)} className="mt-1 h-11 w-full rounded-md border border-border bg-elevated px-3 text-sm"><option>METER 1</option><option>METER 2</option></select></div>
              <div><Label htmlFor="col-date">Date</Label><Input id="col-date" type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div><Label htmlFor="col-time">Time</Label><Input id="col-time" type="time" className="mt-1" value={time} onChange={(e) => setTime(e.target.value)} /></div>
              <div><Label htmlFor="col-raw">Raw reading</Label><Input id="col-raw" type="number" step="0.01" className="mt-1" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Official meter reading" /></div>
              <div><Label htmlFor="col-status">Status</Label><Input id="col-status" className="mt-1" value={status} onChange={(e) => setStatus(e.target.value.toUpperCase())} /></div>
              <div><Label htmlFor="col-bill">Official bill</Label><Input id="col-bill" type="number" step="1" className="mt-1" placeholder="Optional" value={bill} onChange={(e) => setBill(e.target.value)} /></div>
              <div><Label htmlFor="col-paid">Paid</Label><Input id="col-paid" type="number" step="1" className="mt-1" placeholder="Optional" value={payment} onChange={(e) => setPayment(e.target.value)} /></div>
              <div className="flex items-end"><Button type="submit" disabled={!canSave}>Save collection</Button></div>
            </div>
          </div>

          <div>
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Calculated automatically</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-border p-3"><div className="text-xs text-muted">Billing month</div><div className="mt-1 font-medium">{calculated.month || "—"}</div></div>
              <div className="rounded-xl border border-border p-3"><div className="text-xs text-muted">Previous baseline</div><div className="mt-1 tabular-nums">{calculated.baseline == null ? "—" : units(calculated.baseline)}</div></div>
              <div className="rounded-xl border border-border p-3"><div className="text-xs text-muted">Extended days</div><div className="mt-1 tabular-nums">{calculated.extendedDays || "—"}</div></div>
              <div className="rounded-xl border border-border p-3"><div className="text-xs text-muted">Standard days</div><div className="mt-1 tabular-nums">{calculated.standardDays || "—"}</div></div>
            </div>
            {calculated.prior ? (
              <p className="mt-2 text-xs text-muted">Baseline comes from the previous official {meter} collection ({calculated.prior.month}, {calculated.prior.rawReading}). Extended days are the calendar-day interval between the two official collection dates.</p>
            ) : (
              <p className="mt-2 text-xs text-muted">No earlier collection exists for this meter, so a baseline cannot be calculated yet. Record the first baseline separately rather than silently using zero.</p>
            )}
          </div>
        </form>
      </div>
      </div> : null}

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div>
          <h2 className="font-display text-2xl font-medium">Billing history</h2>
          <p className="mt-1 text-sm text-muted">One independent billing record per meter. Collection entries update this table automatically.</p>
        </div>
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <HistoryTable title="Meter 1" rows={history.filter((h) => h.meter === "METER 1")} />
          <HistoryTable title="Meter 2" rows={history.filter((h) => h.meter === "METER 2")} />
        </div>
      </section>

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="space-y-3">
          {collections.length === 0 ? <p className="text-sm text-muted">No collection entries yet.</p> : collections.map((c) => {
            const audit = calculateProRata(c.previousBaseline, c.rawReading, Math.round(c.extendedDays || 30), Math.round(c.standardDays || 30));
            return (
              <article key={c.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><h3 className="font-medium">{c.month} — {c.meter}</h3><p className="text-xs text-muted">Collected {c.date} at {c.time}</p></div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{c.status || "EX"}</span>
                </div>
                {audit ? (
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                    <div><dt className="text-xs text-muted">Baseline</dt><dd className="tabular-nums">{units(c.previousBaseline)}</dd></div>
                    <div><dt className="text-xs text-muted">Raw</dt><dd className="tabular-nums">{units(c.rawReading)}</dd></div>
                    <div><dt className="text-xs text-muted">Actual units</dt><dd className="tabular-nums">{units(audit.actualUnits)}</dd></div>
                    <div><dt className="text-xs text-muted">Billed ({audit.standardDays}d)</dt><dd className="font-medium tabular-nums">{units(audit.billedUnits)}</dd></div>
                    <div><dt className="text-xs text-muted">Carry-forward</dt><dd className="tabular-nums">{units(audit.carryForward)}</dd></div>
                    <div><dt className="text-xs text-muted">Official bill</dt><dd className="tabular-nums">{money(c.bill || 0)}</dd></div>
                  </dl>
                ) : (
                  <p className="mt-3 text-sm text-muted">Unable to calculate pro-rata audit for this collection. Check the baseline, raw reading, and day counts.</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
