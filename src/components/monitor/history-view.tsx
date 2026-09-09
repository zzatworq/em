import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { money, units } from "@/lib/engine/time";
import { useMonitor } from "@/store/monitor";
import type { HistoryRow, MeterId } from "@/lib/engine/types";

function HistoryTable({ title, rows }: { title: string; rows: HistoryRow[] }) {
  return (
    <div>
      <h3 className="mb-3 font-medium">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th className="pb-2 font-medium">Month</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 text-right font-medium">Units</th>
              <th className="pb-2 text-right font-medium">Bill</th>
              <th className="pb-2 text-right font-medium">Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-2.5">{r.month}</td>
                <td className="py-2.5 text-muted">{r.status}</td>
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

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <h2 className="font-display text-2xl font-medium">Billing history</h2>
        <p className="mt-1 text-sm text-muted">Recorded units, bill and payment by meter.</p>
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <HistoryTable title="Meter 1" rows={history.filter((h) => h.meter === "METER 1")} />
          <HistoryTable title="Meter 2" rows={history.filter((h) => h.meter === "METER 2")} />
        </div>
      </section>

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <h2 className="font-display text-2xl font-medium">Log a collection</h2>
        <p className="mt-1 text-sm text-muted">
          Official reading near the 13th 5 PM cycle. Month and baseline can be left blank to auto-fill later.
        </p>
        <form
          className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!date || !time || raw === "") return;
            addCollection({
              meter,
              date,
              time,
              rawReading: Number(raw),
              previousBaseline: baseline === "" ? 0 : Number(baseline),
              month: month || "Sep 2026",
            });
            setRaw("");
          }}
        >
          <div>
            <Label htmlFor="col-meter">Meter</Label>
            <select
              id="col-meter"
              value={meter}
              onChange={(e) => setMeter(e.target.value as MeterId)}
              className="mt-1 h-11 w-full rounded-md border border-border bg-elevated px-3 text-sm"
            >
              <option>METER 1</option>
              <option>METER 2</option>
            </select>
          </div>
          <div>
            <Label htmlFor="col-date">Date</Label>
            <Input id="col-date" type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="col-time">Time</Label>
            <Input id="col-time" type="time" className="mt-1" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="col-raw">Raw reading</Label>
            <Input
              id="col-raw"
              type="number"
              step="0.01"
              className="mt-1"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="col-month">Month override</Label>
            <Input id="col-month" className="mt-1" placeholder="auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="col-base">Baseline override</Label>
            <Input
              id="col-base"
              type="number"
              step="0.01"
              className="mt-1"
              placeholder="auto"
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit">Save collection</Button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <h2 className="font-display text-2xl font-medium">Collection audit</h2>
        <div className="mt-4 space-y-3">
          {collections.map((c) => {
            const actual = c.rawReading - c.previousBaseline;
            const ext = Math.round(c.extendedDays || 30);
            const std = Math.round(c.standardDays || 30);
            const daily = ext > 0 ? actual / ext : 0;
            const billed = Math.floor(daily * std);
            const carry = actual - billed;
            return (
              <article key={c.id} className="rounded-xl border border-border p-4">
                <h3 className="font-medium">
                  {c.month} — {c.meter}
                </h3>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted">Collected</dt>
                    <dd>
                      {c.date} {c.time}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Baseline</dt>
                    <dd className="tabular-nums">{units(c.previousBaseline)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Raw</dt>
                    <dd className="tabular-nums">{units(c.rawReading)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Actual units</dt>
                    <dd className="tabular-nums">{units(actual)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Billed ({std}d)</dt>
                    <dd className="tabular-nums">{units(billed)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Carry-forward</dt>
                    <dd className="tabular-nums">{units(carry)}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
