import { DurableObject } from "cloudflare:workers";

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
    const columns = this.ctx.storage.sql.exec("PRAGMA table_info(meter_images)").toArray() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("drive_file_id")) this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN drive_file_id TEXT");
    if (!names.has("image_created_at")) this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN image_created_at INTEGER");
    if (!names.has("status")) this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN status TEXT NOT NULL DEFAULT 'attached'");
  }

  async fetch(request: Request): Promise<Response> {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    if (url.pathname === "/images/save" && method === "POST") {
      const body = await request.json() as { id: string; meter: "m1" | "m2"; readingId?: string | null; value?: number | null; identity?: string | null; imageBase64?: string; driveFileId?: string | null; imageCreatedAt?: number | null; status?: "attached" | "review" | "unrelated" };
      if (!/^[-_a-zA-Z0-9]{1,100}$/.test(body.id) || !["m1","m2"].includes(body.meter)) return new Response("Invalid image metadata", { status: 400 });
      if (body.imageBase64 && body.imageBase64.length > 1_800_000) return new Response("Image is too large", { status: 413 });
      if (!body.imageBase64 && !body.driveFileId) return new Response("Image storage reference is missing", { status: 400 });
      this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO meter_images
        (id, meter, reading_id, value, identity, image_base64, drive_file_id, image_created_at, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        body.id, body.meter, body.readingId ?? null, body.value ?? null, body.identity ?? null,
        body.imageBase64 ?? "", body.driveFileId ?? null, body.imageCreatedAt ?? null,
        body.status ?? "attached", Date.now());
      return Response.json({ ok: true });
    }

    if (url.pathname === "/images/list" && method === "GET") {
      const rows = this.ctx.storage.sql.exec(`SELECT id, meter, reading_id AS readingId, value, identity,
        drive_file_id AS driveFileId, image_base64 AS imageBase64, image_created_at AS imageCreatedAt, status, created_at AS createdAt
        FROM meter_images ORDER BY COALESCE(image_created_at, created_at) DESC LIMIT 5000`).toArray();
      return Response.json({ images: rows });
    }

    if (url.pathname === "/images/attach" && method === "POST") {
      const body = await request.json() as { id: string; meter?: "m1" | "m2"; readingId?: string | null; status?: "attached" | "review" | "unrelated" };
      this.ctx.storage.sql.exec("UPDATE meter_images SET meter = COALESCE(?, meter), reading_id = ?, status = ? WHERE id = ?",
        body.meter ?? null, body.readingId ?? null, body.status ?? (body.readingId ? "attached" : "unrelated"), body.id);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/images/delete" && method === "POST") {
      const body = await request.json() as { id: string };
      this.ctx.storage.sql.exec("DELETE FROM meter_images WHERE id = ?", body.id);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/images/references" && method === "GET") {
      const limit = Math.max(1, Math.min(5, Number(url.searchParams.get("limit") ?? "3")));
      const rows = this.ctx.storage.sql.exec(`SELECT id, meter, value, identity, image_base64 AS imageBase64, drive_file_id AS driveFileId
        FROM meter_images WHERE identity IS NOT NULL AND TRIM(identity) <> ''
        ORDER BY created_at DESC LIMIT ?`, limit * 2).toArray();
      return Response.json({ images: rows });
    }

    if (url.pathname === "/images/identities" && method === "GET") {
      const rows = this.ctx.storage.sql.exec(`SELECT meter, identity, value FROM meter_images
        WHERE identity IS NOT NULL AND TRIM(identity) <> '' ORDER BY created_at DESC LIMIT 100`).toArray();
      return Response.json({ images: rows });
    }

    if (url.pathname === "/drive/oauth-state" && method === "GET") return Response.json(await this.ctx.storage.get("drive_oauth_state") ?? null);
    if (url.pathname === "/drive/oauth-state" && method === "PUT") {
      const body = await request.json() as { state: string; expiresAt: number };
      if (!body.state || !Number.isFinite(body.expiresAt)) return new Response("Invalid OAuth state", { status: 400 });
      await this.ctx.storage.put("drive_oauth_state", JSON.stringify(body)); return Response.json({ ok: true });
    }
    if (url.pathname === "/drive/oauth-state" && method === "DELETE") { await this.ctx.storage.delete("drive_oauth_state"); return Response.json({ ok: true }); }
    if (url.pathname === "/drive/token" && method === "GET") return Response.json({ refreshToken: await this.ctx.storage.get<string>("drive_refresh_token") ?? null });
    if (url.pathname === "/drive/token" && method === "PUT") {
      const body = await request.json() as { refreshToken: string };
      await this.ctx.storage.put("drive_refresh_token", body.refreshToken); return Response.json({ ok: true });
    }
    if (url.pathname === "/drive/folders" && method === "PUT") {
      const body = await request.json() as Record<string,string>;
      await this.ctx.storage.put("drive_folders", JSON.stringify(body)); return Response.json({ ok: true });
    }
    if (url.pathname === "/drive/folders" && method === "GET") return Response.json(JSON.parse(await this.ctx.storage.get<string>("drive_folders") ?? "null"));

    if (method === "GET" && url.pathname === "/data") {
      const payload = await this.ctx.storage.get<string>("payload"); return Response.json({ payload: payload ? JSON.parse(payload) : null });
    }
    if (method === "PUT" && url.pathname === "/data") {
      const body = await request.json(); await this.ctx.storage.put("payload", JSON.stringify(body)); return Response.json({ payload: body });
    }
    return new Response("Not Found", { status: 404 });
  }
}
