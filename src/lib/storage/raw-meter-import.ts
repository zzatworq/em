import { createServerFn } from "@tanstack/react-start";
import { copyDriveImage, driveFolderInfo, listRawDriveImages, type RawDriveImage } from "./google-drive";
import { saveMeterImage, listMeterImages } from "./meter-images";

type Meter = "m1" | "m2";
type Reading = { id: string; datetime: number; newInput: number | null; oldInput: number | null };

function nearestReading(readings: Reading[], timestamp: number) {
  let best: Reading | null = null, distance = Infinity;
  for (const reading of readings) { const d = Math.abs(timestamp - reading.datetime); if (d < distance) { best = reading; distance = d; } }
  return { reading: best, distance };
}

function timestampFor(file: RawDriveImage) {
  if (file.imageTime) { const t = Date.parse(file.imageTime); if (Number.isFinite(t)) return t; }
  const m = file.name.match(/(?:IMG|TimePhoto)_(d{4})(d{2})(d{2})_(d{2})(d{2})(d{2})/i);
  if (m) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:00`);
    if (Number.isFinite(t)) return t;
  }
  const t = Date.parse(file.createdTime ?? "");
  return Number.isFinite(t) ? t : Date.now();
}

function inferMeter(reading: Reading | null): Meter | null {
  if (!reading) return null;
  if (reading.newInput != null && reading.oldInput == null) return "m1";
  if (reading.oldInput != null && reading.newInput == null) return "m2";
  return null;
}

function organizedName(file: RawDriveImage, timestamp: number, meter: Meter | null) {
  const stamp = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  const meterName = meter === "m1" ? "Meter1" : meter === "m2" ? "Meter2" : "Review";
  return `${stamp}_${meterName}_${file.id.slice(0, 8)}${file.name.match(/(.[^.]+)$/)?.[1]?.toLowerCase() ?? ".jpg"}`;
}

export type RawImportResult = {
  total: number; processed: number; attached: number; review: number; failed: number;
  items: Array<{ sourceId: string; sourceName: string; driveFileId?: string; readingId?: string | null; meter?: Meter | null; confidence?: string; reason?: string; error?: string }>;
};

export const processRawMRFolder = createServerFn({ method: "POST" })
  .validator((data: { readings: Reading[]; force?: boolean }) => data)
  .handler(async ({ data }): Promise<RawImportResult> => {
    const files = await listRawDriveImages();
    const folder = await driveFolderInfo();
    const stored = await listMeterImages();
    const done = new Set(stored.map((x) => x.id));
    const result: RawImportResult = { total: files.length, processed: 0, attached: 0, review: 0, failed: 0, items: [] };

    for (const file of files) {
      const id = `raw-${file.id}`;
      if (!data.force && done.has(id)) continue;
      try {
        const timestamp = timestampFor(file);
        const nearest = nearestReading(data.readings, timestamp);
        // Timestamp matching is the default path. Do not send thousands of
        // historical images to AI; ambiguous cases are sent to Review.
        const meter = inferMeter(nearest.reading);
        const confidence = nearest.reading && nearest.distance <= 24 * 60 * 60 * 1000 && meter ? "high" : "low";
        const attached = Boolean(nearest.reading && meter && confidence === "high");
        const parentId = attached ? (meter === "m1" ? folder.meter1 : folder.meter2) : folder.unrelated;
        const copied = await copyDriveImage({ data: { sourceId: file.id, parentId, name: organizedName(file, timestamp, meter) } });
        await saveMeterImage({ data: {
          id, meter: meter ?? "m1", readingId: attached ? nearest.reading!.id : null,
          value: null, identity: null, driveFileId: copied.id, imageCreatedAt: timestamp,
          status: attached ? "attached" : "review"
        }});
        done.add(id); result.processed++; attached ? result.attached++ : result.review++;
        result.items.push({ sourceId: file.id, sourceName: file.name, driveFileId: copied.id, readingId: attached ? nearest.reading!.id : null, meter, confidence, reason: nearest.reading ? `nearest reading ${Math.round(nearest.distance / 60000)} min` : "no reading" });
      } catch (error) {
        result.failed++; result.items.push({ sourceId: file.id, sourceName: file.name, error: error instanceof Error ? error.message : "Processing failed" });
      }
    }
    return result;
  });
