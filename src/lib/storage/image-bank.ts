import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { listImageBank, type DriveImageFile } from "@/lib/storage/google-drive";

type Meter = "m1" | "m2" | "unknown";
type Reading = { id: string; datetime: number };

type MonitorBinding = {
  idFromName(name: string): { readonly name?: string };
  get(id: { readonly name?: string }): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

function monitorStore() {
  const binding = (env as unknown as { MONITOR_STATE?: MonitorBinding }).MONITOR_STATE;
  if (!binding) throw new Error("Cloudflare MONITOR_STATE binding is missing.");
  return binding.get(binding.idFromName("default"));
}

function timestampFromName(name: string): number | null {
  const match = name.match(/(?:^|[^0-9])(20\\d{2})(\\d{2})(\\d{2})(?:[_-]?(\\d{2})(\\d{2})(\\d{2}))?/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const dt = new Date(year, month - 1, day, hour, minute, second);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return dt.getTime();
}

function meterFromPath(path: string[]): Meter {
  const value = path.join("/").toLowerCase();
  if (/meter[ _-]*1\\b/.test(value)) return "m1";
  if (/meter[ _-]*2\\b/.test(value)) return "m2";
  return "unknown";
}

function nearestReading(readings: Reading[], timestamp: number, maxDistanceMs = 5 * 60 * 1000) {
  let best: Reading | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tied = false;
  for (const reading of readings) {
    const distance = Math.abs(reading.datetime - timestamp);
    if (distance > maxDistanceMs) continue;
    if (distance < bestDistance) {
      best = reading;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }
  return best && !tied ? best : null;
}

async function saveImportedImage(file: DriveImageFile, meter: Meter, readingId: string | null, captureDatetime: number | null, status: "matched" | "unmatched" | "review") {
  const store = monitorStore();
  const response = await store.fetch("https://monitor-state/images/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "drive-" + file.fileId,
      meter,
      readingId,
      value: null,
      identity: null,
      imageBase64: "",
      driveFileId: file.fileId,
      driveUrl: file.webViewLink ?? "https://drive.google.com/file/d/" + file.fileId + "/view",
      filename: file.name,
      captureDatetime,
      mimeType: file.mimeType,
      matchStatus: status,
    }),
  });
  if (!response.ok) throw new Error("Could not save image " + file.name + " (" + response.status + ").");
}

export type ImageBankScanResult = {
  scanned: number;
  imported: number;
  matched: number;
  review: number;
  unmatched: number;
  errors: string[];
};

export const scanMeterImageBank = createServerFn({ method: "POST" })
  .handler(async (): Promise<ImageBankScanResult> => {
    const dataResponse = await monitorStore().fetch("https://monitor-state/data");
    if (!dataResponse.ok) throw new Error("Could not load readings for image matching.");
    const dataBody = await dataResponse.json() as { payload?: { readings?: Reading[] } | null };
    const readings = Array.isArray(dataBody.payload?.readings) ? dataBody.payload!.readings! : [];
    const files = await listImageBank();

    let imported = 0;
    let matched = 0;
    let review = 0;
    let unmatched = 0;
    const errors: string[] = [];

    for (const file of files) {
      const captureDatetime = timestampFromName(file.name) ?? (file.createdTime ? Date.parse(file.createdTime) : null);
      const meter = meterFromPath(file.folderPath ?? []);
      const candidate = captureDatetime == null ? null : nearestReading(readings, captureDatetime);
      const canMatch = Boolean(candidate && meter !== "unknown");
      const status = canMatch ? "matched" : candidate ? "review" : "unmatched";
      try {
        await saveImportedImage(file, meter, candidate?.id ?? null, captureDatetime, status);
        imported++;
        if (status === "matched") matched++;
        else if (status === "review") review++;
        else unmatched++;
      } catch (error) {
        errors.push(file.name + ": " + (error instanceof Error ? error.message : "save failed"));
      }
    }

    return { scanned: files.length, imported, matched, review, unmatched, errors };
  });
