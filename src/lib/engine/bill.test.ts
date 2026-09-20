import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateMeterBill, calculateProRata, reconcileMeterBill, resolveConsumerType } from "./bill.ts";
import { defaultTariff } from "./defaults.ts";

test("zero consumption returns empty bill", () => {
  const b = calculateMeterBill(0, defaultTariff());
  assert.equal(b.total, 0);
  assert.equal(b.units, 0);
  assert.equal(b.fixed, 0);
});

test("unprotected slab uses all-units applicable rate and sanctioned-load fixed charge", () => {
  const tariff = defaultTariff(3);
  const b = calculateMeterBill(80, tariff);
  assert.equal(b.rate, 22.44);
  assert.equal(b.energy, 80 * 22.44);
  assert.equal(b.fixed, 825);
  assert.ok(b.total > b.energy + b.fixed);
});

test("sub-1-unit consumption bills at the cheapest slab, not the most expensive", () => {
  const tariff = defaultTariff();
  const b = calculateMeterBill(0.5, tariff);
  const cheapest = tariff.slabs[0];
  assert.equal(b.rate, cheapest.rate);
  assert.equal(b.slab, `${cheapest.min}-${cheapest.max}`);
});

test("automatic protection requires six consecutive months at or below 200 units", () => {
  const tariff = defaultTariff();
  tariff.protectionMode = "AUTOMATIC";
  assert.equal(resolveConsumerType(tariff, [110, 180, 200, 95, 140, 199]), "Protected");
  assert.equal(resolveConsumerType(tariff, [110, 180, 200, 95, 201, 199]), "Unprotected");
});

test("57-unit sample reproduces the supplied bill sequence", () => {
  const tariff = defaultTariff(3);
  tariff.adjustments.FC = 3.23;
  tariff.adjustments.QTA = -57.91 / 57;
  tariff.fpa = {
    enabled: true,
    energyPerUnit: 436.32 / 57,
    dutyRate: 1.5,
    gstRate: 18,
    referenceMonth: "sample",
  };

  const b = calculateMeterBill(57, tariff);
  assert.equal(b.energy, 1279.08);
  assert.equal(b.fixed, 825);
  assert.equal(b.fcSurcharge, 184.11);
  assert.equal(b.qta, -57.91);
  assert.equal(b.duty, 18.32);
  assert.equal(b.gst, 405);
  assert.equal(b.fpaEnergy, 436.32);
  assert.equal(b.fpaDuty, 6.54);
  assert.equal(b.fpaGst, 80);
  assert.equal(b.fpaTotal, 522.86);
  assert.equal(b.total, 3176.46);
});

test("income tax is calculated on the current bill subtotal before FPA", () => {
  const tariff = defaultTariff(2);
  tariff.adjustments.FC = 3271.99 / 1013;
  tariff.adjustments.QTA = -1029.19 / 1013;
  tariff.fpa = {
    enabled: true,
    energyPerUnit: 430.14 / 1013,
    dutyRate: 1.5,
    gstRate: 18,
    referenceMonth: "sample",
  };

  // This is only a high-consumption sample for validating tax sequencing.
  // It is not the user's actual second-meter consumption.
  const b = calculateMeterBill(1013, tariff);
  assert.equal(b.energy, 47813.6);
  assert.equal(b.fixed, 1350);
  assert.equal(b.duty, 701.77);
  assert.equal(b.gst, 9379);
  assert.equal(b.incomeTax, 4612);
  assert.equal(b.fpaTotal, 514.59);
  assert.equal(b.total, 66613.76);
});

test("73-unit consumption does not trigger income tax at the default threshold", () => {
  const b = calculateMeterBill(73, defaultTariff(2));
  assert.equal(b.incomeTax, 0);
});

test("reconciliation reports component differences", () => {
  const b = calculateMeterBill(57, defaultTariff(3));
  const exact = reconcileMeterBill(b, { energy: b.energy, fixed: b.fixed, total: b.total });
  assert.equal(exact.matches, true);
  const mismatch = reconcileMeterBill(b, { total: b.total + 1 });
  assert.equal(mismatch.matches, false);
  assert.equal(mismatch.differences.total, -1);
});

test("pro-rata floors billed units", () => {
  const p = calculateProRata(100, 163.4, 33, 30);
  assert.ok(p);
  assert.equal(p.actualUnits, 63.4);
  assert.equal(p.billedUnits, Math.floor((63.4 / 33) * 30));
  assert.equal(p.carryForward, p.actualUnits - p.billedUnits);
});
