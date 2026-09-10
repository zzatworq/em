import { DurableObject } from "cloudflare:workers";

/**
 * One globally consistent store for the monitor's JSON state.
 *
 * The application has one logical dataset, so a single named Durable Object is
 * enough. SQLite-backed Durable Objects are provisioned by Wrangler and provide
 * durable storage without requiring a database URL or a database ID in CI.
 */
export class MonitorState extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const method = request.method.toUpperCase();

    if (method === "GET") {
      const payload = await this.ctx.storage.get<string>("payload");
      return Response.json({ payload: payload ? JSON.parse(payload) : null });
    }

    if (method === "PUT") {
      const body = await request.json();
      await this.ctx.storage.put("payload", JSON.stringify(body));
      return Response.json({ payload: body });
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, PUT" },
    });
  }
}
