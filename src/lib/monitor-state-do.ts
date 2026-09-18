import { DurableObject } from "cloudflare:workers";

/**
 * One globally consistent store for the monitor's JSON state.
 *
 * The application has one logical dataset, so a single named Durable Object is
 * enough. SQLite-backed Durable Objects are provisioned by Wrangler and provide
 * durable storage without requiring a database URL or a database ID in CI.
 */
export class MonitorState extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meter_images (
        id TEXT PRIMARY KEY,
        meter TEXT NOT NULL,
        reading_id TEXT,
        value REAL,
        identity TEXT,
        image_base64 TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS idx_meter_images_meter_created ON meter_images(meter, created_at DESC)"
    );
  }

  async fetch(request: Request): Promise<Response> {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    if (url.pathname === "/images/save" && method === "POST") {
      const body = await request.json() as {
        id: string;
        meter: "m1" | "m2";
        readingId?: string;
        value?: number | null;
        identity?: string | null;
        imageBase64: string;
      };

      if (!/^[-_a-zA-Z0-9]{1,80}$/.test(body.id) || (body.meter !== "m1" && body.meter !== "m2")) {
        return new Response("Invalid image metadata", { status: 400 });
      }
      if (!body.imageBase64 || body.imageBase64.length > 1_800_000) {
        return new Response("Image is too large or empty", { status: 413 });
      }

      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO meter_images
          (id, meter, reading_id, value, identity, image_base64, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        body.id,
        body.meter,
        body.readingId ?? null,
        body.value ?? null,
        body.identity ?? null,
        body.imageBase64,
        Date.now(),
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM meter_images
         WHERE id IN (
           SELECT id FROM meter_images
           ORDER BY created_at DESC
           LIMIT -1 OFFSET 1000
         )`,
      );
      return Response.json({ ok: true });
    }

    if (url.pathname === "/images/references" && method === "GET") {
      const limit = Math.max(1, Math.min(5, Number(url.searchParams.get("limit") ?? "3")));
      const meter1 = this.ctx.storage.sql
        .exec(
          `SELECT id, meter, value, identity, image_base64 AS imageBase64
           FROM meter_images
           WHERE meter = 'm1'
           ORDER BY created_at DESC
           LIMIT ?`,
          limit,
        )
        .toArray();
      const meter2 = this.ctx.storage.sql
        .exec(
          `SELECT id, meter, value, identity, image_base64 AS imageBase64
           FROM meter_images
           WHERE meter = 'm2'
           ORDER BY created_at DESC
           LIMIT ?`,
          limit,
        )
        .toArray();
      return Response.json({ images: [...meter1, ...meter2] });
    }

    if (url.pathname === "/images/identities" && method === "GET") {
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT meter, identity, value
           FROM meter_images
           WHERE identity IS NOT NULL AND TRIM(identity) <> ''
           ORDER BY created_at DESC
           LIMIT 100`,
        )
        .toArray();
      return Response.json({ images: rows });
    }

    if (method === "GET" && url.pathname === "/data") {
      const payload = await this.ctx.storage.get<string>("payload");
      return Response.json({ payload: payload ? JSON.parse(payload) : null });
    }

    if (method === "PUT" && url.pathname === "/data") {
      const body = await request.json();
      await this.ctx.storage.put("payload", JSON.stringify(body));
      return Response.json({ payload: body });
    }

    return new Response("Not Found", {
      status: 404,
      headers: { Allow: "GET, PUT" },
    });
  }
}
