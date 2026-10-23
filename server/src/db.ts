import pg from "pg";

// Sem DATABASE_URL o servidor roda sem banco (útil para testes e2e e para o hello world).
const connectionString = process.env.DATABASE_URL;

export const pool = connectionString
  ? new pg.Pool({ connectionString, max: 5 })
  : null;

export async function checkDatabase(): Promise<"ok" | "disabled"> {
  if (!pool) return "disabled";
  await pool.query("select 1");
  return "ok";
}
