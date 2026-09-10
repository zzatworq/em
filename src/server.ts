import handler from "@tanstack/react-start/server-entry";

// Cloudflare provisions Durable Object classes that are exported from the
// Worker entrypoint. Keeping this export here lets TanStack Start continue to
// own request handling while the monitor gets durable server-side storage.
export { MonitorState } from "./lib/monitor-state-do";

export default {
  fetch: handler.fetch,
};
