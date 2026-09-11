import { useDashboard, useMonitor } from "@/store/monitor";
import { money, units } from "@/lib/engine/time";
import type { MeterBill, ProRata } from "@/lib/engine/types";

function BillBlock({ title, bill }: { title: string; bill: MeterBill }) {
  return (
    <article className="overflow-hidden rounded-xl border border-border">
      <header className="flex items-center justify-between bg-muted/50 px-4 py-3">
        <h3 className="font-medium">{title}</h3>
        <span className="text-sm tabular-nums text-muted">{units(bill.units)} kWh</span>
      </header>
      <ul>
        {bill.steps.map((step) => (
          <li
            key={step.label}
            className={`grid gap-1 border-t border-border px-4 py-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_auto] ${step.total ? "bg-muted/40 font-medium" : ""}`}
          >
            <span>{step.label}</span>
            <span className="font-mono text-xs text-muted sm:text-sm">{step.formula}</span>
            <span className="tabular-nums sm:text-right">{money(step.amount)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function ProBlock({ title, data }: { title: string; data: ProRata | null }) {
  if (!data) {
    return (
      <div>
        <h4 className="font-medium">{title}</h4>
        <p className="mt-1 text-sm text-muted">Insufficient baseline for this meter.</p>
      </div>
    );
  }
  const rows: Array<[string, keyof ProRata, string]> = [
    ["Previous billed baseline", "baseline", "kWh"],
    ["Present live reading", "present", "kWh"],
    ["Total actual units", "actualUnits", "kWh"],
    ["Extended interval", "extendedDays", "days"],
    ["Daily velocity", "dailyAverage", "kWh/d"],
    ["Standard cycle", "standardDays", "days"],
    ["Normalized billed units", "billedUnits", "kWh"],
    ["Adjusted present", "adjustedPresent", "kWh"],
    ["Carry-forward", "carryForward", "kWh"],
  ];
  return (
    <div>
      <h4 className="font-medium">{title}</h4>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rows.map(([label, key, unit]) => (
          <div key={key}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="tabular-nums">
              {units(data[key] as number)} {unit}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function BillView() {
  const { dashboard } = useDashboard();
  const assume5050 = useMonitor((s) => s.assume5050);
  const setAssume5050 = useMonitor((s) => s.setAssume5050);

  if (dashboard.empty) {
    return (
      <div className="rounded-2xl bg-elevated p-10 text-center shadow-border">
        <p className="text-muted">No bill estimate yet.</p>
      </div>
    );
  }

  const details = dashboard.isCurrentBillingMonth
    ? assume5050
      ? dashboard.projectedBillDetails
      : dashboard.projectedBillActualDetails
    : dashboard.currentBillDetails;
  const total = (details.meter1.total || 0) + (details.meter2.total || 0);
  const kwh = dashboard.isCurrentBillingMonth
    ? Number(dashboard.projectedTotal || 0)
    : Number(dashboard.billingTotal || 0);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-medium">
              {dashboard.isCurrentBillingMonth ? "Projected month bill" : "Billing month calculation"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {dashboard.isCurrentBillingMonth ? "Projected" : "Recorded"} consumption{" "}
              <strong className="text-foreground tabular-nums">{units(kwh)} kWh</strong>
            </p>
          </div>
          {dashboard.isCurrentBillingMonth ? (
            <label className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
              <input
                type="checkbox"
                checked={assume5050}
                onChange={(e) => setAssume5050(e.target.checked)}
                className="size-4 accent-foreground"
              />
              Assume 50/50 split
            </label>
          ) : null}
        </div>
        <div className="mt-6 space-y-4">
          <BillBlock title="Meter 1" bill={details.meter1} />
          <BillBlock title="Meter 2" bill={details.meter2} />
        </div>
        <div className="mt-6 flex items-center justify-between rounded-xl bg-foreground px-5 py-4 text-background">
          <span className="font-medium">Combined</span>
          <span className="font-display text-2xl tabular-nums">{money(total)}</span>
        </div>
        {assume5050 && dashboard.isCurrentBillingMonth ? (
          <p className="mt-3 text-xs text-muted">Units already used stay with their actual meter; only the remaining projected units for the rest of the month are split evenly.</p>
        ) : null}
        <p className="mt-3 text-xs text-subtle">
          Each meter is billed independently on the A-1 residential tariff. Combined is the sum of the two bills.
        </p>
      </section>

      <details className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <summary className="cursor-pointer font-display text-lg font-medium">Pro-rata normalization</summary>
        <p className="mt-3 text-sm text-muted">
          Billed units = floor((Present − Baseline) ÷ Extended days × Standard days). Audit view only.
        </p>
        <div className="mt-5 space-y-6">
          <ProBlock title="Meter 1" data={dashboard.proRata.meter1} />
          <ProBlock title="Meter 2" data={dashboard.proRata.meter2} />
        </div>
      </details>
    </div>
  );
}
