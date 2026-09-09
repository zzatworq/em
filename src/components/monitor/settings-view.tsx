import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { GeneralSettings, Tariff } from "@/lib/engine/types";
import { useMonitor } from "@/store/monitor";

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-1" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TariffEditor({ title, value, onChange }: { title: string; value: Tariff; onChange: (t: Tariff) => void }) {
  const setAdj = (key: keyof Tariff["adjustments"], v: string) =>
    onChange({ ...value, adjustments: { ...value.adjustments, [key]: Number(v) } });
  const setSlab = (i: number, field: "rate" | "fixed", v: string) => {
    const slabs = value.slabs.map((s, idx) => (idx === i ? { ...s, [field]: Number(v) } : s));
    onChange({ ...value, slabs });
  };
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

export function SettingsView() {
  const general = useMonitor((s) => s.general);
  const t1 = useMonitor((s) => s.tariff1);
  const t2 = useMonitor((s) => s.tariff2);
  const saveGeneral = useMonitor((s) => s.saveGeneral);
  const saveTariffs = useMonitor((s) => s.saveTariffs);
  const resetDemo = useMonitor((s) => s.resetDemo);
  const [g, setG] = useState<GeneralSettings>(general);
  const [a, setA] = useState<Tariff>(t1);
  const [b, setB] = useState<Tariff>(t2);
  const [saved, setSaved] = useState("");

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <h2 className="font-display text-2xl font-medium">General</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Goal combined units" type="number" value={g.goalCombinedUnits} onChange={(v) => setG({ ...g, goalCombinedUnits: Number(v) })} />
          <Field label="Billing day" type="number" value={g.billingDay} onChange={(v) => setG({ ...g, billingDay: Number(v) })} />
          <Field label="Billing hour" type="number" value={g.billingHour} onChange={(v) => setG({ ...g, billingHour: Number(v) })} />
          <Field label="Billing minute" type="number" value={g.billingMinute} onChange={(v) => setG({ ...g, billingMinute: Number(v) })} />
          <Field label="Solar start hour" type="number" value={g.solarStartHour} onChange={(v) => setG({ ...g, solarStartHour: Number(v) })} />
          <Field label="Solar end hour" type="number" value={g.solarEndHour} onChange={(v) => setG({ ...g, solarEndHour: Number(v) })} />
        </div>
        <Button
          className="mt-5"
          onClick={() => {
            saveGeneral(g);
            setSaved("General settings saved.");
          }}
        >
          Save general
        </Button>
      </section>

      <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
        <h2 className="font-display text-2xl font-medium">Meter tariffs</h2>
        <p className="mt-1 text-sm text-muted">MEPCO A-1 residential slabs. Each meter can differ.</p>
        <div className="mt-4 space-y-3">
          <TariffEditor title="Meter 1" value={a} onChange={setA} />
          <TariffEditor title="Meter 2" value={b} onChange={setB} />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            onClick={() => {
              saveTariffs(a, b);
              setSaved("Tariffs saved.");
            }}
          >
            Save tariffs
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              resetDemo();
              setSaved("Demo data restored.");
            }}
          >
            Restore demo data
          </Button>
        </div>
        {saved ? <p className="mt-3 text-sm text-muted">{saved}</p> : null}
      </section>
    </div>
  );
}
