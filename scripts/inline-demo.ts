// Inlines the demo build's JS and CSS into one HTML file for publishing.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "dist-demo";
let html = readFileSync(join(dir, "index.html"), "utf8");

html = html.replace(/<script type="module" crossorigin src="\.?\/?([^"]+)"><\/script>/g, (_, src: string) => {
  const js = readFileSync(join(dir, src), "utf8").replace(/<\/script/gi, "<\\/script");
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.?\/?([^"]+)">/g, (_, href: string) => {
  return `<style>${readFileSync(join(dir, href), "utf8")}</style>`;
});

// The artifact host supplies the document skeleton; keep only title, styles and body content.
const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
const body = /<body>([\s\S]*?)<\/body>/.exec(html)?.[1] ?? "";
const keep = head.replace(/<meta[^>]*>\s*/g, "");
writeFileSync(join(dir, "kojeva-hub-preview.html"), `${keep.trim()}\n${body.trim()}\n`);
console.log("wrote", join(dir, "kojeva-hub-preview.html"));
