import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateMeterBill, calculateProRata } from "./bill.ts";
import { defaultTariff } from "./defaults.ts";

test("zero consumption returns empty bill", () => {
  const b = calculateMeterBill(0, defaultTariff());
  assert.equal(b.total, 0);
  assert.equal(b.units, 0);
});

test("unprotected slab uses all-units applicable rate", () => {
  const tariff = defaultTariff();
  const b = calculateMeterBill(80, tariff);
  assert.equal(b.rate, 37.5);
  assert.equal(b.energy, 80 * 37.5);
  assert.equal(b.fixed, 275);
  assert.ok(b.total > b.energy + b.fixed);
});

test("pro-rata floors billed units", () => {
  const p = calculateProRata(100, 163.4, 33, 30);
  assert.ok(p);
  assert.equal(p.actualUnits, 63.4);
  assert.equal(p.billedUnits, Math.floor((63.4 / 33) * 30));
  assert.equal(p.carryForward, p.actualUnits - p.billedUnits);
});
