import type { Adjustments, FpaSettings } from "./types";

export type CurrentAdjustments = {
  fca: number;
  qta: number;
  fc: number;
  nj: number;
  total: number;
};

export function calculateCurrentAdjustments(units: number, settings: Adjustments): CurrentAdjustments {
  const u = Math.max(0, Number(units) || 0);
  const fca = u * Number(settings.FCA || 0);
  const qta = u * Number(settings.QTA || 0);
  const fc = u * Number(settings.FC || 0);
  const nj = u * Number(settings.NJ || 0);
  return { fca, qta, fc, nj, total: fca + qta + fc + nj };
}

export type FpaCharges = {
  energy: number;
  duty: number;
  gst: number;
  total: number;
};

export function calculateFpaCharges(units: number, settings: FpaSettings): FpaCharges {
  if (!settings.enabled) return { energy: 0, duty: 0, gst: 0, total: 0 };
  const energy = Number(units || 0) * Number(settings.energyPerUnit || 0);
  const duty = round2(energy * Number(settings.dutyRate || 0) / 100);
  const gst = round0((energy + duty) * Number(settings.gstRate || 0) / 100);
  return { energy, duty, gst, total: energy + duty + gst };
}

export function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function round0(value: number): number {
  return Math.round(Number(value));
}
