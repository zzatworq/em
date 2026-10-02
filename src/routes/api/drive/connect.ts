import { createFileRoute } from "@tanstack/react-router";
import { createGoogleDriveAuthorizationUrl } from "@/lib/storage/google-drive";

export const Route = createFileRoute("/api/drive/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { url, state } = await createGoogleDriveAuthorizationUrl(request);
        return new Response(null, {
          status: 302,
          headers: {
            Location: url,
            "Set-Cookie": "google_oauth_state=" + encodeURIComponent(state) + "; Max-Age=600; Path=/api/drive; HttpOnly; Secure; SameSite=Lax",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
