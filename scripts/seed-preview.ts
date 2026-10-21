// Loads the sample data into the preview hub's database, once: only while it has no posts.
// Never touches the live database (it only runs against --env preview). D1 writes are shared
// across the account, so the preview isn't reseeded on every push.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const wrangler = (args: string[]) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "kojeva-hub-preview", "--env", "preview", "--remote", ...args], { encoding: "utf8" });

const out = wrangler(["--json", "--command", "SELECT COUNT(*) AS n FROM posts"]);
const n = Number((JSON.parse(out) as { results: { n: number }[] }[])[0]?.results[0]?.n ?? 0);
if (n > 0) {
  console.log(`Preview database already has ${n} posts; not reseeding.`);
} else {
  const sql = execFileSync("node", ["--experimental-strip-types", "scripts/gen-sample.ts"], { encoding: "utf8" });
  writeFileSync("seed/sample.sql", sql);
  wrangler(["--yes", "--file", "seed/sample.sql"]);
  console.log("Loaded sample data into the preview database.");
}
