// Static preview build: runs the real Worker API in the browser against an
// in-memory SQLite database loaded with the sample data. No server needed.
import initSqlJs from "sql.js";
import wasmBase64 from "virtual:sql-wasm";
import schema from "../migrations/0001_init.sql?raw";
import metaSchema from "../migrations/0002_meta.sql?raw";
import agencySchema from "../migrations/0003_agency.sql?raw";
import seed from "../seed/sample.sql?raw";
import api from "../worker/index.ts";
import { d1FromSqlJs } from "../worker/testing/sqljs-d1.ts";

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const SQL = await initSqlJs({ wasmBinary: bytesFromBase64(wasmBase64) as unknown as ArrayBuffer });
const db = new SQL.Database();
db.exec(schema);
db.exec(metaSchema);
db.exec(agencySchema);
db.exec(seed);
const env = {
  DB: d1FromSqlJs(db),
  META_APP_ID: "preview",
  META_AD_ACCOUNT_ID: "act_preview",
  META_GRAPH_VERSION: "v26.0",
};

const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, window.location.href);
  if (url.pathname.startsWith("/api/")) {
    // Fixed origin: the router misreads paths on file:// and other non-http URLs.
    const req = new Request(new URL(url.pathname + url.search, "https://preview.local"), init);
    return Promise.resolve(api.fetch(req, env, {} as ExecutionContext));
  }
  return realFetch(input, init);
};

await import("../src/main.tsx");
