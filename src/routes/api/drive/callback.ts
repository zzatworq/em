import { createFileRoute } from "@tanstack/react-router";
import { finishGoogleDriveAuthorization } from "@/lib/storage/google-drive";

function getCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const prefix = name + "=";
  for (const part of cookieHeader.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

export const Route = createFileRoute("/api/drive/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clearCookie = "google_oauth_state=; Max-Age=0; Path=/api/drive; HttpOnly; Secure; SameSite=Lax";
        try {
          await finishGoogleDriveAuthorization(request, getCookie(request, "google_oauth_state"));
          return new Response(
            "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>Google Drive connected</title><p>Google Drive is connected. You can close this window and return to EM.</p>",
            { headers: { "content-type": "text/html; charset=utf-8", "Set-Cookie": clearCookie, "Cache-Control": "no-store" } },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Google Drive authorization failed.";
          return new Response(
            "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>Google Drive connection failed</title><p>" +
              message.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
              "</p>",
            { status: 400, headers: { "content-type": "text/html; charset=utf-8", "Set-Cookie": clearCookie, "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
