// Counts D1 rows read per API route on a live-sized local database, the way Cloudflare bills them
// (free plan: 5M rows read a day). Run after changing any query that touches ad_daily:
//
//   SAMPLE_POSTS=1500 node --experimental-strip-types scripts/gen-sample.ts > .wrangler/big.sql
//   npx wrangler d1 migrations apply kojeva-hub --local --persist-to .wrangler/measure
//   npx wrangler d1 execute kojeva-hub --local --persist-to .wrangler/measure --file .wrangler/big.sql
//   TOP=3 node --experimental-transform-types scripts/measure-reads.ts
//
// TOP=n also lists the n most expensive statements per route. Oct 2026, 52k ad_daily rows: a cold
// Dashboard read ~440k rows, a cached one ~25, one on a fresh isolate (stored snapshots) ~40.
import { getPlatformProxy } from "wrangler";
import app from "../worker/index.ts";
import { attribute } from "../worker/meta/sync.ts";
import { bumpVersion, forgetMemory } from "../worker/cache.ts";

const dir = process.argv[2] ?? ".wrangler/measure";
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  persist: { path: `${dir}/v3` },
});
const raw = proxy.env.DB;
let reads = 0,
  writes = 0;
const perSql = new Map<string, number>();
const note = (sql: string, m: any) => {
  reads += m?.rows_read ?? 0;
  writes += m?.rows_written ?? 0;
  const k = sql.replace(/\s+/g, " ").slice(0, 110);
  perSql.set(k, (perSql.get(k) ?? 0) + (m?.rows_read ?? 0));
};
const wrapStmt = (s: any, sql: string): any => ({
  __raw: s,
  __sql: sql,
  bind: (...a: unknown[]) => wrapStmt(s.bind(...a), sql),
  all: async () => {
    const r = await s.all();
    note(sql, r.meta);
    return r;
  },
  run: async () => {
    const r = await s.run();
    note(sql, r.meta);
    return r;
  },
  first: async (col?: string) => {
    const r = await s.all();
    note(sql, r.meta);
    const row = r.results[0] ?? null;
    return col ? (row?.[col] ?? null) : row;
  },
  raw: async () => {
    const r = await s.all();
    note(sql, r.meta);
    return r.results.map((x: any) => Object.values(x));
  },
});
const DB: any = {
  prepare: (sql: string) => wrapStmt(raw.prepare(sql), sql),
  batch: async (list: any[]) => {
    const r = await raw.batch(list.map((x) => x.__raw));
    r.forEach((x: any, i: number) => note(list[i].__sql, x.meta));
    return r;
  },
  exec: (q: string) => raw.exec(q),
};
const env: any = {
  ...proxy.env,
  DB,
  ACCESS_TEAM_DOMAIN: "",
  META_APP_ID: "x",
  META_AD_ACCOUNT_ID: "act_1",
  META_GRAPH_VERSION: "v26.0",
};
const measure = async (label: string, fn: () => Promise<unknown>) => {
  reads = 0;
  writes = 0;
  perSql.clear();
  await fn();
  console.log(
    `${label.padEnd(44)} read ${String(reads).padStart(9)}  written ${writes}`,
  );
  if (process.env.TOP)
    [...perSql]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Number(process.env.TOP))
      .forEach(([k, v]) => console.log(`      ${String(v).padStart(9)}  ${k}`));
};
const get = (p: string) =>
  Promise.resolve(
    app.fetch(new Request(`https://hub.test${p}`), env, {
      waitUntil() {},
      passThroughOnException() {},
    } as any),
  ).then(async (r: Response) => {
    if (r.status !== 200)
      console.log("  !", p, r.status, (await r.text()).slice(0, 120));
  });

await measure("first request after deploy (rules check)", () =>
  get("/api/meta"),
);
await measure("attribute() (every sync)", () => attribute(DB));
await bumpVersion(raw);
const dash = [
  "/api/meta?v=1",
  "/api/rankings?range=week&sort=spend&limit=5",
  "/api/rankings?range=custom&from=2026-10-04&to=2026-10-10&limit=1",
  "/api/pods?range=week",
  "/api/pods?range=custom&from=2026-10-04&to=2026-10-10",
  "/api/alerts",
  "/api/trends?range=week",
  "/api/launches?weeks=1",
];
for (const p of dash) await measure(p, () => get(p));
await measure("Dashboard again (cached)", async () => {
  for (const p of dash) await get(p);
});
forgetMemory(); // a fresh isolate: after a deploy, or another one serving a second viewer
await measure("Dashboard on a fresh isolate", async () => {
  for (const p of dash) await get(p);
});
for (const p of [
  "/api/concepts?range=week",
  "/api/coverage?range=week",
  "/api/insights?range=week&dimension=angle",
  "/api/rankings?range=week&sort=spend",
  "/api/attribution?range=week&level=pod",
  "/api/launches?weeks=8",
  "/api/suggestions?r=0",
])
  await measure(p, () => get(p));
await proxy.dispose();
