import { env } from "cloudflare:workers";

type DurableObjectId = { readonly name?: string };
type DurableObjectStub = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
type MonitorBinding = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): DurableObjectStub };

const DRIVE_ROOT_ID = "1u4b7Oo5VAqLqkPqU7W5sax2JMnMyJur";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

function monitorStore(): DurableObjectStub {
  const binding = (env as unknown as { MONITOR_STATE?: MonitorBinding }).MONITOR_STATE;
  if (!binding) throw new Error("Cloudflare MONITOR_STATE binding is missing.");
  return binding.get(binding.idFromName("default"));
}

function googleConfig(): { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string } {
  const e = env as unknown as { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google Drive is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
  return {
    GOOGLE_CLIENT_ID: e.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: e.GOOGLE_CLIENT_SECRET,
  };
}

export function googleDriveRedirectUri(request: Request) {
  return new URL("/api/drive/callback", request.url).toString();
}

export async function createGoogleDriveAuthorizationUrl(request: Request) {
  const { GOOGLE_CLIENT_ID } = googleConfig();
  const state = crypto.randomUUID();
  const response = await monitorStore().fetch("https://monitor-state/google/state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, createdAt: Date.now() }),
  });
  if (!response.ok) throw new Error("Could not start Google Drive authorization.");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", googleDriveRedirectUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function finishGoogleDriveAuthorization(request: Request) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = googleConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw new Error("Google authorization response is incomplete.");

  const stateResponse = await monitorStore().fetch("https://monitor-state/google/state");
  if (!stateResponse.ok) throw new Error("Google authorization state was not found.");
  const saved = await stateResponse.json() as { state?: string; createdAt?: number };
  if (!saved.state || saved.state !== state || !saved.createdAt || Date.now() - saved.createdAt > 10 * 60 * 1000) {
    throw new Error("Google authorization state is invalid or expired.");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: googleDriveRedirectUri(request),
      grant_type: "authorization_code",
    }),
  });
  const tokenBody = await tokenResponse.json() as { refresh_token?: string; access_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error("Google token exchange failed: " + (tokenBody.error ?? tokenResponse.status));
  }

  const current = await monitorStore().fetch("https://monitor-state/google/token");
  const previous = current.ok ? await current.json() as { refreshToken?: string } : {};
  const refreshToken = tokenBody.refresh_token ?? previous.refreshToken;
  if (!refreshToken) throw new Error("Google did not return a refresh token. Re-authorize the Google client with offline access.");

  const saveResponse = await monitorStore().fetch("https://monitor-state/google/token", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!saveResponse.ok) throw new Error("Could not store the Google Drive authorization.");
  return tokenBody.access_token;
}

async function getAccessToken(): Promise<string> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = googleConfig();
  const response = await monitorStore().fetch("https://monitor-state/google/token");
  if (!response.ok) throw new Error("Google Drive is not connected. Open /api/drive/connect first.");
  const token = await response.json() as { refreshToken?: string };
  if (!token.refreshToken) throw new Error("Google Drive is not connected. Open /api/drive/connect first.");

  const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: token.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await refreshResponse.json() as { access_token?: string; error?: string };
  if (!refreshResponse.ok || !body.access_token) {
    throw new Error("Google Drive token refresh failed: " + (body.error ?? refreshResponse.status));
  }
  return body.access_token;
}

async function driveRequest(path: string, init: RequestInit = {}) {
  const accessToken = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + accessToken);
  headers.set("Accept", "application/json");
  return fetch("https://www.googleapis.com/drive/v3/" + path, { ...init, headers });
}

async function driveUploadRequest(path: string, init: RequestInit = {}) {
  const accessToken = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + accessToken);
  headers.set("Accept", "application/json");
  return fetch("https://www.googleapis.com/upload/drive/v3/" + path, { ...init, headers });
}

async function findOrCreateFolder(name: string, parentId: string): Promise<string> {
  const escaped = name.replace(/'/g, "\'");
  const q = encodeURIComponent("'"+parentId+"' in parents and name = '"+escaped+"' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const list = await driveRequest("files?q=" + q + "&pageSize=10&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true");
  const body = await list.json() as { files?: Array<{ id?: string }> };
  if (!list.ok) throw new Error("Google Drive folder lookup failed (" + list.status + ").");
  const existing = body.files?.find((file) => file.id);
  if (existing?.id) return existing.id;

  const create = await driveRequest("files?supportsAllDrives=true&fields=id,name", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const created = await create.json() as { id?: string };
  if (!create.ok || !created.id) throw new Error("Google Drive folder creation failed (" + create.status + ").");
  return created.id;
}

async function meterFolder(meter: "m1" | "m2") {
  const root = await findOrCreateFolder("Meter Readings", DRIVE_ROOT_ID);
  return findOrCreateFolder(meter === "m1" ? "Meter 1" : "Meter 2", root);
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function multipartBody(metadata: unknown, mimeType: string, bytes: Uint8Array) {
  const boundary = "emonitor-" + crypto.randomUUID();
  const encoder = new TextEncoder();
  const head = encoder.encode("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + "\r\n--" + boundary + "\r\nContent-Type: " + mimeType + "\r\n\r\n");
  const tail = encoder.encode("\r\n--" + boundary + "--");
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { body, boundary };
}

export async function uploadReadingImage(data: {
  meter: "m1" | "m2";
  readingId: string;
  value: number | null;
  imageBase64: string;
  mimeType?: string;
}) {
  const parentId = await meterFolder(data.meter);
  const mimeType = data.mimeType === "image/png" ? "image/png" : "image/jpeg";
  const extension = mimeType === "image/png" ? "png" : "jpg";
  const name = "reading-" + data.readingId + "-" + (data.value ?? "unknown") + "." + extension;
  const { body, boundary } = multipartBody(
    { name, parents: [parentId], description: "Electricity meter reading " + data.readingId },
    mimeType,
    base64Bytes(data.imageBase64),
  );

  const response = await driveUploadRequest("files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink", {
    method: "POST",
    headers: { "content-type": "multipart/related; boundary=" + boundary },
    body,
  });
  const file = await response.json() as { id?: string; name?: string; webViewLink?: string; webContentLink?: string };
  if (!response.ok || !file.id) throw new Error("Google Drive image upload failed (" + response.status + ").");

  return {
    fileId: file.id,
    name: file.name ?? name,
    url: file.webViewLink ?? "https://drive.google.com/file/d/" + file.id + "/view",
    downloadUrl: file.webContentLink ?? null,
  };
}
