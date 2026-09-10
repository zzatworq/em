import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { calculateProRata } from "@/lib/engine/bill";
import { money, units } from "@/lib/engine/time";
import { useMonitor } from "@/store/monitor";
import type { HistoryRow, MeterId } from "@/lib/engine/types";

function HistoryTable({ title, rows }: { title: string; rows: HistoryRow[] }) {
  const sorted = [...rows].sort((a, b) => {
    const ay = Number(`20${a.month.slice(-2)}`);
    const by = Number(`20${b.month.slice(-2)}`);
    return by - ay || b.month.localeCompare(a.month);
  });
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        <span className="text-xs text-muted">{sorted.length} periods</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th className="pb-2 font-medium">Month</th>
              <th className="w-12 pb-2 text-center font-medium">Status</th>
              <th className="pb-2 text-right font-medium">Units</th>
              <th className="pb-2 text-right font-medium">Bill</th>
              <th className="pb-2 text-right font-medium">Paid</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-2.5">{r.month}</td>
                <td className="w-12 py-2.5 text-center text-xs font-medium text-muted">{r.status}</td>
                <td className="py-2.5 text-right tabular-nums">{units(r.units, 0)}</td>
                <td className="py-2.5 text-right tabular-nums">{money(r.bill)}</td>
                <td className="py-2.5 text-right tabular-nums">{money(r.payment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HistoryView() {
  const history = useMonitor((s) => s.history);
  const collections = useMonitor((s) => s.collections);
  const addCollection = useMonitor((s) => s.addCollection);
  const [meter, setMeter] = useState<MeterId>("METER 1");
  const [date, setDate] = useState("2026-09-08");
  const [time, setTime] = useState("12:00");
  const [raw, setRaw] = useState("");
  const [month, setMonth] = useState("");
  const [baseline, setBaseline] = useState("");
  const [extendedDays, setExtendedDays] = useState("");
  const [standardDays, setStandardDays] = useState("");
  const [bill, setBill] = useState("");
  const [payment, setPayment] = useState("");
  const [status, setStatus] = useState("EX");

  return (
    <div className="space-y-5">
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
        <h2 className="font-display text-2xl font-medium">Collection audit</h2>
        <p className="mt-1 text-sm text-muted">Record the official reading. Billed units are derived from the pro-rata calculation and the billing history row is generated from this entry.</p>
        <form
          className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!date || !time || raw === "") return;
            const inferredMonth = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
            addCollection({
              meter,
              date,
              time,
              rawReading: Number(raw),
              previousBaseline: baseline === "" ? 0 : Number(baseline),
              month: month || inferredMonth,
              extendedDays: extendedDays === "" ? undefined : Number(extendedDays),
              standardDays: standardDays === "" ? undefined : Number(standardDays),
              status: status || "EX",
              bill: bill === "" ? 0 : Number(bill),
              payment: payment === "" ? 0 : Number(payment),
            });
            setRaw("");
            setBill("");
            setPayment("");
          }}
        >
          <div><Label htmlFor="col-meter">Meter</Label><select id="col-meter" value={meter} onChange={(e) => setMeter(e.target.value as MeterId)} className="mt-1 h-11 w-full rounded-md border border-border bg-elevated px-3 text-sm"><option>METER 1</option><option>METER 2</option></select></div>
          <div><Label htmlFor="col-date">Date</Label><Input id="col-date" type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label htmlFor="col-time">Time</Label><Input id="col-time" type="time" className="mt-1" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          <div><Label htmlFor="col-raw">Raw reading</Label><Input id="col-raw" type="number" step="0.01" className="mt-1" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
          <div><Label htmlFor="col-month">Billing month</Label><Input id="col-month" className="mt-1" placeholder="auto" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <div><Label htmlFor="col-base">Previous baseline</Label><Input id="col-base" type="number" step="0.01" className="mt-1" placeholder="auto" value={baseline} onChange={(e) => setBaseline(e.target.value)} /></div>
          <div><Label htmlFor="col-ext">Extended days</Label><Input id="col-ext" type="number" step="1" className="mt-1" placeholder="30" value={extendedDays} onChange={(e) => setExtendedDays(e.target.value)} /></div>
          <div><Label htmlFor="col-std">Standard days</Label><Input id="col-std" type="number" step="1" className="mt-1" placeholder="30" value={standardDays} onChange={(e) => setStandardDays(e.target.value)} /></div>
          <div><Label htmlFor="col-status">Status</Label><Input id="col-status" className="mt-1" value={status} onChange={(e) => setStatus(e.target.value.toUpperCase())} /></div>
          <div><Label htmlFor="col-bill">Official bill</Label><Input id="col-bill" type="number" step="1" className="mt-1" placeholder="optional" value={bill} onChange={(e) => setBill(e.target.value)} /></div>
          <div><Label htmlFor="col-paid">Paid</Label><Input id="col-paid" type="number" step="1" className="mt-1" placeholder="optional" value={payment} onChange={(e) => setPayment(e.target.value)} /></div>
          <div className="flex items-end"><Button type="submit">Save collection</Button></div>
        </form>
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
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                  <div><dt className="text-xs text-muted">Baseline</dt><dd className="tabular-nums">{units(c.previousBaseline)}</dd></div>
                  <div><dt className="text-xs text-muted">Raw</dt><dd className="tabular-nums">{units(c.rawReading)}</dd></div>
                  <div><dt className="text-xs text-muted">Actual units</dt><dd className="tabular-nums">{units(audit.actualUnits)}</dd></div>
                  <div><dt className="text-xs text-muted">Billed ({audit.standardDays}d)</dt><dd className="font-medium tabular-nums">{units(audit.billedUnits)}</dd></div>
                  <div><dt className="text-xs text-muted">Carry-forward</dt><dd className="tabular-nums">{units(audit.carryForward)}</dd></div>
                  <div><dt className="text-xs text-muted">Official bill</dt><dd className="tabular-nums">{money(c.bill || 0)}</dd></div>
                </dl>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
