import type { Collection, HistoryRow, Note, ReadingInput } from "./types";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function id(prefix: string, n: number) {
  return `${prefix}-${n}`;
}

export function seedReadings(): ReadingInput[] {
  const rnd = mulberry32(20260813);
  const rows: ReadingInput[] = [];
  let meter1 = 2435;
  let meter2 = 4854;
  const start = new Date(2026, 6, 13, 18, 10, 0, 0);
  const end = new Date(2026, 8, 8, 8, 0, 0, 0);
  let cursor = new Date(start);
  let n = 1;
  while (cursor <= end) {
    const hour = cursor.getHours();
    const isSolar = hour >= 8 && hour < 17;
    const base = isSolar ? 0.04 + rnd() * 0.08 : 0.12 + rnd() * 0.22;
    meter1 += base * (0.45 + rnd() * 0.2);
    meter2 += base * (0.45 + rnd() * 0.25);
    rows.push({
      id: id("r", n++),
      datetime: cursor.getTime(),
      newInput: Number(meter1.toFixed(2)),
      oldInput: Number(meter2.toFixed(2)),
      notes: "",
      loadKw: isSolar ? Number((0.4 + rnd() * 1.8).toFixed(2)) : Number((0.8 + rnd() * 2.4).toFixed(2)),
    });
    const next = new Date(cursor);
    const stepH = hour < 7 ? 4 : hour < 12 ? 3 : hour < 18 ? 2 : 4;
    next.setHours(next.getHours() + stepH, Math.floor(rnd() * 20), 0, 0);
    cursor = next;
  }
  return rows;
}

export function seedCollections(): Collection[] {
  return [
    {
      id: "c-1",
      month: "Aug 2026",
      meter: "METER 1",
      date: "2026-08-15",
      time: "12:05",
      previousBaseline: 2435,
      rawReading: 2598.1,
      extendedDays: 33,
      standardDays: 31,
      status: "EX",
      bill: 6729,
      payment: 6729,
    },
    {
      id: "c-2",
      month: "Aug 2026",
      meter: "METER 2",
      date: "2026-08-15",
      time: "12:06",
      previousBaseline: 4854,
      rawReading: 4951.44,
      extendedDays: 33,
      standardDays: 31,
      status: "EX",
      bill: 3374,
      payment: 3374,
    },
  ];
}

export function seedHistory(): HistoryRow[] {
  const m1: [string, number, number, number, number][] = [
    ["Jul 25", 133, 1362, 1419, 1290], ["Aug 25", 100, 1112, 1112, 1390], ["Sep 25", 131, 1515, 1515, 1521],
    ["Oct 25", 116, 1318, 1318, 1637], ["Nov 25", 46, 540, 540, 1683], ["Dec 25", 64, 851, 0, 1747],
    ["Jan 26", 55, 1666, 1666, 1802], ["Feb 26", 59, 841, 841, 1861], ["Mar 26", 84, 1952, 1952, 1945],
    ["Apr 26", 61, 1635, 1635, 2006], ["May 26", 51, 1399, 1399, 2057], ["Jun 26", 166, 3413, 0, 2223],
    ["Jul 26", 212, 13661, 13661, 2435],
  ];

  const m2: [string, number, number, number, number][] = [
    ["Mar 23", 174, 5338, 5338, 0], ["Apr 23", 233, 7571, 7571, 0], ["May 23", 239, 7509, 7509, 0],
    ["Jun 23", 333, 12636, 12636, 0], ["Jul 23", 407, 16188, 16188, 0], ["Aug 23", 366, 17937, 17937, 0],
    ["Sep 23", 344, 16321, 16321, 0], ["Oct 23", 314, 15281, 15281, 0], ["Nov 23", 191, 6893, 6893, 0],
    ["Dec 23", 152, 6513, 6513, 0], ["Jan 24", 141, 5986, 5986, 0], ["Feb 24", 151, 6359, 6359, 0],
    ["Jul 25", 111, 1087, 1133, 3788], ["Aug 25", 122, 1421, 1421, 3910], ["Sep 25", 94, 1022, 1022, 4004],
    ["Oct 25", 104, 1154, 1154, 4108], ["Nov 25", 86, 1010, 1010, 4194], ["Dec 25", 50, 664, 0, 4244],
    ["Jan 26", 71, 1681, 1681, 4315], ["Feb 26", 41, 586, 586, 4356], ["Mar 26", 23, 921, 921, 4379],
    ["Apr 26", 37, 1042, 1042, 4416], ["May 26", 64, 1339, 1339, 4480], ["Jun 26", 165, 3011, 3011, 4645],
    ["Jul 26", 209, 9437, 9437, 4854],
  ];

  return [
    ...m1.map((r, i) => ({ id: `h1-${i}`, month: r[0], meter: "METER 1" as const, status: "EX", units: r[1], bill: r[2], payment: r[3], reading: r[4] })),
    ...m2.map((r, i) => ({ id: `h2-${i}`, month: r[0], meter: "METER 2" as const, status: "EX", units: r[1], bill: r[2], payment: r[3], ...(r[4] ? { reading: r[4] } : {}) })),
  ];
}

export function seedNotes(): Note[] {
  return [
    { id: "n-1", timestamp: new Date(2026, 7, 15, 12, 20).getTime(), text: "Official collection logged 15 Aug around noon. Baseline rolled forward from July." },
    { id: "n-2", timestamp: new Date(2026, 7, 22, 19, 5).getTime(), text: "Evening load spike after guests. Inverter stayed on-grid overnight." },
  ];
}
