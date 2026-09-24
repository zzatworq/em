import { createFileRoute } from "@tanstack/react-router";
import { finishGoogleDriveAuthorization } from "@/lib/storage/google-drive";

export const Route = createFileRoute("/api/drive/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await finishGoogleDriveAuthorization(request);
          return new Response(
            "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>Google Drive connected</title><p>Google Drive is connected. You can close this window and return to EM.</p>",
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Google Drive authorization failed.";
          return new Response(
            "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>Google Drive connection failed</title><p>" +
              message.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
              "</p>",
            { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }
      },
    },
  },
});
