import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 2_000,
});
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock($1)", [731_024_619]);
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationNames = (
    await readdir(new URL("../migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migrationName of migrationNames) {
    const existing = await client.query(
      "SELECT 1 FROM schema_migrations WHERE name = $1",
      [migrationName],
    );
    if (existing.rowCount !== 0) {
      continue;
    }

    const migration = await readFile(
      new URL(`../migrations/${migrationName}`, import.meta.url),
      "utf8",
    );
    await client.query(migration);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
      migrationName,
    ]);
  }

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [731_024_619]);
  } finally {
    client.release();
    await pool.end();
  }
}
