import { createFileRoute } from "@tanstack/react-router";
import { getDriveImage } from "@/lib/storage/google-drive";

export const Route = createFileRoute("/api/drive/image/$fileId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const image = await getDriveImage(params.fileId);
          const headers = new Headers({
            "content-type": image.contentType,
            "cache-control": "private, max-age=300",
          });
          if (image.contentLength) headers.set("content-length", image.contentLength);
          return new Response(image.body, { headers });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : "Image unavailable.", { status: 404 });
        }
      },
    },
  },
});
