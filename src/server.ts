import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

// Cloudflare provisions Durable Object classes that are exported from the
// Worker entrypoint. Keeping this export here lets TanStack Start continue to
// own request handling while the monitor gets durable server-side storage.
export { MonitorState } from "./lib/monitor-state-do";

// Use TanStack Start's server-entry wrapper so SSR, server functions, and
// Cloudflare's fetch lifecycle all use the framework's supported entry shape.
export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
