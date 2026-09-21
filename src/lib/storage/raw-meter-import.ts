import { createServerFn } from "@tanstack/react-start";
import {
  copyDriveImage,
  driveFolderInfo,
  listRawDriveImages,
  loadDriveImage,
  type RawDriveImage,
} from "./google-drive";
import {
  extractMeterReading,
  type MeterReadingResult,
} from "../meter-vision";
import {
  loadMeterIdentities,
  loadMeterImageReferences,
  saveMeterImage,
} from "./meter-images";

type Meter = "m1" | "m2";
type Reading = {
  id: string;
  datetime: number;
  newInput: number | null;
  oldInput: number | null;
};

function nearestReading(readings: Reading[], timestamp: number) {
  let best: Reading | null = null;
  let distance = Infinity;
  for (const reading of readings) {
    const d = Math.abs(timestamp - reading.datetime);
    if (d < distance) {
      best = reading;
      distance = d;
    }
  }
  return best;
}

function previousValue(readings: Reading[], meter: Meter, timestamp: number) {
  const field = meter === "m1" ? "newInput" : "oldInput";
  return [...readings]
    .filter((r) => r.datetime <= timestamp && r[field] != null)
    .sort((a, b) => b.datetime - a.datetime)[0]?.[field] ?? null;
}

function inferMeter(
  readings: Reading[],
  timestamp: number,
  value: number | null,
  detected: Meter | null,
): { meter: Meter | null; confidence: "high" | "medium" | "low"; reason: string } {
  if (detected) return { meter: detected, confidence: "high", reason: "vision" };
  if (value == null) return { meter: null, confidence: "low", reason: "no-reading" };

  const target = nearestReading(readings, timestamp);
  if (target) {
    const has1 = target.newInput != null;
    const has2 = target.oldInput != null;
    if (has1 && !has2) return { meter: "m1", confidence: "high", reason: "nearest-reading" };
    if (has2 && !has1) return { meter: "m2", confidence: "high", reason: "nearest-reading" };
  }

  const p1 = previousValue(readings, "m1", timestamp);
  const p2 = previousValue(readings, "m2", timestamp);
  const d1 = p1 == null ? Infinity : value - p1;
  const d2 = p2 == null ? Infinity : value - p2;
  const plausible = (d: number) => d >= -0.05 && d <= 500;

  if (plausible(d1) && !plausible(d2)) return { meter: "m1", confidence: "high", reason: "reading-continuity" };
  if (plausible(d2) && !plausible(d1)) return { meter: "m2", confidence: "high", reason: "reading-continuity" };
  if (plausible(d1) && plausible(d2)) {
    const gap = Math.abs(d1 - d2);
    if (gap > 0.5) return { meter: Math.abs(d1) < Math.abs(d2) ? "m1" : "m2", confidence: "medium", reason: "reading-distance" };
  }
  return { meter: null, confidence: "low", reason: "ambiguous" };
}

function timestampFor(file: RawDriveImage) {
  if (file.imageTime) {
    const t = Date.parse(file.imageTime);
    if (Number.isFinite(t)) return t;
  }
  const name = file.name;
  const m = name.match(/(?:IMG|TimePhoto)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i);
  if (m) {
    // The phone's original EXIF/imageMediaMetadata time is preferred above.
    // Filename timestamps are assumed to be Pakistan local time for this app.
    const t = Date.parse(\`\${m[1]}-\${m[2]}-\${m[3]}T\${m[4]}:\${m[5]}:\${m[6]}+05:00\`);
    if (Number.isFinite(t)) return t;
  }
  return file.createdTime ? Date.parse(file.createdTime) : Date.now();
}

function extension(file: RawDriveImage) {
  const m = file.name.match(/(\\.[^.]+)$/);
  return m?.[1]?.toLowerCase() ?? ".jpg";
}

function organizedName(file: RawDriveImage, timestamp: number, meter: Meter | null, value: number | null) {
  const stamp = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  const meterName = meter === "m1" ? "Meter1" : meter === "m2" ? "Meter2" : "Review";
  const reading = value == null ? "unknown" : value.toFixed(2);
  return \`\${stamp}_\${meterName}_\${reading}_\${file.id.slice(0, 8)}\${extension(file)}\`;
}

export type RawImportResult = {
  total: number;
  processed: number;
  attached: number;
  review: number;
  failed: number;
  items: Array<{
    sourceId: string;
    sourceName: string;
    driveFileId?: string;
    readingId?: string | null;
    meter?: Meter | null;
    value?: number | null;
    confidence?: string;
    reason?: string;
    error?: string;
  }>;
};

export const processRawMRFolder = createServerFn({ method: "POST" })
  .validator((data: { readings: Reading[]; force?: boolean }) => data)
  .handler(async ({ data }): Promise<RawImportResult> => {
    const files = await listRawDriveImages();
    const folder = await driveFolderInfo();
    const identities = await loadMeterIdentities();
    const references = await loadMeterImageReferences();

    const result: RawImportResult = {
      total: files.length, processed: 0, attached: 0, review: 0, failed: 0, items: [],
    };

    for (const file of files) {
      try {
        // Existing organized copies are detected by the source ID recorded in
        // the generated filename. The explicit force option is for reprocessing.
        if (!data.force) {
          const suffix = file.id.slice(0, 8);
          const existing = references.some((x) => x.id.includes(suffix));
          if (existing) continue;
        }

        const image = await loadDriveImage({ data: { id: file.id } });
        const scan: MeterReadingResult = await extractMeterReading({
          data: {
            imageBase64: image.base64,
            mimeType: image.mimeType,
            knownIdentities: identities,
            knownReferences: references.slice(0, 6).map((x) => ({ meter: x.meter, imageBase64: x.imageBase64 })),
          },
        });

        const timestamp = timestampFor(file);
        const target = nearestReading(data.readings, timestamp);
        const inferred = inferMeter(data.readings, timestamp, scan.value, scan.matchedMeter);
        const meter = inferred.meter;
        const confident = Boolean(target && meter && scan.value != null && inferred.confidence !== "low");
        const readingId = confident ? target?.id ?? null : null;
        const parentId = confident
          ? meter === "m1" ? folder.meter1 : folder.meter2
          : folder.unrelated;

        const copied = await copyDriveImage({
          data: {
            sourceId: file.id,
            parentId,
            name: organizedName(file, timestamp, meter, scan.value),
          },
        });

        await saveMeterImage({
          data: {
            id: \`raw-\${file.id}\`,
            meter: meter ?? "m1",
            readingId,
            value: scan.value,
            identity: scan.identity,
            driveFileId: copied.id,
            imageCreatedAt: timestamp,
            status: confident ? "attached" : "unrelated",
          },
        });

        result.processed++;
        if (confident) result.attached++; else result.review++;
        result.items.push({
          sourceId: file.id,
          sourceName: file.name,
          driveFileId: copied.id,
          readingId,
          meter,
          value: scan.value,
          confidence: inferred.confidence,
          reason: inferred.reason,
        });
      } catch (error) {
        result.failed++;
        result.items.push({
          sourceId: file.id,
          sourceName: file.name,
          error: error instanceof Error ? error.message : "Processing failed",
        });
      }
    }

    return result;
  });
