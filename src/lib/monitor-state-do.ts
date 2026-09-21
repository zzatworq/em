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
        image_base64 TEXT NOT NULL DEFAULT '',
        drive_file_id TEXT,
        image_created_at INTEGER,
        status TEXT NOT NULL DEFAULT 'attached',
        created_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS idx_meter_images_meter_created ON meter_images(meter, created_at DESC)"
    );
    const columns = this.ctx.storage.sql.exec("PRAGMA table_info(meter_images)").toArray() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("drive_file_id")) this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN drive_file_id TEXT");
    if (!names.has("image_created_at")) this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN image_created_at INTEGER");
    if (!names.has("status")) this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN status TEXT NOT NULL DEFAULT 'attached'")
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
        imageBase64?: string;
        driveFileId?: string | null;
        imageCreatedAt?: number | null;
        status?: "attached" | "unrelated";
      };

      if (!/^[-_a-zA-Z0-9]{1,80}$/.test(body.id) || (body.meter !== "m1" && body.meter !== "m2")) {
        return new Response("Invalid image metadata", { status: 400 });
      }
      if (body.imageBase64 && body.imageBase64.length > 1_800_000) {
        return new Response("Image is too large", { status: 413 });
      }
      if (!body.imageBase64 && !body.driveFileId) return new Response("Image storage reference is missing", { status: 400 });

      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO meter_images
          (id, meter, reading_id, value, identity, image_base64, drive_file_id, image_created_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        body.id,
        body.meter,
        body.readingId ?? null,
        body.value ?? null,
        body.identity ?? null,
        body.imageBase64 ?? "",
        body.driveFileId ?? null,
        body.imageCreatedAt ?? null,
        body.status ?? "attached",
        Date.now(),
      );
      return Response.json({ ok: true });
    }

    if (url.pathname === "/images/list" && method === "GET") {
      const rows = this.ctx.storage.sql.exec(
        `SELECT id, meter, reading_id AS readingId, value, identity, drive_file_id AS driveFileId, image_created_at AS imageCreatedAt, status, created_at AS createdAt
         FROM meter_images ORDER BY COALESCE(image_created_at, created_at) DESC LIMIT 1000`
      ).toArray();
      return Response.json({ images: rows });
    }

    if (url.pathname === "/images/attach" && method === "POST") {
      const body = await request.json() as { id: string; readingId?: string | null; status?: "attached" | "unrelated" };
      this.ctx.storage.sql.exec("UPDATE meter_images SET reading_id = ?, status = ? WHERE id = ?", body.readingId ?? null, body.status ?? (body.readingId ? "attached" : "unrelated"), body.id);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/images/delete" && method === "POST") {
      const body = await request.json() as { id: string };
      this.ctx.storage.sql.exec("DELETE FROM meter_images WHERE id = ?", body.id);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/drive/token" && method === "GET") {
      return Response.json({ refreshToken: await this.ctx.storage.get<string>("drive_refresh_token") ?? null });
    }
    if (url.pathname === "/drive/token" && method === "PUT") {
      const body = await request.json() as { refreshToken: string };
      await this.ctx.storage.put("drive_refresh_token", body.refreshToken);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/drive/folder" && method === "GET") {
      return Response.json({ folderId: await this.ctx.storage.get<string>("drive_folder_id") ?? null });
    }
    if (url.pathname === "/drive/folder" && method === "PUT") {
      const body = await request.json() as { folderId: string };
      await this.ctx.storage.put("drive_folder_id", body.folderId);
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
