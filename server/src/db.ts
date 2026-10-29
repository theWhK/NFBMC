import pg from "pg";

// Sem DATABASE_URL o servidor roda sem banco (útil para testes e2e e para dev rápido):
// as fichas dos jogadores ficam só na memória.
const connectionString = process.env.DATABASE_URL;

export const pool = connectionString
  ? new pg.Pool({ connectionString, max: 5 })
  : null;

export async function checkDatabase(): Promise<"ok" | "disabled"> {
  if (!pool) return "disabled";
  await pool.query("select 1");
  return "ok";
}

/**
 * Cria as tabelas que faltarem. É idempotente (pode rodar a cada início do
 * servidor); quando o esquema mudar, acrescente comandos aqui, sem apagar dados.
 */
export async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    create table if not exists players (
      token uuid primary key,
      name text not null,
      calories bigint not null default 0,
      races integer not null default 0,
      wins integer not null default 0,
      best_race bigint not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists players_calories_idx on players (calories desc);
    -- Progresso feito offline e enviado depois (/api/sync): cada lançamento uma vez só.
    create table if not exists synced_entries (
      id uuid primary key,
      token uuid not null,
      created_at timestamptz not null default now()
    );
  `);
}
