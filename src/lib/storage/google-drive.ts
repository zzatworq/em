import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

type MonitorBinding = {
  idFromName(name: string): { readonly name?: string };
  get(id: { readonly name?: string }): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

function monitorStore() {
  const binding = (env as unknown as { MONITOR_STATE?: MonitorBinding }).MONITOR_STATE;
  if (!binding) throw new Error("Cloudflare MONITOR_STATE binding is missing.");
  return binding.get(binding.idFromName("default"));
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

async function getRefreshToken() {
  const response = await monitorStore().fetch("https://monitor-state/drive/token");
  if (!response.ok) return null;
  const body = await response.json() as { refreshToken?: string | null };
  return body.refreshToken ?? null;
}

async function accessToken() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) throw new Error("Google Drive is not connected. Connect Google Drive first.");
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Drive OAuth secrets are not configured.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!response.ok) throw new Error("Google Drive authorization has expired or was revoked. Reconnect Google Drive.");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Google Drive did not return an access token.");
  return body.access_token;
}

async function driveRequest(path: string, init?: RequestInit) {
  const token = await accessToken();
  return fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
}

async function findFolder(name: string, parentId: string) {
  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false and '${parentId}' in parents`);
  const response = await driveRequest(`/files?q=${q}&pageSize=1&fields=files(id,name,mimeType,parents)`);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Could not access Google Drive (HTTP ${response.status}). ${detail.slice(0, 300)}`);
  }
  const body = await response.json() as { files?: Array<{ id: string; name: string; mimeType: string }> };
  return body.files?.[0]?.id ?? null;
}

async function createFolder(name: string, parentId: string) {
  const response = await driveRequest("/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Could not create the ${name} folder in Google Drive (HTTP ${response.status}). ${detail.slice(0, 300)}`);
  }
  const body = await response.json() as { id?: string };
  if (!body.id) throw new Error("Google Drive did not return the folder ID.");
  return body.id;
}

async function ensureFolder(name: string, parentId: string) {
  return (await findFolder(name, parentId)) ?? createFolder(name, parentId);
}

async function dataFolders() {
  const root = "root";
  let data = await findFolder("EM_DATA", root);
  if (!data) {
    // Reuse the old app-created folder instead of leaving two storage roots.
    const old = await findFolder("Meter Images", root);
    if (old) {
      const renamed = await driveRequest(`/files/${encodeURIComponent(old)}?fields=id,name`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "EM_DATA" }),
      });
      if (!renamed.ok) throw new Error("Could not rename the existing Meter Images folder to EM_DATA.");
      data = old;
    }
  }
  if (!data) data = await createFolder("EM_DATA", root);
  const readings = await ensureFolder("Meter Readings", data);
  const meter1 = await ensureFolder("Meter 1", readings);
  const meter2 = await ensureFolder("Meter 2", readings);
  const unrelated = await ensureFolder("Unrelated", readings);
  await monitorStore().fetch("https://monitor-state/drive/folders", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data, readings, meter1, meter2, unrelated }),
  });
  return { data, readings, meter1, meter2, unrelated };
}

async function targetFolder(meter: "m1" | "m2", status: "attached" | "unrelated") {
  const folders = await dataFolders();
  if (status === "unrelated") return folders.unrelated;
  return meter === "m1" ? folders.meter1 : folders.meter2;
}

function base64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type DriveImage = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string | null;
  modifiedTime: string | null;
  size: string | null;
  webViewLink?: string | null;
};

export const driveStatus = createServerFn({ method: "GET" }).handler(async () => {
  const response = await monitorStore().fetch("https://monitor-state/drive/token");
  if (!response.ok) return { connected: false };
  const body = await response.json() as { refreshToken?: string | null };
  return { connected: Boolean(body.refreshToken) };
});

export const driveFolderInfo = createServerFn({ method: "GET" }).handler(async () => {
  const folders = await dataFolders();
  return {
    id: folders.data,
    name: "EM_DATA",
    url: `https://drive.google.com/drive/folders/${encodeURIComponent(folders.data)}`,
  };
});

export const uploadDriveImage = createServerFn({ method: "POST" })
  .validator((data: { name: string; mimeType: string; imageBase64: string; meter?: "m1" | "m2"; status?: "attached" | "unrelated" }) => data)
  .handler(async ({ data }) => {
    const parent = await targetFolder(data.meter ?? "m1", data.status ?? "attached");
    const boundary = `em-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name: data.name, mimeType: data.mimeType || "image/jpeg", parents: [parent] });
    const media = base64Bytes(data.imageBase64);
    const encoder = new TextEncoder();
    const head = encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${data.mimeType || "image/jpeg"}\r\n\r\n`);
    const tail = encoder.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + media.length + tail.length);
    body.set(head, 0); body.set(media, head.length); body.set(tail, head.length + media.length);
    const response = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,createdTime,modifiedTime,size,webViewLink`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!response.ok) throw new Error(`Google Drive upload failed (${response.status}).`);
    return await response.json() as DriveImage;
  });

export const moveDriveImage = createServerFn({ method: "POST" })
  .validator((data: { id: string; meter: "m1" | "m2"; status: "attached" | "unrelated" }) => data)
  .handler(async ({ data }) => {
    const parent = await targetFolder(data.meter, data.status);
    const current = await driveRequest(`/files/${encodeURIComponent(data.id)}?fields=parents`);
    if (!current.ok) throw new Error(`Google Drive image lookup failed (${current.status}).`);
    const body = await current.json() as { parents?: string[] };
    const oldParents = (body.parents ?? []).filter((id) => id !== parent);
    const query = new URLSearchParams({ addParents: parent, fields: "id,parents" });
    if (oldParents.length) query.set("removeParents", oldParents.join(","));
    const response = await driveRequest(`/files/${encodeURIComponent(data.id)}?${query.toString()}`, { method: "PATCH" });
    if (!response.ok) throw new Error(`Google Drive image move failed (${response.status}).`);
    return { ok: true };
  });

export const listDriveImages = createServerFn({ method: "GET" }).handler(async (): Promise<DriveImage[]> => {
  const folders = await dataFolders();
  const q = encodeURIComponent(`'${folders.readings}' in parents and trashed = false and mimeType contains 'image/'`);
  const response = await driveRequest(`/files?q=${q}&pageSize=1000&orderBy=modifiedTime desc&fields=files(id,name,mimeType,createdTime,modifiedTime,size,webViewLink)`);
  if (!response.ok) throw new Error(`Google Drive image list failed (${response.status}).`);
  const body = await response.json() as { files?: DriveImage[] };
  return body.files ?? [];
});

export const loadDriveImage = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const response = await driveRequest(`/files/${encodeURIComponent(data.id)}?alt=media`);
    if (!response.ok) throw new Error(`Google Drive image download failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    return { base64: btoa(binary), mimeType: response.headers.get("content-type") ?? "image/jpeg" };
  });

export const trashDriveImage = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const response = await driveRequest(`/files/${encodeURIComponent(data.id)}?supportsAllDrives=true`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error(`Google Drive delete failed (${response.status}).`);
    return { ok: true };
  });

export { DRIVE_SCOPE };
