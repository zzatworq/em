import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { withGrokPwaChrome } from "./lib/grok-pwa-worker";

// Cloudflare provisions Durable Object classes that are exported from the
// Worker entrypoint. Keeping this export here lets TanStack Start continue to
// own request handling while the monitor gets durable server-side storage.
export { MonitorState } from "./lib/monitor-state-do";

// Use TanStack Start's server-entry wrapper so SSR, server functions, and
// Cloudflare's fetch lifecycle all use the framework's supported entry shape.
// withGrokPwaChrome serves the install page / manifest and injects OG tags —
// see src/lib/grok-pwa-worker.ts for why this can't live in server/ (Nitro
// middleware, which never runs under this app's Cloudflare Workers deploy).
export default createServerEntry({
  fetch(request) {
    return withGrokPwaChrome(request, () => Promise.resolve(handler.fetch(request)));
  },
});
