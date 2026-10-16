// Static preview build: runs the real Worker API in the browser against an
// in-memory SQLite database loaded with the sample data. No server needed.
import initSqlJs, { type Database } from "sql.js";
import wasmBase64 from "virtual:sql-wasm";
import schema from "../migrations/0001_init.sql?raw";
import seed from "../seed/sample.sql?raw";
import api from "../worker/index.ts";

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The subset of D1's API the Worker uses, backed by sql.js. */
function d1(db: Database): D1Database {
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => statement(sql, p),
    async all<T>() {
      const s = db.prepare(sql);
      s.bind(params as never);
      const results: T[] = [];
      while (s.step()) results.push(s.getAsObject() as T);
      s.free();
      return { results, success: true, meta: {} };
    },
    async first<T>() {
      const { results } = await this.all<T>();
      return results[0] ?? null;
    },
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

const SQL = await initSqlJs({ wasmBinary: bytesFromBase64(wasmBase64) as unknown as ArrayBuffer });
const db = new SQL.Database();
db.exec(schema);
db.exec(seed);
const env = { DB: d1(db), DATA_MODE: "sample" };

const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, window.location.href);
  if (url.pathname.startsWith("/api/")) {
    // Fixed origin: the router misreads paths on file:// and other non-http URLs.
    const req = new Request(new URL(url.pathname + url.search, "https://preview.local"), init);
    return Promise.resolve(api.fetch(req, env));
  }
  return realFetch(input, init);
};

await import("../src/main.tsx");
