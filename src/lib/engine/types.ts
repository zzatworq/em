export type MeterId = "METER 1" | "METER 2";

export type Slab = {
  min: number;
  max: number;
  rate: number;
  fixed: number;
};

export type Adjustments = {
  FCA: number;
  QTA: number;
  FC: number;
  NJ: number;
  ED: number;
  GST: number;
  TV: number;
  OtherFixed: number;
};

export type Tariff = {
  effectiveFrom: string;
  consumerType: "Protected" | "Unprotected";
  tariff: string;
  connectionType: string;
  slabMode: "ALL_UNITS_AT_APPLICABLE_RATE" | "PROGRESSIVE";
  slabs: Slab[];
  protectedSlabs: Slab[];
  adjustments: Adjustments;
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
  extendedDays?: number;
  standardDays?: number;
};

export type HistoryRow = {
  id: string;
  month: string;
  meter: MeterId;
  status: string;
  units: number;
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
  slab: string;
  rate: number;
  energy: number;
  fixed: number;
  adjustments: number;
  duty: number;
  gst: number;
  tv: number;
  otherFixed: number;
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
