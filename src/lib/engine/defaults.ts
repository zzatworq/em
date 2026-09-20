import type { Adjustments, FpaSettings, GeneralSettings, Slab, Tariff } from "./types";

export const DEFAULT_GENERAL: GeneralSettings = {
  goalCombinedUnits: 100,
  billingDay: 13,
  billingHour: 17,
  billingMinute: 0,
  solarStartHour: 7,
  solarStartMinute: 30,
  solarEndHour: 17,
  solarEndMinute: 30,
  theme: "system",
  meter1Color: "#4FD1C5",
  meter2Color: "#A78BFA",
  v1Url: "",
};

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  FCA: 0,
  QTA: 0,
  FC: 0,
  NJ: 0,
  ED: 1.5,
  GST: 18,
  TV: 0,
  OtherFixed: 0,
  dutyBase: "ENERGY_PLUS_QTA",
};

export const DEFAULT_SLABS: Slab[] = [
  { min: 1, max: 100, rate: 22.44, fixed: 275 },
  { min: 101, max: 200, rate: 28.91, fixed: 300 },
  { min: 201, max: 300, rate: 33.10, fixed: 350 },
  { min: 301, max: 400, rate: 36.46, fixed: 400 },
  { min: 401, max: 500, rate: 38.95, fixed: 500 },
  { min: 501, max: 600, rate: 40.22, fixed: 675 },
  { min: 601, max: 700, rate: 41.85, fixed: 675 },
  { min: 701, max: Infinity, rate: 47.20, fixed: 675 },
];

export const DEFAULT_PROTECTED: Slab[] = [
  { min: 1, max: 100, rate: 10.54, fixed: 200 },
  { min: 101, max: 200, rate: 13.01, fixed: 300 },
];

export const DEFAULT_FPA: FpaSettings = {
  enabled: false,
  energyPerUnit: 0,
  dutyRate: 1.5,
  gstRate: 18,
  referenceMonth: "",
};

export function defaultTariff(sanctionedLoadKw = 1): Tariff {
  return {
    effectiveFrom: "06-Feb-2026",
    consumerType: "Unprotected",
    protectionMode: "UNPROTECTED",
    protectionMonths: 6,
    protectionMaxUnits: 200,
    tariff: "A-1 Residential",
    connectionType: "Single Phase",
    sanctionedLoadKw,
    taxStatus: "NON_ATL",
    incomeTaxEnabled: true,
    incomeTaxThreshold: 25000,
    incomeTaxRate: 7.5,
    roundingPolicy: "PITC",
    slabMode: "ALL_UNITS_AT_APPLICABLE_RATE",
    slabs: DEFAULT_SLABS.map((s) => ({ ...s })),
    protectedSlabs: DEFAULT_PROTECTED.map((s) => ({ ...s })),
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    fpa: { enabled: true, energyPerUnit: 2.0581, dutyRate: 1.5, gstRate: 18, referenceMonth: "July 2026 — billed September 2026" },
  slabs: Array.isArray(v.slabs) && v.slabs.length ? v.slabs.map((s) => ({ ...s })) : base.slabs,
    protectedSlabs: Array.isArray(v.protectedSlabs) && v.protectedSlabs.length ? v.protectedSlabs.map((s) => ({ ...s })) : base.protectedSlabs,
  };
}
