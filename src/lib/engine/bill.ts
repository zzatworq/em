import type { MeterBill, Slab, Tariff } from "./types";

function fmtMoney(value: number): string {
  return Number(value || 0).toFixed(2);
}

function fmtUnits(value: number): string {
  return Number(value || 0).toFixed(2).replace(/\.00$/, "");
}

export function slabLabel(slab: Slab): string {
  if (slab.max === Infinity) return "Above 700";
  return `${slab.min}-${slab.max}`;
}

export function calculateMeterBill(rawUnits: number, tariff: Tariff): MeterBill {
  let units = Number(rawUnits || 0);
  if (units < 0) units = 0;
  if (units === 0) {
    return {
      units: 0,
      slab: "No consumption",
      rate: 0,
      energy: 0,
      fixed: 0,
      adjustments: 0,
      duty: 0,
      gst: 0,
      tv: 0,
      otherFixed: 0,
      total: 0,
      steps: [{ label: "Consumption", formula: "0 kWh", amount: 0 }],
    };
  }

  const activeSlabs =
    tariff.consumerType === "Protected" ? tariff.protectedSlabs : tariff.slabs;
  let slab = activeSlabs[activeSlabs.length - 1];
  for (const s of activeSlabs) {
    if (units >= s.min && units <= s.max) {
      slab = s;
      break;
    }
  }

  const steps: MeterBill["steps"] = [];
  let energy = 0;
  if (tariff.slabMode === "PROGRESSIVE") {
    let remaining = units;
    for (const s of activeSlabs) {
      if (remaining <= 0) break;
      const width =
        s.max === Infinity ? remaining : Math.min(remaining, Math.max(0, s.max - s.min + 1));
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
  } else {
    energy = units * slab.rate;
    steps.push({
      label: `Energy charges — applicable slab ${slabLabel(slab)}`,
      formula: `${fmtUnits(units)} × Rs ${fmtMoney(slab.rate)} = Rs ${fmtMoney(energy)}`,
      amount: energy,
    });
  }

  const fixed = slab.fixed;
  steps.push({
    label: "Fixed charge",
    formula: `Applicable slab fixed charge = Rs ${fmtMoney(fixed)}`,
    amount: fixed,
  });

  const perUnit =
    tariff.adjustments.FCA +
    tariff.adjustments.QTA +
    tariff.adjustments.FC +
    tariff.adjustments.NJ;
  const adjustmentAmount = units * perUnit;
  if (perUnit !== 0) {
    steps.push({
      label: "Per-unit adjustments",
      formula: `${fmtUnits(units)} × Rs ${fmtMoney(perUnit)} = Rs ${fmtMoney(adjustmentAmount)}`,
      amount: adjustmentAmount,
    });
  }

  const otherFixed = tariff.adjustments.OtherFixed;
  if (otherFixed !== 0) {
    steps.push({
      label: "Other fixed",
      formula: `Rs ${fmtMoney(otherFixed)}`,
      amount: otherFixed,
    });
  }

  const taxableBase = energy + fixed + adjustmentAmount + otherFixed;
  const duty = taxableBase * tariff.adjustments.ED / 100;
  const gst = (taxableBase + duty) * tariff.adjustments.GST / 100;
  const tv = tariff.adjustments.TV;

  if (tariff.adjustments.ED !== 0) {
    steps.push({
      label: "Electricity duty",
      formula: `(${fmtMoney(taxableBase)}) × ${fmtMoney(tariff.adjustments.ED)}% = Rs ${fmtMoney(duty)}`,
      amount: duty,
    });
  }
  if (tariff.adjustments.GST !== 0) {
    steps.push({
      label: "GST",
      formula: `(${fmtMoney(taxableBase + duty)}) × ${fmtMoney(tariff.adjustments.GST)}% = Rs ${fmtMoney(gst)}`,
      amount: gst,
    });
  }
  if (tv !== 0) {
    steps.push({
      label: "TV fee",
      formula: `Rs ${fmtMoney(tv)}`,
      amount: tv,
    });
  }

  const total = energy + fixed + adjustmentAmount + duty + gst + tv + otherFixed;
  steps.push({
    label: "Estimated bill",
    formula: `All charges above = Rs ${fmtMoney(total)}`,
    amount: total,
    total: true,
  });

  return {
    units,
    slab: slabLabel(slab),
    rate: slab.rate,
    energy,
    fixed,
    adjustments: adjustmentAmount,
    duty,
    gst,
    tv,
    otherFixed,
    total,
    steps,
  };
}

export function calculateProRata(
  baseline: number | null,
  present: number | null,
  extendedDays: number,
  standardDays: number,
) {
  if (baseline == null || present == null) return null;
  const actual = Number(present) - Number(baseline);
  const days = Math.round(Number(extendedDays || 0));
  const standard = Math.round(Number(standardDays || 0));
  if (!isFinite(actual) || days <= 0 || standard <= 0 || actual < 0) return null;
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
