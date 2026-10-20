// The CS report as blocks of text, built from the report data: rendered on the Reports page and
// copied for Slack (rich text, plus mrkdwn as plain text) from the same blocks, so both match.
import type { HitStatus } from "../shared/metrics.ts";
import { cpaBand, isHit } from "../shared/metrics.ts";
import type { ReportConcept, ReportData, ReportFigures, ReportText } from "../shared/api.ts";
import { FORMATS } from "../shared/taxonomy.ts";
import { dollars, moneyExact, ratio, shortDate } from "./format.ts";

/** Plain text, or a bold run. */
export type Inline = string | { b: string };
export type Block =
  | { kind: "h"; text: string }
  | { kind: "p"; parts: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  /** Free text written by Claude or the team: one paragraph per blank-line-separated chunk; "* " lines are bullets. */
  | { kind: "text"; text: string };

const DECIDED: HitStatus[] = ["hit", "late_hit", "winner", "super_winner", "miss"];
const isEligible = (s: HitStatus) => DECIDED.includes(s);
const rate = (hits: number, of: number) => (of > 0 ? `${((hits / of) * 100).toFixed(1).replace(/\.0$/, "")}%` : "—");
const x = (v: number | null) => (v == null ? "—" : `${ratio(v)}×`);
const formatName = (f: string | null) => (f ? (FORMATS[f] ?? f) : "no format tag");

/** "Spend $3,134.11 | 136 purchases | 1.36× ROAS | $23.04 CPA 🔴" */
function line(f: ReportFigures, targetCpa: number, warnMax: number | null): string {
  const band = cpaBand(f.cpa, targetCpa, warnMax);
  const dot = band === "good" ? " 🟢" : band === "warn" ? " 🟡" : band === "bad" ? " 🔴" : "";
  return `Spend ${moneyExact(f.spendCents)} | ${f.purchases} purchases | ${x(f.roas)} ROAS | ${dollars(f.cpa)} CPA${dot}`;
}

function sum(list: ReportFigures[]): ReportFigures {
  const t = list.reduce(
    (a, f) => ({
      spendCents: a.spendCents + f.spendCents,
      impressions: a.impressions + f.impressions,
      linkClicks: a.linkClicks + f.linkClicks,
      purchases: a.purchases + f.purchases,
      revenueCents: a.revenueCents + f.revenueCents,
    }),
    { spendCents: 0, impressions: 0, linkClicks: 0, purchases: 0, revenueCents: 0 },
  );
  return {
    ...t,
    cpa: t.purchases > 0 ? t.spendCents / 100 / t.purchases : null,
    roas: t.spendCents > 0 ? t.revenueCents / t.spendCents : null,
    cpm: t.impressions > 0 ? (t.spendCents / 100 / t.impressions) * 1000 : null,
  };
}

const kindOf = (s: HitStatus) =>
  s === "winner" ? "Hit (call)" : s === "super_winner" ? "Super hit (call)" : s === "late_hit" ? "Late hit" : "Hit";

/** "One Step (Static) — 10 purchases, 2.43× ROAS, $11.55 CPA in its test window" */
function hitLine(k: ReportConcept): Inline[] {
  const tag = k.tags.format ? ` (${formatName(k.tags.format)})` : "";
  if (k.status === "winner" || k.status === "super_winner") {
    return [
      `${kindOf(k.status)}: `,
      { b: k.label },
      `${tag} — ${k.allTime.purchases} purchases, ${x(k.allTime.roas)} ROAS, ${dollars(k.allTime.cpa)} CPA since launch, ${moneyExact(k.allTime.spendCents)} spend.`,
      ...(k.call ? [` “${k.call.reason}”`] : []),
    ];
  }
  const w = k.status === "late_hit" && k.lateWindow ? k.lateWindow : k.window;
  const when = k.status === "late_hit" && k.lateWindow ? ` over ${shortDate(k.lateWindow.from)}–${shortDate(k.lateWindow.to)}` : " in its test window";
  return [`${kindOf(k.status)}: `, { b: k.label }, `${tag} — ${w.purchases} purchases, ${x(w.roas)} ROAS, ${dollars(w.cpa)} CPA${when}, ${moneyExact(w.spendCents)} spend.`];
}

/** "10 statics, 8 AI UGC, 1 podcast" */
function output(list: ReportConcept[]): string {
  const n = new Map<string, number>();
  for (const k of list) n.set(formatName(k.tags.format), (n.get(formatName(k.tags.format)) ?? 0) + 1);
  return [...n]
    .sort((a, b) => b[1] - a[1])
    .map(([f, c]) => `${c} ${f}`)
    .join(", ");
}

export function reportBlocks(d: ReportData, text: ReportText | null, podNames: Map<string, string>): Block[] {
  const t = d.targets;
  const C = d.concepts;
  const eligible = C.filter((k) => isEligible(k.status));
  const hits = C.filter((k) => isHit(k.status));
  const byCall = hits.filter((k) => k.call).length;
  const late = hits.filter((k) => k.status === "late_hit").length;
  const notEligible = C.length - eligible.length;
  const range = `${shortDate(d.from)} – ${shortDate(d.to)}, ${d.to.slice(0, 4)}`;
  const blocks: Block[] = [
    { kind: "h", text: `📊 CS PERFORMANCE — ${d.n ? `REPORT ${d.n}` : "REPORT"}` },
    { kind: "p", parts: [{ b: `${range} · Through Sunday close` }] },
    {
      kind: "p",
      parts: [
        { b: "Hit rate" },
        ` = share of eligible concepts that reach target in their test window: CPA ≤ $${t.targetCpa} ${t.hitRule === "both" ? "and" : "or"} ROAS ≥ ${t.targetRoas}. A concept becomes eligible once one of its ads has spent $${t.minTestSpend}, and counts in the period it launched. Late hits and hits by call count.`,
      ],
    },
  ];

  const split = [hits.length - late - byCall > 0 && `${hits.length - late - byCall} on target`, late > 0 && `${late} late`, byCall > 0 && `${byCall} by call`]
    .filter(Boolean)
    .join(", ");
  const spend = sum(C.map((k) => k.period));
  const allTesting = d.pods.reduce((n, p) => n + p.testingSpendCents, 0);
  blocks.push(
    { kind: "p", parts: [{ b: `🎯 Overall hit rate: ${hits.length} / ${eligible.length} eligible — ${rate(hits.length, eligible.length)}` }, split ? ` (${split})` : ""] },
    {
      kind: "p",
      parts: [
        `${C.length} concepts launched${notEligible ? `; ${notEligible} not eligible yet (no ad has reached $${t.minTestSpend}). Their results will show under Late verdicts in the report they come in.` : "."}`,
      ],
    },
    {
      kind: "p",
      parts: [{ b: `💸 Spend on this period's concepts: ${moneyExact(spend.spendCents)}` }, ` | ${spend.purchases} purchases | ${x(spend.roas)} ROAS | ${dollars(spend.cpa)} CPA`],
    },
    { kind: "p", parts: [`All testing spend in the period, including earlier concepts still running: ${moneyExact(allTesting)}`] },
    { kind: "h", text: "Hit rate by CS" },
  );

  const pods = d.pods
    .map((p) => {
      const mine = C.filter((k) => k.podId === p.podId);
      const el = mine.filter((k) => isEligible(k.status));
      const h = mine.filter((k) => isHit(k.status));
      return { p, mine, el, h };
    })
    .filter((x) => x.mine.length > 0)
    .sort((a, b) => b.h.length - a.h.length || b.el.length - a.el.length);
  for (const { p, mine, el, h } of pods) {
    const items: Inline[][] = [];
    const name = podNames.get(p.podId) ?? p.name;
    const head: Inline[] = [{ b: `${name}: ${h.length} / ${el.length} eligible — ${rate(h.length, el.length)}` }];
    if (el.length > 0 && el.length < 3) head.push(" (too few eligible to read much into)");
    blocks.push({ kind: "p", parts: ["• ", ...head] });
    items.push([line(sum(mine.map((k) => k.period)), t.targetCpa, t.cpaWarnMax)]);
    for (const k of h.sort((a, b) => b.allTime.spendCents - a.allTime.spendCents)) items.push(hitLine(k));
    // The best miss: a signal to build on, or the closest when nothing hit.
    const best = mine
      .filter((k) => k.status === "miss")
      .sort((a, b) => b.window.purchases - a.window.purchases || (b.window.roas ?? 0) - (a.window.roas ?? 0))[0];
    if (best) {
      const w = best.window;
      items.push([
        h.length ? "Strongest signal: " : "Strongest miss: ",
        { b: best.label },
        ` — ${w.purchases} purchases, ${x(w.roas)} ROAS, ${dollars(w.cpa)} CPA in its test window, ${moneyExact(w.spendCents)} spend.`,
        ...(best.candidate ? [" Could be a hit (call): the media buyer's decision."] : []),
      ]);
    }
    const waiting = mine.length - el.length;
    items.push([`Output: ${mine.length} concepts — ${output(mine)}.${waiting ? ` ${waiting} not eligible yet.` : ""}`]);
    blocks.push({ kind: "ul", items });
  }

  // Formats won, among eligible concepts.
  const formats = new Map<string, ReportConcept[]>();
  for (const k of eligible) formats.set(formatName(k.tags.format), [...(formats.get(formatName(k.tags.format)) ?? []), k]);
  blocks.push(
    { kind: "h", text: "🏆 Formats won" },
    {
      kind: "ul",
      items: [...formats]
        .sort((a, b) => b[1].filter((k) => isHit(k.status)).length - a[1].filter((k) => isHit(k.status)).length || b[1].length - a[1].length)
        .map(([f, list]) => {
          const won = list.filter((k) => isHit(k.status));
          const names = won.map((k) => `${podNames.get(k.podId) ?? k.podId}'s ${k.label}${k.call ? " (call)" : ""}`).join(", ");
          return [{ b: `${f}: ${won.length} / ${list.length}` }, names ? ` — ${names}` : ""];
        }),
    },
  );

  if (d.lateVerdicts.length > 0) {
    blocks.push(
      { kind: "h", text: "⏳ Late verdicts (earlier concepts whose result came in this period)" },
      {
        kind: "ul",
        items: d.lateVerdicts.map((v) => {
          const w = v.status === "late_hit" && v.lateWindow ? v.lateWindow : v.window;
          const what = isHit(v.status) ? kindOf(v.status) : "Miss";
          return [
            `${podNames.get(v.podId) ?? v.podId}: `,
            { b: v.label },
            ` — ${what} on ${shortDate(v.verdictOn)} (launched ${shortDate(v.firstSpend)}): ${w.purchases} purchases, ${x(w.roas)} ROAS, ${dollars(w.cpa)} CPA, ${moneyExact(w.spendCents)} spend.`,
          ];
        }),
      },
    );
  }

  if (d.previous) {
    const pc = d.previous.concepts;
    const pe = pc.filter((k) => isEligible(k.status));
    const ph = pc.filter((k) => isHit(k.status));
    const per = [...new Set(pc.map((k) => k.podId))]
      .map((id) => {
        const m = pe.filter((k) => k.podId === id);
        return m.length ? `${podNames.get(id) ?? id} ${m.filter((k) => isHit(k.status)).length} / ${m.length}` : null;
      })
      .filter(Boolean)
      .join(" · ");
    blocks.push({
      kind: "p",
      parts: [
        { b: `Report ${d.previous.n} (${shortDate(d.previous.from)} – ${shortDate(d.previous.to)}), as it stands now: ${ph.length} / ${pe.length} eligible — ${rate(ph.length, pe.length)}` },
        per ? ` (${per})` : "",
      ],
    });
  }

  blocks.push({ kind: "h", text: `🧠 Learnings this period: ${shortDate(d.from)} – ${shortDate(d.to)}` });
  blocks.push(text?.learnings ? { kind: "text", text: text.learnings } : { kind: "p", parts: ["Not written yet."] });
  blocks.push({ kind: "h", text: "➡️ My read" });
  blocks.push(text?.read ? { kind: "text", text: text.read } : { kind: "p", parts: ["Not written yet."] });
  return blocks;
}

/** Free text → paragraphs and bullet lists ("* " or "- " lines), with **bold** runs. */
export function parseText(text: string): ({ kind: "p"; parts: Inline[] } | { kind: "ul"; items: Inline[][] })[] {
  const inline = (s: string): Inline[] => s.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? { b: p.slice(2, -2) } : p));
  const out: ({ kind: "p"; parts: Inline[] } | { kind: "ul"; items: Inline[][] })[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const bullet = /^[*•-]\s+(.*)$/.exec(l);
    if (bullet) {
      const last = out[out.length - 1];
      if (last?.kind === "ul") last.items.push(inline(bullet[1]!));
      else out.push({ kind: "ul", items: [inline(bullet[1]!)] });
    } else out.push({ kind: "p", parts: inline(l) });
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rich text for pasting into Slack (bold and bullet lists survive). */
export function toHtml(blocks: Block[]): string {
  const inl = (parts: Inline[]) => parts.map((p) => (typeof p === "string" ? esc(p) : `<b>${esc(p.b)}</b>`)).join("");
  const one = (b: Block): string =>
    b.kind === "h"
      ? `<p><b>${esc(b.text)}</b></p>`
      : b.kind === "p"
        ? `<p>${inl(b.parts)}</p>`
        : b.kind === "ul"
          ? `<ul>${b.items.map((i) => `<li>${inl(i)}</li>`).join("")}</ul>`
          : parseText(b.text).map(one).join("");
  return blocks.map(one).join("");
}

/** Slack mrkdwn, for the plain-text side of the clipboard. */
export function toMrkdwn(blocks: Block[]): string {
  const inl = (parts: Inline[]) => parts.map((p) => (typeof p === "string" ? p : `*${p.b}*`)).join("");
  const one = (b: Block): string =>
    b.kind === "h"
      ? `*${b.text}*`
      : b.kind === "p"
        ? inl(b.parts)
        : b.kind === "ul"
          ? b.items.map((i) => `• ${inl(i)}`).join("\n")
          : parseText(b.text).map(one).join("\n");
  return blocks.map(one).join("\n\n");
}
