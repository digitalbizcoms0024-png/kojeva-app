// Node-only: a fresh in-memory database with all migrations applied.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { d1FromSqlJs } from "./sqljs-d1.ts";

/** `seed` (SQL, e.g. seed/sample.sql) is run after the migrations. */
export async function testDb(seed?: string): Promise<D1Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const dir = join(import.meta.dirname, "../../migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  if (seed) db.exec(seed);
  // Each fresh database gets its own versions, so results cached for another test's data never match.
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('data_version', lower(hex(randomblob(8)))), ('stats_version', lower(hex(randomblob(8))))");
  return d1FromSqlJs(db);
}
