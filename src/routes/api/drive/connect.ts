import { createFileRoute } from "@tanstack/react-router";
import { createGoogleDriveAuthorizationUrl } from "@/lib/storage/google-drive";

export const Route = createFileRoute("/api/drive/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => Response.redirect(await createGoogleDriveAuthorizationUrl(request), 302),
    },
  },
});
