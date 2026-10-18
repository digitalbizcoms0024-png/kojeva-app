// The subset of D1's API this app uses, backed by sql.js (SQLite in WASM).
// Used by the static preview build and by tests.
import type { Database } from "sql.js";

type Params = unknown[];

/** Cloudflare D1 refuses statements with more than 100 bound values; so do we, so tests catch it. */
export const D1_MAX_PARAMS = 100;

function rows<T>(db: Database, sql: string, params: Params): T[] {
  if (params.length > D1_MAX_PARAMS) throw new Error(`D1_ERROR: too many bound values (${params.length} > ${D1_MAX_PARAMS})`);
  const highest = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
  if (highest > D1_MAX_PARAMS) throw new Error(`D1_ERROR: variable number must be between ?1 and ?${D1_MAX_PARAMS}`);
  const s = db.prepare(sql);
  try {
    s.bind(params as never);
    const out: T[] = [];
    while (s.step()) out.push(s.getAsObject() as T);
    return out;
  } finally {
    s.free();
  }
}

export function d1FromSqlJs(db: Database): D1Database {
  db.exec("PRAGMA foreign_keys = ON");
  const statement = (sql: string, params: Params = []) => ({
    sql,
    params,
    bind: (...p: Params) => statement(sql, p),
    async all<T>() {
      return { results: rows<T>(db, sql, params), success: true, meta: {} };
    },
    async first<T>() {
      return rows<T>(db, sql, params)[0] ?? null;
    },
    async raw<T>() {
      return rows<Record<string, unknown>>(db, sql, params).map((r) => Object.values(r)) as T[];
    },
    async run() {
      rows(db, sql, params);
      return { results: [], success: true, meta: { changes: db.getRowsModified() } };
    },
  });
  return {
    prepare: (sql: string) => statement(sql),
    // D1 runs a batch as one transaction.
    async batch(stmts: ReturnType<typeof statement>[]) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => ({ results: rows(db, s.sql, s.params), success: true, meta: {} }));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
