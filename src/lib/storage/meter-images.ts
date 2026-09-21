import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { loadDriveImage, uploadDriveImage } from "./google-drive";

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
  value: number | null;
  identity: string | null;
  imageBase64: string;
  driveFileId?: string | null;
};

export type MeterImage = {
  id: string;
  meter: Meter;
  readingId: string | null;
  value: number | null;
  identity: string | null;
  driveFileId: string | null;
  imageCreatedAt: number | null;
  status: "attached" | "unrelated";
  createdAt: number;
};

export const saveMeterImage = createServerFn({ method: "POST" })
  .validator((data: {
    id: string; meter: Meter; readingId?: string | null; value?: number | null;
    identity?: string | null; imageBase64?: string; driveFileId?: string | null;
    imageCreatedAt?: number | null; status?: "attached" | "unrelated";
  }) => data)
  .handler(async ({ data }) => {
    let driveFileId = data.driveFileId ?? null;
    if (!driveFileId && data.imageBase64) {
      const uploaded = await uploadDriveImage({ data: {
        name: `meter-${data.meter}-${data.imageCreatedAt ?? Date.now()}-${data.id}.jpg`,
        mimeType: "image/jpeg",
        imageBase64: data.imageBase64,
      }});
      driveFileId = uploaded.id;
    }
    if (!driveFileId) throw new Error("Image could not be stored in Google Drive.");
    const response = await monitorStore().fetch("https://monitor-state/images/save", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...data, imageBase64: "", driveFileId }),
    });
    if (!response.ok) throw new Error(`Meter image save failed (${response.status})`);
    return { ok: true, driveFileId };
  });

export const listMeterImages = createServerFn({ method: "GET" })
  .handler(async (): Promise<MeterImage[]> => {
    const response = await monitorStore().fetch("https://monitor-state/images/list");
    if (!response.ok) throw new Error(`Meter image list failed (${response.status})`);
    const body = await response.json() as { images?: MeterImage[] };
    return Array.isArray(body.images) ? body.images : [];
  });

export const attachMeterImage = createServerFn({ method: "POST" })
  .validator((data: { id: string; readingId?: string | null; status?: "attached" | "unrelated" }) => data)
  .handler(async ({ data }) => {
    const response = await monitorStore().fetch("https://monitor-state/images/attach", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`Meter image attachment failed (${response.status})`);
    return { ok: true };
  });

export const deleteMeterImage = createServerFn({ method: "POST" })
  .validator((data: { id: string; driveFileId?: string | null }) => data)
  .handler(async ({ data }) => {
    if (data.driveFileId) {
      try { await (await import("./google-drive")).trashDriveImage({ data: { id: data.driveFileId } }); } catch {}
    }
    const response = await monitorStore().fetch("https://monitor-state/images/delete", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: data.id }),
    });
    if (!response.ok) throw new Error(`Meter image delete failed (${response.status})`);
    return { ok: true };
  });

export const loadMeterImageReferences = createServerFn({ method: "GET" })
  .handler(async (): Promise<MeterImageReference[]> => {
    const response = await monitorStore().fetch("https://monitor-state/images/references?limit=3");
    if (!response.ok) throw new Error(`Meter image references failed (${response.status})`);
    const body = await response.json() as { images?: Array<MeterImageReference> };
    const refs = Array.isArray(body.images) ? body.images : [];
    const result: MeterImageReference[] = [];
    for (const ref of refs) {
      if (ref.imageBase64) { result.push(ref); continue; }
      if (ref.driveFileId) {
        try {
          const image = await loadDriveImage({ data: { id: ref.driveFileId } });
          result.push({ ...ref, imageBase64: image.base64 });
        } catch {}
      }
    }
    return result;
  });

export const loadMeterIdentities = createServerFn({ method: "GET" })
  .handler(async (): Promise<Array<{ meter: Meter; identity: string; value: number | null }>> => {
    const response = await monitorStore().fetch("https://monitor-state/images/identities");
    if (!response.ok) throw new Error(`Meter identities failed (${response.status})`);
    const body = await response.json() as { images?: Array<{ meter: Meter; identity: string; value: number | null }> };
    return Array.isArray(body.images) ? body.images : [];
  });
