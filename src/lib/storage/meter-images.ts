import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

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
};

export const saveMeterImage = createServerFn({ method: "POST" })
  .validator((data: {
    id: string;
    meter: Meter;
    readingId?: string;
    value?: number | null;
    identity?: string | null;
    imageBase64: string;
  }) => data)
  .handler(async ({ data }) => {
    const response = await monitorStore().fetch("https://monitor-state/images/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`Meter image save failed (${response.status})`);
    return { ok: true };
  });

export const loadMeterImageReferences = createServerFn({ method: "GET" })
  .handler(async (): Promise<MeterImageReference[]> => {
    const response = await monitorStore().fetch("https://monitor-state/images/references?limit=3");
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
