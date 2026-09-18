import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { calculateProRata } from "@/lib/engine/bill";
import { addMonth, billingPeriodLengthDays, formatBillingMonth, money, units } from "@/lib/engine/time";
import { applyCarryForward, interpolatedReadingsAt } from "@/lib/engine/readings";
import { useMonitor } from "@/store/monitor";
import type { Collection, HistoryRow, MeterId } from "@/lib/engine/types";

const DAY_MS = 86400000;

function localDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time || "00:00"}:00`);
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function historyMonthKey(month: string): number | null {
  const match = month.trim().match(/^([A-Za-z]{3,9})\s+(\d{2}|\d{4})$/);
  if (!match) return null;
  const index = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].slice(0, 3).toLowerCase());
  if (index < 0) return null;
  const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
  return year * 12 + index;
}

// Rebuilds the exact billing-period-end boundary (Date) that a saved
// collection's "month" label refers to, so the boundary reading can be
// looked up in the raw readings log for carry-forward purposes.
function billingMonthEndBoundary(month: string, gs: { billingDay: number; billingHour: number; billingMinute: number }): Date | null {
  const match = month.trim().match(/^([A-Za-z]{3,9})\s+(\d{2}|\d{4})$/);
  if (!match) return null;
  const index = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].slice(0, 3).toLowerCase());
  if (index < 0) return null;
  const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
  return new Date(year, index, gs.billingDay, gs.billingHour, gs.billingMinute, 0, 0);
}

function HistoryTable({ title, rows }: { title: string; rows: HistoryRow[] }) {
  const sorted = [...rows].sort((a, b) => (historyMonthKey(b.month) ?? 0) - (historyMonthKey(a.month) ?? 0));
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-medium">{title}</h3>
        <span className="shrink-0 text-xs text-muted">{sorted.length} periods</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th className="pb-2 pr-3 font-medium">Month</th>
              <th className="pb-2 px-2 text-center font-medium">Status</th>
              <th className="pb-2 px-2 text-right font-medium">Billed units</th>
              <th className="pb-2 px-2 text-right font-medium">Reading</th>
              <th className="pb-2 pl-2 text-right font-medium">Bill</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2.5 pr-3">{row.month}</td>
                <td className="py-2.5 px-2 text-center text-xs text-muted">{row.status}</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{units(row.units, 0)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{row.reading == null ? "—" : units(row.reading, 2)}</td>
                <td className="py-2.5 pl-2 text-right tabular-nums">{money(row.bill)}</td>
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
  const general = useMonitor((s) => s.general);
  const rawReadings = useMonitor((s) => s.readings);
  const addCollection = useMonitor((s) => s.addCollection);
  const updateCollection = useMonitor((s) => s.updateCollection);
  const deleteCollection = useMonitor((s) => s.deleteCollection);

  const now = new Date();
  const [meter, setMeter] = useState<MeterId>("METER 1");
  const [date, setDate] = useState(ymd(now));
  const [time, setTime] = useState(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState("EX");
  const [bill, setBill] = useState("");
  const [payment, setPayment] = useState("");
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [roundUpInterval, setRoundUpInterval] = useState(false);

  // Sorted + carry-forward-filled readings log, used to look up the actual
  // logged meter reading at a billing period's end boundary (for carry-forward),
  // rather than relying on whatever value happened to be collected that day.
  const carriedReadings = useMemo(
    () => applyCarryForward([...rawReadings].sort((a, b) => a.datetime - b.datetime)),
    [rawReadings],
  );

  const calculated = useMemo(() => {
    const current = localDateTime(date, time);
    const validCurrent = Number.isFinite(current.getTime());

    // A collection belongs to the calendar month in which the bill is being
    // collected. The configured billing boundary inside that month is the
    // period end; the immediately preceding boundary starts the consumption
    // interval used for pro-rata.
    const periodEnd = validCurrent
      ? new Date(current.getFullYear(), current.getMonth(), general.billingDay, general.billingHour, general.billingMinute, 0, 0)
      : null;
    const periodStart = periodEnd
      ? new Date(periodEnd.getTime())
      : null;

    if (periodStart) {
      periodStart.setMonth(periodStart.getMonth() - 1);
    }

    const month = periodEnd ? formatBillingMonth(periodEnd) : "";
    const monthKey = historyMonthKey(month);
    const previousMonthKey = monthKey == null ? null : monthKey - 1;

    // A collection is valid only when the immediately preceding bill exists.
    // Never fall back to an older bill or another collection.
    const previousHistory = previousMonthKey == null
      ? undefined
      : history
          .filter((row) => row.meter === meter && historyMonthKey(row.month) === previousMonthKey)
          .sort((a, b) => Number(b.reading ?? -Infinity) - Number(a.reading ?? -Infinity))[0];

    const previousReading = previousHistory?.reading;
    const hasPreviousReading = previousReading != null && Number.isFinite(Number(previousReading));
    const standardDays = periodEnd ? billingPeriodLengthDays(periodEnd) : 0;
    const rawExtendedDays = periodStart && validCurrent ? (current.getTime() - periodStart.getTime()) / DAY_MS : 0;
    const extendedDays = roundUpInterval && rawExtendedDays > 0 ? Math.ceil(rawExtendedDays) : rawExtendedDays;
    const audit = hasPreviousReading && Number.isFinite(Number(raw))
      ? calculateProRata(Number(previousReading), Number(raw), extendedDays, standardDays)
      : null;

    return {
      current,
      periodStart,
      periodEnd,
      month,
      previousHistory,
      previousReading: hasPreviousReading ? Number(previousReading) : null,
      standardDays,
      extendedDays,
      audit,
      hasPreviousReading,
    };
  }, [date, time, meter, raw, history, general.billingDay, general.billingHour, general.billingMinute, roundUpInterval]);

  const readingEntered = raw.trim() !== "" && Number.isFinite(Number(raw));
  const readingNonNegative = readingEntered && Number(raw) >= 0;
  const saveReady = calculated.hasPreviousReading && readingNonNegative && calculated.audit != null;

  function openAdd() {
    const current = new Date();
    setEditingId(null);
    setMeter("METER 1");
    setDate(ymd(current));
    setTime(`${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}`);
    setRaw("");
    setStatus("EX");
    setBill("");
    setPayment("");
    setRoundUpInterval(false);
    setCollectionOpen(true);
  }

  function openEdit(collection: Collection) {
    setEditingId(collection.id);
    setMeter(collection.meter);
    setDate(collection.date);
    setTime(collection.time);
    setRaw(String(collection.rawReading));
    setStatus(collection.status || "EX");
    setBill(collection.bill == null ? "" : String(collection.bill));
    setPayment(collection.payment == null ? "" : String(collection.payment));
    setRoundUpInterval(false);
    setCollectionOpen(true);
  }

  function closeEditor() {
    setCollectionOpen(false);
    setEditingId(null);
  }

  function saveCollection(event: FormEvent) {
    event.preventDefault();
    if (!saveReady || !calculated.audit || !calculated.month) return;

    const data = {
      meter,
      date,
      time,
      rawReading: Number(raw),
      previousBaseline: calculated.audit.baseline,
      month: calculated.month,
      extendedDays: calculated.audit.extendedDays,
      standardDays: calculated.audit.standardDays,
      status: status.trim().toUpperCase() || "EX",
      bill: bill === "" ? 0 : Number(bill),
      payment: payment === "" ? 0 : Number(payment),
    };

    if (editingId) updateCollection(editingId, data);
    else addCollection(data);
    closeEditor();
  }

  const validationMessage = !calculated.hasPreviousReading
    ? `Cannot save ${calculated.month || "this month"}: the ${calculated.previousHistory?.month || "previous month's"} Bill History row has no billing reading.`
    : !readingEntered
      ? "Enter the meter reading collected at the date and time above."
      : !readingNonNegative
        ? "The meter reading must be zero or greater."
        : !calculated.audit
          ? "The collected reading must be equal to or greater than the previous billing reading."
          : "Ready to save.";

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Billing history</p>
            <h2 className="mt-1 font-display text-2xl font-medium">Bill collection</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">Enter the physical meter reading from the collection. The app uses the immediately previous month's billed reading as the pro-rata baseline.</p>
          </div>
          <Button onClick={openAdd}>Add collection</Button>
        </div>
      </section>

      {collectionOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-elevated shadow-border">
            <div className="border-b border-border p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">{editingId ? "Edit record" : "New record"}</p>
                  <h2 className="mt-1 font-display text-2xl font-medium">Bill collection</h2>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={closeEditor}>Close</Button>
              </div>
            </div>

            <form onSubmit={saveCollection} className="space-y-6 p-5 sm:p-6">
              <section className="rounded-xl border border-border p-4 sm:p-5">
                <div className="mb-4">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">1 · Collection</p>
                  <p className="mt-1 text-sm text-muted">When and from which meter was the physical reading collected?</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="collection-meter">Meter</Label>
                    <select id="collection-meter" value={meter} onChange={(event) => setMeter(event.target.value as MeterId)} className="mt-1 h-11 w-full rounded-md border border-border bg-elevated px-3 text-sm">
                      <option>METER 1</option>
                      <option>METER 2</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="collection-date">Collection date</Label>
                    <Input id="collection-date" type="date" className="mt-1" value={date} onChange={(event) => setDate(event.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="collection-time">Collection time</Label>
                    <Input id="collection-time" type="time" className="mt-1" value={time} onChange={(event) => setTime(event.target.value)} />
                  </div>
                  <div className="sm:col-span-3">
                    <Label htmlFor="collection-reading">Meter reading at collection</Label>
                    <Input id="collection-reading" type="number" step="0.01" min="0" className="mt-1 text-lg" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="e.g. 2670.42" autoFocus />
                    <p className="mt-1.5 text-xs text-muted">This is the actual meter reading observed at the collection date/time — not the previous bill's billing reading.</p>
                  </div>
                </div>
              </section>

              <section className={`rounded-xl border p-4 sm:p-5 ${calculated.hasPreviousReading ? "border-border" : "border-red-500/50"}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">2 · Previous bill</p>
                    <p className="mt-1 text-sm text-muted">Required reference for this month's pro-rata calculation.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted">{calculated.previousHistory?.month || "Previous month"}</p>
                    <p className="mt-0.5 font-display text-2xl font-medium tabular-nums">{calculated.previousReading == null ? "—" : units(calculated.previousReading)}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-lg bg-black/10 p-3 text-sm">
                  {calculated.hasPreviousReading ? (
                    <>Billing reading loaded from the <strong>{calculated.previousHistory?.month}</strong> row in Bill History.</>
                  ) : (
                    <>The <strong>{calculated.previousHistory?.month || "previous month"}</strong> billing reading is missing. This collection cannot be saved until that reading is present.</>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-border p-4 sm:p-5">
                <div className="mb-4">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">3 · Pro-rata calculation</p>
                  <p className="mt-1 text-sm text-muted">The collection time determines how many days of actual consumption are being represented.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-black/10 p-3"><p className="text-xs text-muted">Billing period</p><p className="mt-1 font-medium">{calculated.month || "—"}</p></div>
                  <div className="rounded-lg bg-black/10 p-3">
                    <p className="text-xs text-muted">Actual interval</p>
                    <p className="mt-1 font-medium tabular-nums">{calculated.extendedDays > 0 ? `${calculated.extendedDays.toFixed(2)} days` : "—"}</p>
                    <label className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                      <input type="checkbox" checked={roundUpInterval} onChange={(event) => setRoundUpInterval(event.target.checked)} className="size-3.5 rounded border-border" />
                      Round up to whole days
                    </label>
                  </div>
                  <div className="rounded-lg bg-black/10 p-3"><p className="text-xs text-muted">Standard cycle</p><p className="mt-1 font-medium tabular-nums">{calculated.standardDays > 0 ? `${calculated.standardDays.toFixed(0)} days` : "—"}</p></div>
                  <div className="rounded-lg bg-black/10 p-3"><p className="text-xs text-muted">Actual units</p><p className="mt-1 font-medium tabular-nums">{calculated.audit ? units(calculated.audit.actualUnits) : "—"}</p></div>
                </div>
                {calculated.audit ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div><p className="text-xs text-muted">Daily average</p><p className="mt-1 tabular-nums">{units(calculated.audit.dailyAverage)} kWh/day</p></div>
                    <div><p className="text-xs text-muted">Billed units</p><p className="mt-1 font-medium tabular-nums">{units(calculated.audit.billedUnits, 0)} kWh</p></div>
                    <div><p className="text-xs text-muted">New billing reading</p><p className="mt-1 font-medium tabular-nums">{units(calculated.audit.adjustedPresent)}</p></div>
                  </div>
                ) : null}
              </section>

              <section className="rounded-xl border border-border p-4 sm:p-5">
                <div className="mb-4">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">4 · Bill record</p>
                  <p className="mt-1 text-sm text-muted">Optional details copied from the official bill.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div><Label htmlFor="collection-status">Status</Label><Input id="collection-status" className="mt-1" value={status} onChange={(event) => setStatus(event.target.value.toUpperCase())} /></div>
                  <div><Label htmlFor="collection-bill">Official bill</Label><Input id="collection-bill" type="number" step="1" min="0" className="mt-1" value={bill} onChange={(event) => setBill(event.target.value)} placeholder="Optional" /></div>
                  <div><Label htmlFor="collection-paid">Paid</Label><Input id="collection-paid" type="number" step="1" min="0" className="mt-1" value={payment} onChange={(event) => setPayment(event.target.value)} placeholder="Optional" /></div>
                </div>
              </section>

              <div className={`rounded-xl p-4 text-sm ${saveReady ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                <p className="font-medium">{saveReady ? "Ready to save" : "Cannot save yet"}</p>
                <p className="mt-1 text-muted">{validationMessage}</p>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
                <Button type="button" variant="ghost" onClick={closeEditor}>Cancel</Button>
                <Button type="submit" disabled={!saveReady}>{editingId ? "Save changes" : "Save collection"}</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div>
          <h2 className="font-display text-2xl font-medium">Bill history</h2>
          <p className="mt-1 text-sm text-muted">The Reading column is the billing reading produced by the pro-rata adjustment and becomes the reference for the following month.</p>
        </div>
        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <HistoryTable title="Meter 1" rows={history.filter((row) => row.meter === "METER 1")} />
          <HistoryTable title="Meter 2" rows={history.filter((row) => row.meter === "METER 2")} />
        </div>
      </section>

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="mb-4">
          <h2 className="font-display text-2xl font-medium">Collection data</h2>
          <p className="mt-1 text-sm text-muted">Audit trail for the physical reading, pro-rata adjustment, and resulting billing reading.</p>
        </div>
        <div className="space-y-3">
          {collections.length === 0 ? <p className="text-sm text-muted">No collection entries yet.</p> : [...collections].sort((a, b) => localDateTime(b.date, b.time).getTime() - localDateTime(a.date, a.time).getTime()).map((collection) => {
            const audit = calculateProRata(collection.previousBaseline, collection.rawReading, collection.extendedDays || 0, collection.standardDays || 0);
            const boundary = billingMonthEndBoundary(collection.month, general);
            const boundaryAt = boundary ? interpolatedReadingsAt(carriedReadings, boundary) : null;
            const boundaryReading = boundaryAt ? (collection.meter === "METER 1" ? boundaryAt.newReading : boundaryAt.oldReading) : null;
            const carryForward = audit && boundaryReading != null && Number.isFinite(Number(boundaryReading))
              ? Number(boundaryReading) - audit.adjustedPresent
              : audit?.carryForward ?? null;
            return (
              <article key={collection.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="font-medium">{collection.month} — {collection.meter}</h3><p className="text-xs text-muted">Collected {collection.date} at {collection.time}</p></div>
                  <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => openEdit(collection)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Delete ${collection.month} — ${collection.meter}?`)) deleteCollection(collection.id); }}>Delete</Button></div>
                </div>
                {audit ? (
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-7">
                    <div><dt className="text-xs text-muted">Previous billed</dt><dd className="tabular-nums">{units(audit.baseline)}</dd></div>
                    <div><dt className="text-xs text-muted">Collected reading</dt><dd className="tabular-nums">{units(audit.present)}</dd></div>
                    <div><dt className="text-xs text-muted">Actual units</dt><dd className="tabular-nums">{units(audit.actualUnits)}</dd></div>
                    <div><dt className="text-xs text-muted">Actual interval</dt><dd className="tabular-nums">{audit.extendedDays.toFixed(2)}d</dd></div>
                    <div><dt className="text-xs text-muted">Billed units</dt><dd className="font-medium tabular-nums">{units(audit.billedUnits, 0)}</dd></div>
                    <div><dt className="text-xs text-muted">Billing reading</dt><dd className="font-medium tabular-nums">{units(audit.adjustedPresent)}</dd></div>
                    <div><dt className="text-xs text-muted">Carry-forward</dt><dd className="tabular-nums">{units(carryForward)}</dd></div>
                  </dl>
                ) : <p className="mt-3 text-sm text-muted">This record cannot currently be recalculated because its stored pro-rata interval or baseline is invalid.</p>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
