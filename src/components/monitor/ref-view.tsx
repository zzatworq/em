import { useMonitor } from "@/store/monitor";

function Formula({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-background px-4 py-3 font-mono text-sm leading-7 text-foreground">{children}</div>;
}

function Section({ title, source, children }: { title: string; source?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-display text-xl font-medium">{title}</h2>{source ? <code className="text-xs text-subtle">{source}</code> : null}</div>{children}</section>;
}

function Row({ name, formula, note }: { name: string; formula: string; note?: string }) {
  return <div className="border-t border-border py-4 first:border-t-0"><p className="font-medium">{name}</p><Formula>{formula}</Formula>{note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}</div>;
}

export function RefView() {
  const gs = useMonitor((s) => s.general);
  const t1 = useMonitor((s) => s.tariff1);
  const t2 = useMonitor((s) => s.tariff2);
  const slabs = (t: typeof t1) => (t.consumerType === "Protected" ? t.protectedSlabs : t.slabs);

  return <div className="space-y-5">
    <section className="rounded-2xl bg-foreground p-5 text-background shadow-border sm:p-6">
      <p className="text-xs font-medium uppercase tracking-wider opacity-60">Calculation reference</p>
      <h1 className="mt-1 font-display text-3xl font-medium tracking-tight">Ref</h1>
      <p className="mt-2 max-w-3xl text-sm opacity-75">Mathematical reference for the formulas currently used by Electricity Monitor. This page is documentation of the calculation engine, not a second calculation engine.</p>
    </section>

    <Section title="1. Reading normalization" source="engine/readings.ts">
      <Row name="Carry-forward" formula="newReadingₜ = newInputₜ, if newInputₜ exists; otherwise newReadingₜ = newReadingₜ₋₁\noldReadingₜ = oldInputₜ, if oldInputₜ exists; otherwise oldReadingₜ = oldReadingₜ₋₁" note="A blank meter entry therefore carries the previous reading forward." />
      <Row name="Consumption difference" formula="Δ = endReading − startReading\nif Δ < 0 → unavailable" />
      <Row name="Combined known consumption" formula="Total = Δ₁ + Δ₂, treating a missing meter difference as 0\nif both differences are missing → unavailable" />
    </Section>

    <Section title="2. Reading interpolation" source="engine/readings.ts + engine/time.ts">
      <Row name="Profile-weighted interpolation" formula="fraction = W(before, target) / W(before, after)\nestimatedReading(target) = beforeReading + (afterReading − beforeReading) × fraction" note="W(a,b) is the sum of hourly estimation-profile weights over the interval. If the profile has no usable weight, the engine falls back to ordinary elapsed-time interpolation." />
      <Row name="Profile weight" formula="W(a,b) = Σ [ profileWeight(hour) × minutes spent in that hour ]" />
    </Section>

    <Section title="3. Billing period and daily time model" source="engine/time.ts">
      <Row name="Billing-period start" formula="Start = (year, month, billingDay, billingHour, billingMinute)\nif datetime < Start → use the same boundary in the previous month" note={`Current settings: day ${gs.billingDay}, ${String(gs.billingHour).padStart(2, "0")}:${String(gs.billingMinute).padStart(2, "0")}.`} />
      <Row name="Next billing boundary" formula="End = Start + 1 calendar month, with the day clamped to the target month's last day" />
      <Row name="Billing-period length" formula="Days = (End − Start) / 86,400,000" />
      <Row name="Daily chart day" formula={`Day start = local date at ${String(gs.billingHour).padStart(2, "0")}:${String(gs.billingMinute).padStart(2, "0")}\nDay end = Day start + 1 day`} />
      <Row name="Billing progress" formula="Progress = elapsedDays / totalDays × 100%\nelapsedDays = clamp((Now − Start) / 1 day, 0, totalDays)" />
    </Section>

    <Section title="4. Daily consumption" source="engine/dashboard.ts">
      <Row name="Completed day" formula="Day consumption = estimatedReading(end) − estimatedReading(start)" />
      <Row name="Current/incomplete day projection" formula="fullDayEstimate = observedConsumption × fullProfileWeight / elapsedProfileWeight" note="The current day is expanded to a full day using the estimation profile rather than assuming uniform consumption across the clock." />
      <Row name="Daily total" formula="Daily total = Meter 1 daily consumption + Meter 2 daily consumption" />
    </Section>

    <Section title="5. Daily average and goal pace" source="engine/dashboard.ts">
      <Row name="Elapsed days" formula="Elapsed = clamp((Now − BillingStart) / 1 day, 0, PeriodDays)" />
      <Row name="Daily average" formula="Daily average = Current consumption / Elapsed days" />
      <Row name="Target daily average" formula="Target daily average = Goal / PeriodDays" />
      <Row name="Remaining to goal" formula="Remaining = Goal − Current consumption" />
      <Row name="Daily allowance" formula="Required daily average = Remaining / Remaining days\nonly defined when Remaining > 0 and Remaining days > 0" />
      <Row name="Goal status" formula="Over goal ⇔ Remaining < 0" />
    </Section>

    <Section title="6. Active days per meter" source="engine/dashboard.ts">
      <Row name="Meter activity" formula="If ΔMeter 1 > 0 and ΔMeter 2 ≤ 0 → Meter 1 owns the interval\nIf ΔMeter 2 > 0 and ΔMeter 1 ≤ 0 → Meter 2 owns the interval\nIf both increase → split interval proportionally by their increases\nIf neither increases → continue the last known active meter" note="This prevents solar/zero-load intervals from incorrectly erasing active time." />
      <Row name="Active days" formula="Active days = Σ active interval milliseconds / 86,400,000" />
      <Row name="Meter daily average" formula="Meter average = Meter consumption / Meter active days" />
    </Section>

    <Section title="7. Month projection" source="engine/dashboard.ts">
      <Row name="Completed consumption" formula="Completed = Σ consumption of completed billing days" />
      <Row name="Current-day full-day estimate" formula="Partial full-day = Partial-day consumption × Full profile weight / Elapsed profile weight\nif elapsed fraction < 10%: use max(partial-day consumption, completed-day average)" />
      <Row name="Prior-period daily rate" formula="Prior daily rate = Prior-period consumption / Prior-period days" />
      <Row name="Blended daily rate" formula="Blended rate = (Observed consumption + Prior daily rate × 3) / (Observed days + 3)" note="The engine uses a 3-day prior-period shrinkage weight when a prior-period daily rate is available." />
      <Row name="Future consumption" formula="Future = Blended daily rate × Future days" />
      <Row name="Projected meter consumption" formula="Projected meter = Completed + Current-day full-day estimate + Future" />
      <Row name="Projected total" formula="Projected total = Projected Meter 1 + Projected Meter 2" />
    </Section>

    <Section title="8. Pro-rata billing adjustment" source="engine/bill.ts">
      <Row name="Actual units" formula="Actual units = Current reading − Previous billed reading" />
      <Row name="Daily consumption" formula="Daily consumption = Actual units / Actual billing interval" />
      <Row name="Adjusted billed units" formula="Adjusted billed units = floor(Daily consumption × Standard cycle)" />
      <Row name="Adjusted current reading" formula="Adjusted current reading = Previous billed reading + Adjusted billed units" />
      <Row name="Carry-forward units" formula="Carry-forward = Actual units − Adjusted billed units" />
    </Section>

    <Section title="9. Meter bill calculation" source="engine/bill.ts">
      <Row name="Applicable slab" formula="Select the tariff slab containing the meter's total units" note="Protected tariffs use protectedSlabs; otherwise the normal slabs are used." />
      <Row name="All-units-at-applicable-rate" formula="Energy = Units × Applicable slab rate" />
      <Row name="Progressive mode" formula="Energy = Σ (units charged within each slab × that slab's rate)" />
      <Row name="Per-unit adjustments" formula="Adjustment = Units × (FCA + QTA + FC + NJ)" />
      <Row name="Taxable base" formula="Taxable base = Energy + Fixed charge + Per-unit adjustments + Other fixed" />
      <Row name="Electricity duty" formula="Duty = Taxable base × ED / 100" />
      <Row name="GST" formula="GST = (Taxable base + Duty) × GST% / 100" />
      <Row name="Final meter bill" formula="Bill = Energy + Fixed charge + Per-unit adjustments + Other fixed + Duty + GST + TV fee" />
      <Row name="Combined bill" formula="Combined bill = Meter 1 bill + Meter 2 bill" note="The two meters are always billed independently; their units are not combined before slab selection." />
    </Section>

    <Section title="10. Current tariff inputs" source="settings">
      <div className="grid gap-4 sm:grid-cols-2">
        {[ ["Meter 1", t1], ["Meter 2", t2] ].map(([name, t]) => <div key={name as string} className="rounded-xl border border-border p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-medium">{name as string}</h3><span className="text-xs text-muted">{(t as typeof t1).slabMode}</span></div><p className="mt-1 text-sm text-muted">{(t as typeof t1).consumerType}</p><div className="mt-3 space-y-2">{slabs(t as typeof t1).map((s) => <div key={`${s.min}-${s.max}`} className="flex justify-between gap-3 border-t border-border pt-2 text-sm"><span>{s.max === Infinity ? `>${s.min - 1}` : `${s.min}–${s.max}`} units</span><span className="font-mono">Rs {Number(s.rate).toFixed(2)} · fixed Rs {Number(s.fixed).toFixed(2)}</span></div>)}</div><div className="mt-3 border-t border-border pt-3 text-xs text-muted">ED {(t as typeof t1).adjustments.ED}% · GST {(t as typeof t1).adjustments.GST}% · TV Rs {Number((t as typeof t1).adjustments.TV).toFixed(2)} · FCA {(t as typeof t1).adjustments.FCA} · QTA {(t as typeof t1).adjustments.QTA} · FC {(t as typeof t1).adjustments.FC} · NJ {(t as typeof t1).adjustments.NJ}</div></div> )}
      </div>
    </Section>

    <Section title="11. Display calculations" source="summary-view.tsx">
      <Row name="Effective projected cost per kWh" formula="Effective rate = Displayed projected bill / Projected consumption" />
      <Row name="Meter split percentage" formula="Meter 1 share = Meter 1 billed consumption / (Meter 1 billed + Meter 2 billed) × 100%\nMeter 2 share = Meter 2 billed consumption / (Meter 1 billed + Meter 2 billed) × 100%" />
      <Row name="Total consumption display" formula="Displayed total = Meter 1 total consumption + Meter 2 total consumption" />
      <Row name="Consumption decomposition" formula="Total consumption = Billing-period consumption + Carry-forward units" />
    </Section>

    <Section title="12. Important calculation rules" source="current engine">
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted"><li>Blank readings carry forward the previous reading.</li><li>Negative meter differences are treated as unavailable rather than consumption.</li><li>Meter bills are calculated independently before being added together.</li><li>Only the observed/projected consumption is used for the bill; the two meter registers are never combined for slab selection.</li><li>Current-day projections use the configured estimation profile.</li><li>Historical months are calculated through their full selected billing period rather than using the current clock.</li><li>This reference should be updated whenever a formula in the calculation engine changes.</li></ul>
    </Section>
  </div>;
}
