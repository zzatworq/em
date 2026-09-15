/**
 * Cloudflare Workers half of the platform PWA chrome.
 *
 * `server/middleware/grok-pwa.ts` implements the same behavior for Nitro, but
 * this app deploys to Cloudflare Workers (see wrangler.jsonc) via
 * `@cloudflare/vite-plugin`, which never loads Nitro — Nitro is what scans
 * `server/` for h3 middleware, and it isn't part of this build at all. That
 * left the install-page / manifest / OG-tag-injection feature silently dead
 * in production. This file re-implements it directly against the standard
 * Fetch API (Request/Response/TransformStream), so it runs inside the actual
 * Worker `fetch` handler in `src/server.ts`.
 *
 * - `?install=1&platform=ios` on a document path → the Home Screen tutorial.
 * - `/__grok/manifest.webmanifest` → per-app-named manifest.
 * - Other HTML documents → stream-inject PWA + OG head tags at `</head>`.
 *   OG identity is baked via `virtual:grok-og-identity` at `vite build`
 *   (this module has no real filesystem at request time in a Worker).
 */
import installPageTemplate from "../../scripts/install-page.html?raw";
import { grokOgIdentity } from "virtual:grok-og-identity";
import {
  acceptsHtml,
  createHeadInjector,
  isDocumentPath,
  isInstallQuery,
  renderInstallPageHtml,
  renderWebManifest,
} from "../../scripts/grok-pwa-shared.mjs";

function requestHost(request: Request, url: URL): string {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
}

function injectHeadStreaming(response: Response, host: string): Response {
  const injector = createHeadInjector({
    host,
    site: grokOgIdentity.site,
  });
  const transformed = response.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        for (const out of injector.push(chunk)) controller.enqueue(out);
      },
      flush(controller) {
        for (const out of injector.flush()) controller.enqueue(out);
      },
    }),
  );
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Wraps a Worker `fetch` handler with the platform PWA chrome. `next` is only
 * called when this middleware isn't short-circuiting the request itself, and
 * its response is passed through untouched unless it's a streamable HTML
 * document response.
 */
export async function withGrokPwaChrome(
  request: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  if (request.method.toUpperCase() !== "GET") return next();

  const url = new URL(request.url);
  const path = url.pathname;
  const urlWithQuery = path + url.search;

  if (path === "/__grok/manifest.webmanifest" || path === "/__grok/manifest.json") {
    return new Response(renderWebManifest(requestHost(request, url)), {
      headers: {
        "content-type": "application/manifest+json; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }

  if (
    isInstallQuery(urlWithQuery) &&
    isDocumentPath(path) &&
    acceptsHtml(request.headers.get("accept"))
  ) {
    const html = renderInstallPageHtml(installPageTemplate, {
      host: requestHost(request, url),
      url: urlWithQuery,
    });
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }

  if (!isDocumentPath(path)) return next();

  const result = await next();
  if (
    result.body &&
    String(result.headers.get("content-type") ?? "").includes("text/html") &&
    !result.headers.get("content-encoding")
  ) {
    return injectHeadStreaming(result, requestHost(request, url));
  }
  return result;
}
