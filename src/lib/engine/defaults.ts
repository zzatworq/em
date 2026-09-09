import type { Adjustments, GeneralSettings, Slab, Tariff } from "./types";

export const ESTIMATION_PROFILE: number[] = [
  0.1743431221, 0.1743431221, 0.1743431221, 0.1743431221, 0.1743431221,
  0.1743431221, 0.1743431221, 0.076258988, 0.0108695652, 0.0108695652,
  0.0108695652, 0.0108695652, 0.01, 0.01, 0.01, 0.01, 0.01, 0.05625,
  0.1408928571, 0.2419340659, 0.1977546071, 0.1743431221, 0.1743431221,
  0.1743431221,
];

export const DEFAULT_GENERAL: GeneralSettings = {
  goalCombinedUnits: 100,
  billingDay: 13,
  billingHour: 17,
  billingMinute: 0,
  solarStartHour: 7,
  solarStartMinute: 30,
  solarEndHour: 17,
  solarEndMinute: 30,
};

const DEFAULT_ADJUSTMENTS: Adjustments = {
  FCA: 0,
  QTA: 0,
  FC: 0,
  NJ: 0,
  ED: 1.5,
  GST: 17,
  TV: 35,
  OtherFixed: 0,
};

export const DEFAULT_SLABS: Slab[] = [
  { min: 1, max: 100, rate: 37.5, fixed: 275 },
  { min: 101, max: 200, rate: 43.5, fixed: 300 },
  { min: 201, max: 300, rate: 33.1, fixed: 350 },
  { min: 301, max: 400, rate: 36.46, fixed: 400 },
  { min: 401, max: 500, rate: 38.95, fixed: 500 },
  { min: 501, max: 600, rate: 40.22, fixed: 675 },
  { min: 601, max: 700, rate: 41.85, fixed: 675 },
  { min: 701, max: Infinity, rate: 47.2, fixed: 675 },
];

export const DEFAULT_PROTECTED: Slab[] = [
  { min: 1, max: 100, rate: 10.54, fixed: 200 },
  { min: 101, max: 200, rate: 13.01, fixed: 300 },
];

export function defaultTariff(): Tariff {
  return {
    effectiveFrom: "06-Feb-2026",
    consumerType: "Unprotected",
    tariff: "A-1 Residential",
    connectionType: "Single Phase",
    slabMode: "ALL_UNITS_AT_APPLICABLE_RATE",
    slabs: DEFAULT_SLABS.map((s) => ({ ...s })),
    protectedSlabs: DEFAULT_PROTECTED.map((s) => ({ ...s })),
    adjustments: { ...DEFAULT_ADJUSTMENTS },
  };
}
