import type { MeterBill, Slab, Tariff } from "./types";
import { normalizeTariff } from "./defaults";
import { calculateCurrentAdjustments, calculateFpaCharges, round0, round2 } from "./adjustments";

export type BillCalculationContext = {
  /** Monthly billed-unit history, newest first or oldest first; used for automatic protection. */
  recentMonthlyUnits?: number[];
};

export type BillReconciliation = {
  matches: boolean;
  differences: Partial<Record<"energy" | "fixed" | "fca" | "qta" | "fcSurcharge" | "nj" | "duty" | "gst" | "incomeTax" | "tv" | "fpaTotal" | "total", number>>;
};

function fmtMoney(value: number): string {
  return round2(value).toFixed(2);
}

function fmtUnits(value: number): string {
  return Number(value || 0).toFixed(2).replace(/\.00$/, "");
}

export function slabLabel(slab: Slab): string {
  if (slab.max === Infinity) return "Above 700";
  return `${slab.min}-${slab.max}`;
}

export function resolveConsumerType(
  tariff: Tariff,
  recentMonthlyUnits: number[] = [],
): "Protected" | "Unprotected" {
  const normalized = normalizeTariff(tariff);
  if (normalized.protectionMode === "PROTECTED") return "Protected";
  if (normalized.protectionMode === "UNPROTECTED") return "Unprotected";

  const months = Math.max(1, Math.floor(normalized.protectionMonths || 6));
  const maxUnits = Number(normalized.protectionMaxUnits);
  const recent = recentMonthlyUnits
    .map(Number)
    .filter(Number.isFinite)
    .slice(-months);

  return recent.length >= months && recent.every((units) => units <= maxUnits)
    ? "Protected"
    : "Unprotected";
}

function applicableSlabs(tariff: Tariff, consumerType: "Protected" | "Unprotected"): Slab[] {
  return consumerType === "Protected" ? tariff.protectedSlabs : tariff.slabs;
}

function findSlab(units: number, slabs: Slab[]): Slab {
  const first = slabs[0];
  if (!first) throw new Error("No tariff slabs configured.");
  if (units <= 0) return first;
  return slabs.find((s) => units >= s.min && units <= s.max) ?? slabs[slabs.length - 1];
}

function progressiveEnergy(units: number, slabs: Slab[]) {
  let remaining = units;
  let energy = 0;
  const steps: MeterBill["steps"] = [];

  for (const s of slabs) {
    if (remaining <= 0) break;
    const width = s.max === Infinity
      ? remaining
      : Math.min(remaining, Math.max(0, s.max - s.min + 1));
    if (width <= 0) continue;
    const amount = width * s.rate;
    energy += amount;
    steps.push({
      label: `Energy — ${slabLabel(s)}`,
      formula: `${fmtUnits(width)} × Rs ${fmtMoney(s.rate)} = Rs ${fmtMoney(amount)}`,
      amount,
    });
    remaining -= width;
  }

  return { energy, steps };
}

export function calculateMeterBill(
  rawUnits: number,
  inputTariff: Tariff,
  context: BillCalculationContext = {},
): MeterBill {
  const tariff = normalizeTariff(inputTariff);
  let units = Number(rawUnits || 0);
  if (!Number.isFinite(units) || units < 0) units = 0;

  const consumerType = resolveConsumerType(tariff, context.recentMonthlyUnits);
  const slabs = applicableSlabs(tariff, consumerType);
  const slab = findSlab(units, slabs);
  const loadKw = Math.max(0, Number(tariff.sanctionedLoadKw) || 0);
  const fixed = units > 0 ? slab.fixed * loadKw : 0;
  const steps: MeterBill["steps"] = [];

  if (units === 0) {
    return {
      units: 0,
      consumerType,
      taxStatus: tariff.taxStatus,
      sanctionedLoadKw: loadKw,
      slab: "No consumption",
      rate: 0,
      energy: 0,
      fixed: 0,
      fca: 0,
      qta: 0,
      fcSurcharge: 0,
      nj: 0,
      adjustments: 0,
      duty: 0,
      gst: 0,
      incomeTax: 0,
      tv: 0,
      otherFixed: 0,
      subtotalBeforeIncomeTax: 0,
      fpaEnergy: 0,
      fpaDuty: 0,
      fpaGst: 0,
      fpaTotal: 0,
      total: 0,
      steps: [{ label: "Consumption", formula: "0 kWh", amount: 0 }],
    };
  }

  let energy = 0;
  if (tariff.slabMode === "PROGRESSIVE") {
    const result = progressiveEnergy(units, slabs);
    energy = result.energy;
    steps.push(...result.steps);
  } else {
    energy = units * slab.rate;
    steps.push({
      label: `Energy charges — applicable slab ${slabLabel(slab)}`,
      formula: `${fmtUnits(units)} × Rs ${fmtMoney(slab.rate)} = Rs ${fmtMoney(energy)}`,
      amount: energy,
    });
  }
  energy = round2(energy);

  steps.push({
    label: "Fixed charge",
    formula: `Rs ${fmtMoney(slab.fixed)} × ${fmtUnits(loadKw)} kW = Rs ${fmtMoney(fixed)}`,
    amount: fixed,
  });

  const current = calculateCurrentAdjustments(units, tariff.adjustments);
  const otherFixed = round2(Number(tariff.adjustments.OtherFixed || 0));
  const variableCurrent = energy + current.fca + current.qta + current.fc + current.nj;
  const dutyBase = tariff.adjustments.dutyBase === "ALL_VARIABLE"
    ? variableCurrent
    : energy + current.qta;
  const duty = round2(dutyBase * Number(tariff.adjustments.ED || 0) / 100);

  const taxableCurrentBase = variableCurrent + fixed + otherFixed;
  const gst = round0((taxableCurrentBase + duty) * Number(tariff.adjustments.GST || 0) / 100);
  const subtotalBeforeIncomeTax = taxableCurrentBase + duty + gst;

  let incomeTax = 0;
  if (
    tariff.incomeTaxEnabled &&
    tariff.taxStatus === "NON_ATL" &&
    subtotalBeforeIncomeTax > Number(tariff.incomeTaxThreshold || 0)
  ) {
    incomeTax = round0(subtotalBeforeIncomeTax * Number(tariff.incomeTaxRate || 0) / 100);
  }

  const fpa = calculateFpaCharges(units, tariff.fpa);
  const tv = round2(Number(tariff.adjustments.TV || 0));
  const total = subtotalBeforeIncomeTax + incomeTax + tv + fpa.total;

  if (current.fca !== 0) steps.push({ label: "FCA", formula: `${fmtUnits(units)} × Rs ${fmtMoney(tariff.adjustments.FCA)} = Rs ${fmtMoney(current.fca)}`, amount: current.fca });
  if (current.qta !== 0) steps.push({ label: "QTA", formula: `${fmtUnits(units)} × Rs ${fmtMoney(tariff.adjustments.QTA)} = Rs ${fmtMoney(current.qta)}`, amount: current.qta });
  if (current.fc !== 0) steps.push({ label: "FC surcharge", formula: `${fmtUnits(units)} × Rs ${fmtMoney(tariff.adjustments.FC)} = Rs ${fmtMoney(current.fc)}`, amount: current.fc });
  if (current.nj !== 0) steps.push({ label: "NJ surcharge", formula: `${fmtUnits(units)} × Rs ${fmtMoney(tariff.adjustments.NJ)} = Rs ${fmtMoney(current.nj)}`, amount: current.nj });

  if (otherFixed !== 0) {
    steps.push({ label: "Other fixed", formula: `Rs ${fmtMoney(otherFixed)}`, amount: otherFixed });
  }
  if (tariff.adjustments.ED !== 0) {
    steps.push({
      label: "Electricity duty",
      formula: `(${fmtMoney(dutyBase)}) × ${fmtMoney(tariff.adjustments.ED)}% = Rs ${fmtMoney(duty)}`,
      amount: duty,
    });
  }
  if (tariff.adjustments.GST !== 0) {
    steps.push({
      label: "GST",
      formula: `(${fmtMoney(taxableCurrentBase + duty)}) × ${fmtMoney(tariff.adjustments.GST)}% = Rs ${gst.toFixed(0)}`,
      amount: gst,
    });
  }
  if (incomeTax !== 0) {
    steps.push({
      label: "Income tax",
      formula: `(${fmtMoney(subtotalBeforeIncomeTax)}) × ${fmtMoney(tariff.incomeTaxRate)}% = Rs ${incomeTax.toFixed(0)}`,
      amount: incomeTax,
    });
  }
  if (tv !== 0) steps.push({ label: "TV fee", formula: `Rs ${fmtMoney(tv)}`, amount: tv });

  if (fpa.total !== 0) {
    steps.push({ label: "FPA energy", formula: `${fmtUnits(units)} × Rs ${fmtMoney(tariff.fpa.energyPerUnit)} = Rs ${fmtMoney(fpa.energy)}`, amount: fpa.energy });
    steps.push({ label: "FPA electricity duty", formula: `(${fmtMoney(fpa.energy)}) × ${fmtMoney(tariff.fpa.dutyRate)}% = Rs ${fmtMoney(fpa.duty)}`, amount: fpa.duty });
    steps.push({ label: "FPA GST", formula: `(${fmtMoney(fpa.energy + fpa.duty)}) × ${fmtMoney(tariff.fpa.gstRate)}% = Rs ${fpa.gst.toFixed(0)}`, amount: fpa.gst });
  }

  steps.push({
    label: "Estimated bill",
    formula: `Current charges + income tax + FPA = Rs ${fmtMoney(total)}`,
    amount: total,
    total: true,
  });

  return {
    units,
    consumerType,
    taxStatus: tariff.taxStatus,
    sanctionedLoadKw: loadKw,
    slab: slabLabel(slab),
    rate: slab.rate,
    energy,
    fixed,
    fca: current.fca,
    qta: current.qta,
    fcSurcharge: current.fc,
    nj: current.nj,
    adjustments: current.total,
    duty,
    gst,
    incomeTax,
    tv,
    otherFixed,
    subtotalBeforeIncomeTax,
    fpaEnergy: fpa.energy,
    fpaDuty: fpa.duty,
    fpaGst: fpa.gst,
    fpaTotal: fpa.total,
    total,
    steps,
  };
}

export function reconcileMeterBill(
  calculated: MeterBill,
  actual: Partial<Pick<MeterBill, "energy" | "fixed" | "fca" | "qta" | "fcSurcharge" | "nj" | "duty" | "gst" | "incomeTax" | "tv" | "fpaTotal" | "total">>,
  tolerance = 0.02,
): BillReconciliation {
  const fields = ["energy", "fixed", "fca", "qta", "fcSurcharge", "nj", "duty", "gst", "incomeTax", "tv", "fpaTotal", "total"] as const;
  const differences: BillReconciliation["differences"] = {};
  for (const field of fields) {
    if (actual[field] == null) continue;
    const diff = round2(calculated[field] - Number(actual[field]));
    if (Math.abs(diff) > tolerance) differences[field] = diff;
  }
  return { matches: Object.keys(differences).length === 0, differences };
}

export function calculateProRata(
  baseline: number | null,
  present: number | null,
  extendedDays: number,
  standardDays: number,
) {
  if (baseline == null || present == null) return null;

  const actual = Number(present) - Number(baseline);
  const days = Number(extendedDays);
  const standard = Number(standardDays);
  if (!isFinite(actual) || !isFinite(days) || !isFinite(standard) || days <= 0 || standard <= 0 || actual < 0) return null;

  const daily = actual / days;
  const billed = Math.floor(daily * standard);
  return {
    baseline: Number(baseline),
    present: Number(present),
    extendedDays: days,
    actualUnits: actual,
    dailyAverage: daily,
    standardDays: standard,
    billedUnits: billed,
    adjustedPresent: Number(baseline) + billed,
    carryForward: actual - billed,
  };
}
