import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { uploadReadingImage } from "@/lib/storage/google-drive";

type Meter = "m1" | "m2";

type MonitorBinding = {
  idFromName(name: string): { readonly name?: string };
  get(id: { readonly name?: string }): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

function monitorStore() {
  const binding = (env as unknown as { MONITOR_STATE?: MonitorBinding }).MONITOR_STATE;
  if (!binding) throw new Error("Cloudflare MONITOR_STATE binding is missing.");
  return binding.get(binding.idFromName("default"));
}

export type MeterImageReference = {
  id: string;
  meter: Meter;
  readingId: string | null;
  value: number | null;
  identity: string | null;
  imageBase64: string;
  driveFileId: string | null;
  driveUrl: string | null;
};

export const saveMeterImage = createServerFn({ method: "POST" })
  .validator((data: {
    id: string;
    meter: Meter;
    readingId: string;
    value?: number | null;
    identity?: string | null;
    imageBase64: string;
    mimeType?: string;
  }) => data)
  .handler(async ({ data }) => {
    const drive = await uploadReadingImage({
      meter: data.meter,
      readingId: data.readingId,
      value: data.value ?? null,
      imageBase64: data.imageBase64,
      mimeType: data.mimeType,
    });

    const response = await monitorStore().fetch("https://monitor-state/images/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: data.id,
        meter: data.meter,
        readingId: data.readingId,
        value: data.value ?? null,
        identity: data.identity ?? null,
        driveFileId: drive.fileId,
        driveUrl: drive.url,
      }),
    });
    if (!response.ok) throw new Error(`Reading image metadata save failed (${response.status})`);
    return { ok: true, ...drive };
  });

export const loadMeterImageReferences = createServerFn({ method: "GET" })
  .handler(async (): Promise<MeterImageReference[]> => {
    const response = await monitorStore().fetch("https://monitor-state/images/references?limit=1000");
    if (!response.ok) throw new Error(`Meter image references failed (${response.status})`);
    const body = await response.json() as { images?: MeterImageReference[] };
    return Array.isArray(body.images) ? body.images : [];
  });

export const loadMeterIdentities = createServerFn({ method: "GET" })
  .handler(async (): Promise<Array<{ meter: Meter; identity: string; value: number | null }>> => {
    const response = await monitorStore().fetch("https://monitor-state/images/identities");
    if (!response.ok) throw new Error(`Meter identities failed (${response.status})`);
    const body = await response.json() as { images?: Array<{ meter: Meter; identity: string; value: number | null }> };
    return Array.isArray(body.images) ? body.images : [];
  });
