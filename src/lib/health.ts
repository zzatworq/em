import { createServerFn } from "@tanstack/react-start";

/**
 * Temporary diagnostic: proves a server function can reach the database
 * (Neon or PGLite, whichever `dbSource` resolves to) from this exact
 * deployment. Visit /health-check to run it. Safe to delete once DB
 * connectivity is confirmed in production.
 */
export const checkDbHealth = createServerFn({ method: "GET" }).handler(async () => {
  const startedAt = Date.now();
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{ ok: number }>`select 1 as ok`;
  return {
    ok: rows[0]?.ok === 1,
    tookMs: Date.now() - startedAt,
  };
});
