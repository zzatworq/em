import { UsageChart } from "@/components/charts/usage-chart";
import { useDashboard, useMonitor } from "@/store/monitor";
import { money, units } from "@/lib/engine/time";
import type { DailyPoint } from "@/lib/engine/types";

function Stat({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-medium tabular-nums text-foreground">
        {value}{unit ? <span className="ml-1 text-sm font-normal text-subtle">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

function MeterCard({
  title,
  tone,
  total,
  billing,
  carry,
  average,
  activeDays,
  bill,
  current,
  initial,
}: {
  title: string;
  tone: "meter1" | "meter2";
  total: number;
  billing: number | "";
  carry: number;
  average: number | "";
  activeDays: number;
  bill: number;
  current: number | null;
  initial: number | null;
}) {
  return (
    <article className="rounded-xl bg-elevated p-5 shadow-border">
      <div className={`h-1 w-12 rounded-full ${tone === "meter1" ? "bg-meter1" : "bg-meter2"}`} />
      <p className="mt-3 text-xs font-medium uppercase tracking-wider text-muted">{title}</p>
      <p className="mt-1 font-display text-3xl font-medium tabular-nums">
        {units(total)} <span className="text-base text-subtle">kWh</span>
      </p>
      <p className="mt-1 font-mono text-xs text-subtle tabular-nums">
        {units(billing)} + {units(carry)}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
        <div>
          <dt className="text-xs text-muted">Average</dt>
          <dd className="tabular-nums">{units(average)} <span className="text-xs font-normal text-subtle">kWh/d</span></dd><p className="mt-0.5 text-[11px] text-subtle">{units(activeDays, 1)} active days</p>
        </div>
        <div>
          <dt className="text-xs text-muted">Bill so far</dt>
          <dd className="tabular-nums">{money(bill)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Current</dt>
          <dd className="tabular-nums">{units(current)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Period start</dt>
          <dd className="tabular-nums">{units(initial)}</dd>
        </div>
      </dl>
    </article>
  );
}

export function SummaryView() {
  const { dashboard } = useDashboard();
  const setHourlyDay = useMonitor((s) => s.setHourlyDay);
  const hourlyDay = useMonitor((s) => s.hourlyDay);
  const hourlyOverride = useMonitor((s) => s.hourlyOverride);

  if (dashboard.empty) {
    return (
      <div className="rounded-2xl bg-elevated p-10 text-center shadow-border">
        <p className="font-display text-xl">{dashboard.message}</p>
      </div>
    );
  }

  const d = dashboard;
  const hourly = hourlyOverride ?? d.hourly;
  const pace = d.goalPace;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-3xl font-medium tracking-tight text-balance">{d.billingMonth}</h2>
            <p className="mt-1 text-sm text-muted">
              {d.billingStart} → {d.billingEnd}
            </p>
            <p className="mt-1 text-xs text-subtle tabular-nums">Elapsed {units(d.elapsedDays, 1)} days</p>
          </div>
          <p className="text-sm font-medium tabular-nums text-muted">
            {Number(d.billingProgress).toFixed(0)}% of period
          </p>
        </div>
        <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-[var(--motion-slow)]"
            style={{ width: `${Math.min(100, Number(d.billingProgress)).toFixed(2)}%` }}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-2xl bg-elevated p-5 shadow-border lg:col-span-2 sm:p-6">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">Total usage</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
            <p className="font-display text-5xl font-medium tracking-tight tabular-nums sm:text-6xl">
              {units(d.isCurrentBillingMonth ? d.projectedTotal : d.totalConsumptionCombined)}
              <span className="ml-2 text-lg font-normal text-subtle">kWh</span>
            </p>
            <div className="text-right">
              <p className="text-xs text-muted">{d.isCurrentBillingMonth ? "Projected bill" : "Calculated bill"}</p>
              <p className="font-display text-2xl tabular-nums">{money(d.projectedBillActualTotal)}</p>
            </div>
          </div>
          <p className="mt-2 font-mono text-xs text-subtle tabular-nums">
            {units(d.billingTotal)} + {units((d.carryForwardNew || 0) + (d.carryForwardOld || 0))}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-4">
            <Stat label="Last 24 h" value={units(d.last24Total)} unit="kWh" />
            <Stat label="Daily avg" value={units(pace.dailyAverage)} unit="kWh/d" />
            <Stat
              label="To goal"
              value={pace.remainingUnits > 0 ? units(pace.remainingUnits) : "Exceeded"}
              unit={pace.remainingUnits > 0 ? "kWh" : undefined}
            />
            <Stat
              label="Required daily"
              value={
                pace.requiredDailyAverage === ""
                  ? pace.overGoal
                    ? "Over"
                    : "—"
                  : units(pace.requiredDailyAverage)
              }
              unit={pace.requiredDailyAverage === "" ? undefined : "kWh/d"}
            />
          </div>
          <p className="mt-4 text-pretty text-sm text-muted">
            {pace.overGoal
              ? `Combined goal exceeded by ${units(Math.abs(pace.remainingUnits))} kWh.`
              : `Stay at or below ${pace.requiredDailyAverage === "" ? "0" : units(pace.requiredDailyAverage)} kWh/d to finish on target.`}
          </p>
          <div className="mt-5">
            <div className="mb-1.5 flex justify-between text-xs text-muted">
              <span>Meter 1 · {units(d.billingNew)} kWh</span>
              <span>Meter 2 · {units(d.billingOld)} kWh</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full">
              <div className="bg-meter1" style={{ width: `${d.meter1Share}%` }} />
              <div className="bg-meter2" style={{ width: `${d.meter2Share}%` }} />
            </div>
          </div>
        </section>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
          <MeterCard
            title="Meter 1"
            tone="meter1"
            total={d.totalConsumptionNew}
            billing={d.billingNew}
            carry={d.carryForwardNew}
            average={d.averageNew === "" ? "" : Number(d.averageNew)}
            activeDays={d.activeDaysNew}
            bill={d.currentBillNew}
            current={d.currentNew}
            initial={d.initialNew}
          />
          <MeterCard
            title="Meter 2"
            tone="meter2"
            total={d.totalConsumptionOld}
            billing={d.billingOld}
            carry={d.carryForwardOld}
            average={d.averageOld === "" ? "" : Number(d.averageOld)}
            activeDays={d.activeDaysOld}
            bill={d.currentBillOld}
            current={d.currentOld}
            initial={d.initialOld}
          />
        </div>
      </div>

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-medium">Daily consumption</h3>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-meter1" /> Meter 1</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-meter2" /> Meter 2</span>
          </div>
        </div>
        <UsageChart
          points={d.daily}
          onBarClick={(i) => {
            const point = d.daily[i] as DailyPoint | undefined;
            if (point) setHourlyDay(point.date);
          }}
        />
      </section>

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-display text-lg font-medium">Hourly consumption</h3>
          <select
            value={hourlyDay}
            onChange={(e) => setHourlyDay(e.target.value)}
            className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
          >
            {d.hourlyDays.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <UsageChart points={hourly} />
      </section>
    </div>
  );
}
