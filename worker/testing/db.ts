// Node-only: a fresh in-memory database with all migrations applied.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { d1FromSqlJs } from "./sqljs-d1.ts";

export async function testDb(): Promise<D1Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const dir = join(import.meta.dirname, "../../migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  return d1FromSqlJs(db);
}
