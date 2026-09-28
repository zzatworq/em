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
        drive_url TEXT,
        filename TEXT,
        capture_datetime INTEGER,
        mime_type TEXT,
        match_status TEXT NOT NULL DEFAULT 'unmatched',
        created_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS idx_meter_images_meter_created ON meter_images(meter, created_at DESC)"
    );
    try { this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN drive_file_id TEXT"); } catch {}
    try { this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN drive_url TEXT"); } catch {}
    try { this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN filename TEXT"); } catch {}
    try { this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN capture_datetime INTEGER"); } catch {}
    try { this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN mime_type TEXT"); } catch {}
    try { this.ctx.storage.sql.exec("ALTER TABLE meter_images ADD COLUMN match_status TEXT NOT NULL DEFAULT 'unmatched'"); } catch {}
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_meter_images_reading ON meter_images(reading_id)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_meter_images_capture ON meter_images(capture_datetime)");
  }

  async fetch(request: Request): Promise<Response> {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    if (url.pathname === "/images/save" && method === "POST") {
      const body = await request.json() as {
        id: string;
        meter: "m1" | "m2" | "unknown";
        readingId?: string;
        value?: number | null;
        identity?: string | null;
        imageBase64?: string;
        driveFileId?: string;
        driveUrl?: string;
        filename?: string;
        captureDatetime?: number | null;
        mimeType?: string | null;
        matchStatus?: string;
      };

      if (!/^[-_a-zA-Z0-9]{1,100}$/.test(body.id) || (body.meter !== "m1" && body.meter !== "m2" && body.meter !== "unknown")) {
        return new Response("Invalid image metadata", { status: 400 });
      }
      if (!body.driveFileId || !body.driveUrl) {
        return new Response("Drive image metadata is required", { status: 400 });
      }

      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO meter_images
          (id, meter, reading_id, value, identity, image_base64, drive_file_id, drive_url, filename, capture_datetime, mime_type, match_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        body.id,
        body.meter,
        body.readingId ?? null,
        body.value ?? null,
        body.identity ?? null,
        body.imageBase64 ?? "",
        body.driveFileId,
        body.driveUrl,
        body.filename ?? null,
        body.captureDatetime ?? null,
        body.mimeType ?? null,
        body.matchStatus ?? "matched",
        Date.now(),
      );
      return Response.json({ ok: true });
    }

    if (url.pathname === "/images/references" && method === "GET") {
      const limit = Math.max(1, Math.min(10000, Number(url.searchParams.get("limit") ?? "10000")));
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT id, meter, reading_id AS readingId, value, identity,
                  image_base64 AS imageBase64, drive_file_id AS driveFileId,
                  drive_url AS driveUrl, filename, capture_datetime AS captureDatetime,
                  mime_type AS mimeType, match_status AS matchStatus
           FROM meter_images
           ORDER BY created_at DESC
           LIMIT ?`,
          limit,
        )
        .toArray();
      return Response.json({ images: rows });
    }

    if (url.pathname === "/images/associate" && method === "POST") {
      const body = await request.json() as { id?: string; readingId?: string | null; meter?: "m1" | "m2"; status?: string };
      if (!body.id) return new Response("Image id is required", { status: 400 });
      this.ctx.storage.sql.exec(
        "UPDATE meter_images SET reading_id = ?, meter = COALESCE(?, meter), match_status = ? WHERE id = ?",
        body.readingId ?? null,
        body.meter ?? null,
        body.status ?? (body.readingId ? "matched" : "unmatched"),
        body.id,
      );
      return Response.json({ ok: true });
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

    if (url.pathname === "/google/state" && method === "PUT") {
      const body = await request.json() as { state?: string; createdAt?: number };
      if (!body.state || !body.createdAt) return new Response("Invalid OAuth state", { status: 400 });
      await this.ctx.storage.put("google_drive_oauth_state", JSON.stringify(body));
      return Response.json({ ok: true });
    }

    if (url.pathname === "/google/state" && method === "GET") {
      const value = await this.ctx.storage.get<string>("google_drive_oauth_state");
      return value ? new Response(value, { headers: { "content-type": "application/json" } }) : new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/google/token" && method === "PUT") {
      const body = await request.json() as { refreshToken?: string };
      if (!body.refreshToken) return new Response("Invalid Google token", { status: 400 });
      await this.ctx.storage.put("google_drive_refresh_token", body.refreshToken);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/google/token" && method === "GET") {
      const refreshToken = await this.ctx.storage.get<string>("google_drive_refresh_token");
      return refreshToken
        ? Response.json({ refreshToken })
        : new Response("Not connected", { status: 404 });
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

    return new Response("Not Found", { status: 404 });
  }
}
