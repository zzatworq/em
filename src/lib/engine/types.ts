export type MeterId = "METER 1" | "METER 2";

export type Slab = {
  min: number;
  max: number;
  rate: number;
  /** Fixed charge in Rs/kW/month for this slab. */
  fixed: number;
};

export type TaxStatus = "ATL" | "NON_ATL";
export type ProtectionMode = "AUTOMATIC" | "PROTECTED" | "UNPROTECTED";
export type RoundingPolicy = "PITC";

export type FpaSettings = {
  enabled: boolean;
  /** FCA/FPA energy adjustment in Rs/kWh for the referenced month. */
  energyPerUnit: number;
  dutyRate: number;
  gstRate: number;
  referenceMonth: string;
};

export type Adjustments = {
  /** Current-period per-unit adjustments in Rs/kWh. */
  FCA: number;
  QTA: number;
  FC: number;
  NJ: number;
  ED: number;
  GST: number;
  TV: number;
  OtherFixed: number;
  /** Whether electricity duty is calculated on energy + QTA or all variable current charges. */
  dutyBase: "ENERGY_PLUS_QTA" | "ALL_VARIABLE";
};

export type Tariff = {
  effectiveFrom: string;
  /** Resolved/manual consumer type kept for backward compatibility. */
  consumerType: "Protected" | "Unprotected";
  protectionMode: ProtectionMode;
  protectionMonths: number;
  protectionMaxUnits: number;
  tariff: string;
  connectionType: string;
  sanctionedLoadKw: number;
  taxStatus: TaxStatus;
  incomeTaxEnabled: boolean;
  incomeTaxThreshold: number;
  incomeTaxRate: number;
  roundingPolicy: RoundingPolicy;
  slabMode: "ALL_UNITS_AT_APPLICABLE_RATE" | "PROGRESSIVE";
  slabs: Slab[];
  protectedSlabs: Slab[];
  adjustments: Adjustments;
  fpa: FpaSettings;
};

export type GeneralSettings = {
  goalCombinedUnits: number;
  billingDay: number;
  billingHour: number;
  billingMinute: number;
  solarStartHour: number;
  solarStartMinute: number;
  solarEndHour: number;
  solarEndMinute: number;
  theme: "light" | "dark" | "system";
  meter1Color: string;
  meter2Color: string;
  v1Url: string;
};

export type ReadingInput = {
  id: string;
  datetime: number;
  newInput: number | null;
  oldInput: number | null;
  notes: string;
  loadKw: number | null;
};

export type CarriedReading = ReadingInput & {
  newReading: number | null;
  oldReading: number | null;
};

export type Collection = {
  id: string;
  month: string;
  meter: MeterId;
  date: string;
  time: string;
  previousBaseline: number;
  rawReading: number;
  billedReading?: number;
  extendedDays?: number;
  standardDays?: number;
  status?: string;
  bill?: number;
  payment?: number;
};

export type HistoryRow = {
  id: string;
  month: string;
  meter: MeterId;
  status: string;
  units: number;
  reading?: number;
  bill: number;
  payment: number;
};

export type Note = {
  id: string;
  timestamp: number;
  text: string;
};

export type BillStep = {
  label: string;
  formula: string;
  amount: number;
  total?: boolean;
};

export type MeterBill = {
  units: number;
  consumerType: "Protected" | "Unprotected";
  taxStatus: TaxStatus;
  sanctionedLoadKw: number;
  slab: string;
  rate: number;
  energy: number;
  fixed: number;
  fca: number;
  qta: number;
  fcSurcharge: number;
  nj: number;
  adjustments: number;
  duty: number;
  gst: number;
  incomeTax: number;
  tv: number;
  otherFixed: number;
  subtotalBeforeIncomeTax: number;
  fpaEnergy: number;
  fpaDuty: number;
  fpaGst: number;
  fpaTotal: number;
  total: number;
  steps: BillStep[];
};

export type DailyPoint = {
  label: string;
  date: string;
  period: string;
  newMeter: number | "";
  oldMeter: number | "";
  total: number | "";
  completed: boolean;
};

export type HourlyPoint = {
  label: string;
  start: number;
  end: number;
  newMeter: number | "";
  oldMeter: number | "";
  total: number | "";
};

export type HourlyProfilePoint = {
  hour: number;
  minute: number;
  fraction: number;
  percent: number;
};

export type ProRata = {
  baseline: number;
  present: number;
  extendedDays: number;
  actualUnits: number;
  dailyAverage: number;
  standardDays: number;
  billedUnits: number;
  adjustedPresent: number;
  carryForward: number;
};

export type GoalPace = {
  goal: number;
  elapsedDays: number;
  remainingDays: number;
  remainingUnits: number;
  dailyAverage: number;
  targetDailyAverage: number;
  requiredDailyAverage: number | "";
  overGoal: boolean;
};
