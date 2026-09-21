import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { withGrokPwaChrome } from "./lib/grok-pwa-worker";
import { env } from "cloudflare:workers";

// Cloudflare provisions Durable Object classes that are exported from the
// Worker entrypoint. Keeping this export here lets TanStack Start continue to
// own request handling while the monitor gets durable server-side storage.
export { MonitorState } from "./lib/monitor-state-do";

// Use TanStack Start's server-entry wrapper so SSR, server functions, and
// Cloudflare's fetch lifecycle all use the framework's supported entry shape.
// withGrokPwaChrome serves the install page / manifest and injects OG tags —
// see src/lib/grok-pwa-worker.ts for why this can't live in server/ (Nitro
// middleware, which never runs under this app's Cloudflare Workers deploy).

const GOOGLE_DRIVE_REDIRECT_URI = "https://em.zzatworq.workers.dev/api/drive/callback";

async function driveStateStore(path: string, init?: RequestInit) {
  const binding = (env as unknown as { MONITOR_STATE?: { idFromName(name: string): { readonly name?: string }; get(id: { readonly name?: string }): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } } }).MONITOR_STATE;
  if (!binding) throw new Error("Cloudflare MONITOR_STATE binding is missing.");
  return binding.get(binding.idFromName("default")).fetch(`https://monitor-state${path}`, init);
}

async function handleDriveOAuth(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/drive/connect" && request.method === "GET") {
    const clientId = env.GOOGLE_CLIENT_ID;
    if (!clientId) return new Response("Google Drive is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets.", { status: 503 });
    const state = crypto.randomUUID();
    await driveStateStore("/drive/oauth-state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state, expiresAt: Date.now() + 10 * 60_000 }) });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: GOOGLE_DRIVE_REDIRECT_URI,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: "https://www.googleapis.com/auth/drive.file",
      state,
    });
    return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
  }

  if (url.pathname === "/api/drive/callback" && request.method === "GET") {
    const error = url.searchParams.get("error");
    if (error) return Response.redirect("https://em.zzatworq.workers.dev/readings?drive=error", 302);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return new Response("Missing Google OAuth callback parameters.", { status: 400 });
    const saved = await driveStateStore("/drive/oauth-state");
    const stateBody = saved.ok ? await saved.json() as { state?: string; expiresAt?: number } : {};
    if (state !== stateBody.state || !stateBody.expiresAt || stateBody.expiresAt < Date.now()) return new Response("Invalid or expired Google OAuth state.", { status: 400 });
    await driveStateStore("/drive/oauth-state", { method: "DELETE" });
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return new Response("Google Drive is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets.", { status: 503 });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: GOOGLE_DRIVE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) return new Response("Google authorization failed. Please try connecting again.", { status: 502 });
    const tokens = await tokenResponse.json() as { refresh_token?: string };
    if (!tokens.refresh_token) return new Response("Google did not return a refresh token. Reconnect and approve Drive access.", { status: 502 });
    await driveStateStore("/drive/token", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: tokens.refresh_token }) });
    return Response.redirect("https://em.zzatworq.workers.dev/readings?drive=connected", 302);
  }

  return null;
}

export default createServerEntry({
  async fetch(request) {
    const driveResponse = await handleDriveOAuth(request);
    if (driveResponse) return driveResponse;
    return withGrokPwaChrome(request, () => Promise.resolve(handler.fetch(request)));
  },
});
