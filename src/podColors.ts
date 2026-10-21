// Pods added in Settings get their color from shared/taxonomy.ts → POD_SLOTS, light and dark.
// Built-in pods are in index.css; this adds --pod-<id> for the added ones, with the same
// light / dark / explicit-theme structure, and registers them for podById and friends.
import type { MetaResponse } from "../shared/api.ts";
import { POD_SLOTS, setAddedPods } from "../shared/taxonomy.ts";

export function applyAddedPods(pods: MetaResponse["pods"]) {
  const added = pods.filter((p) => p.prefix && p.slot != null && POD_SLOTS[p.slot]);
  setAddedPods(added.map(({ id, code, name, color, prefix, slot }) => ({ id, code, name, color, prefix, slot })));
  const vars = (mode: "light" | "dark") => added.map((p) => `--pod-${p.id}: ${POD_SLOTS[p.slot!]![mode]};`).join(" ");
  const css = `:root { ${vars("light")} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${vars("dark")} } }
:root[data-theme="dark"] { ${vars("dark")} }`;
  let el = document.getElementById("added-pod-colors");
  if (!el) {
    el = document.createElement("style");
    el.id = "added-pod-colors";
    document.head.appendChild(el);
  }
  el.textContent = css;
}
