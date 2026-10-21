// Winner calls: a concept that missed target but takes major spend and lifts the account can be
// called a Winner or Super Winner by the media buyer, and only by them (MEDIA_BUYER_EMAILS). The
// hub flags candidates (shared/metrics.ts → winnerCandidate) and lays out the evidence; the call
// is stored with the evidence as it was, never changed by syncs, and counts as a hit.
import { Hono } from "hono";
import type { CallEvidence, EvidenceWindow } from "../shared/api.ts";
import { addTotals, ZERO_TOTALS, type Totals } from "../shared/metrics.ts";
import { requireAccess } from "./access.ts";
import { memoize } from "./cache.ts";
import type { AppEnv, Env } from "./env.ts";
import { getLatestDate, loadConcepts, loadPosts, shiftDay, toTotals, TOTALS_SQL } from "./queries.ts";

export function isMediaBuyer(env: Env, email: string | null): boolean {
  if (!env.ACCESS_TEAM_DOMAIN || !email || email.startsWith("service:")) return false;
  const list = (env.MEDIA_BUYER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return list.includes(email.toLowerCase());
}

const sub = (a: Totals, b: Totals): Totals => ({
  spendCents: a.spendCents - b.spendCents,
  impressions: a.impressions - b.impressions,
  linkClicks: a.linkClicks - b.linkClicks,
  purchases: a.purchases - b.purchases,
  revenueCents: a.revenueCents - b.revenueCents,
});
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const MOF_BOF = new Set(["product", "most"]);

/**
 * The account in the 7 days before a concept's first spend and in its first 14 days (to the
 * latest synced day): all ads, the rest without the concept, the MOF/BOF ads, and the concept.
 */
export async function callEvidence(db: D1Database, conceptId: string): Promise<CallEvidence | null> {
  const concept = (await loadConcepts(db)).find((k) => k.conceptId === conceptId);
  const latest = await getLatestDate(db);
  if (!concept || !latest) return null;
  const before = { from: shiftDay(concept.firstSpend, -7), to: shiftDay(concept.firstSpend, -1) };
  const sinceTo = [shiftDay(concept.firstSpend, 13), latest].sort()[0]!;
  const since = { from: concept.firstSpend, to: sinceTo };

  // Every post's totals in the two windows, split by testing (in a concept) or not. Per sync.
  type Row = { post_id: string; after: number; test: number } & Record<string, unknown>;
  const rows = await memoize(
    db,
    `evidence-${before.from}-${since.from}-${since.to}`,
    async () =>
      (
        await db
          .prepare(
            `SELECT a.post_id, (d.date >= ?2) AS after, (a.concept_id IS NOT NULL) AS test, ${TOTALS_SQL}
             FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id
             WHERE d.date BETWEEN ?1 AND ?3 GROUP BY a.post_id, after, test`,
          )
          .bind(before.from, since.from, since.to)
          .all<Row>()
      ).results,
    { durable: true, scope: "stats" },
  );
  const own = (
    await db
      .prepare(
        `SELECT d.date, d.spend_cents, d.impressions, d.link_clicks, d.purchases, d.revenue_cents, d.purchases_inc_milli, d.revenue_inc_cents
         FROM ads a CROSS JOIN ad_daily d ON d.ad_id = a.id WHERE a.concept_id = ?1`,
      )
      .bind(conceptId)
      .all<Record<string, unknown>>()
  ).results;

  // Awareness per post (hand-set wins over Claude's label), for the MOF/BOF group.
  const posts = await loadPosts(db, before.from, since.to);
  const awareness = new Map(posts.map((p) => [p.postId, p.assignment.awareness ?? p.labels.awareness]));
  const conceptPosts = new Set(
    (await db.prepare("SELECT DISTINCT post_id FROM ads WHERE concept_id = ?1").bind(conceptId).all<{ post_id: string }>()).results.map((r) => r.post_id),
  );

  const windowOf = (w: { from: string; to: string }, after: boolean): EvidenceWindow => {
    let account = ZERO_TOTALS;
    let mofBof = ZERO_TOTALS;
    for (const r of rows) {
      if (Boolean(Number(r.after)) !== after) continue;
      const t = toTotals(r);
      account = addTotals(account, t);
      if (!conceptPosts.has(r.post_id) && MOF_BOF.has(awareness.get(r.post_id) ?? "")) mofBof = addTotals(mofBof, t);
    }
    const concept = own.filter((d) => String(d.date) >= w.from && String(d.date) <= w.to).reduce((acc, d) => addTotals(acc, toTotals(d)), ZERO_TOTALS);
    return { ...w, days: days(w.from, w.to), account, rest: sub(account, concept), mofBof, concept };
  };
  const b = windowOf(before, false);
  const s = windowOf(since, true);

  const testSince = rows.filter((r) => Number(r.after) && Number(r.test)).reduce((acc, r) => addTotals(acc, toTotals(r)), ZERO_TOTALS);
  const inc = own.some((d) => d.revenue_inc_cents != null)
    ? own.reduce<{ spendCents: number; purchases: number; revenueCents: number }>(
        (acc, d) => ({
          spendCents: acc.spendCents + Number(d.spend_cents ?? 0),
          purchases: acc.purchases + Number(d.purchases_inc_milli ?? 0) / 1000,
          revenueCents: acc.revenueCents + Number(d.revenue_inc_cents ?? 0),
        }),
        { spendCents: 0, purchases: 0, revenueCents: 0 },
      )
    : null;

  return {
    conceptId,
    before: b,
    since: s,
    shareOfTestSpend: testSince.spendCents > 0 ? s.concept.spendCents / testSince.spendCents : null,
    shareOfTestPurchases: testSince.purchases > 0 ? s.concept.purchases / testSince.purchases : null,
    incremental: inc,
    computedAt: new Date().toISOString(),
  };
}

export const calls = new Hono<AppEnv>();

/** The evidence for a concept, for anyone signed in (the call itself is the media buyer's). */
calls.get("/concepts/:id/evidence", async (c) => {
  const evidence = await callEvidence(c.env.DB, c.req.param("id"));
  if (!evidence) return c.json({ error: "Concept not found" }, 404);
  return c.json(evidence);
});

/** { kind: "winner" | "super_winner", reason }. Media buyer only; the concept must have missed. */
calls.put("/concepts/:id/call", requireAccess, async (c) => {
  const db = c.env.DB;
  const email = c.get("userEmail");
  if (!isMediaBuyer(c.env, email)) return c.json({ error: "Only the media buyer can make a hit call." }, 403);
  const id = c.req.param("id");
  const body = await c.req.json<{ kind?: string; reason?: string }>().catch(() => null);
  const kind = body?.kind;
  const reason = body?.reason?.trim() ?? "";
  if (kind !== "winner" && kind !== "super_winner") return c.json({ error: "Pick Hit or Super hit." }, 400);
  if (reason.length < 10 || reason.length > 500) return c.json({ error: "Say in a sentence why (10–500 characters)." }, 400);
  const concept = (await loadConcepts(db)).find((k) => k.conceptId === id);
  if (!concept) return c.json({ error: "Concept not found" }, 404);
  // A call is only for a test that missed (or one already called, to change it).
  if (concept.status !== "miss" && !concept.call) return c.json({ error: "Only a concept that missed its test can be called a hit." }, 409);
  const evidence = await callEvidence(db, id);
  await db
    .prepare(
      `INSERT INTO concept_calls (concept_id, kind, reason, evidence, called_by, called_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(concept_id) DO UPDATE SET kind = excluded.kind, reason = excluded.reason, evidence = excluded.evidence,
         called_by = excluded.called_by, called_at = excluded.called_at`,
    )
    .bind(id, kind, reason, JSON.stringify(evidence), email, new Date().toISOString())
    .run();
  return c.json({ ok: true });
});

calls.delete("/concepts/:id/call", requireAccess, async (c) => {
  if (!isMediaBuyer(c.env, c.get("userEmail"))) return c.json({ error: "Only the media buyer can undo a hit call." }, 403);
  await c.env.DB.prepare("DELETE FROM concept_calls WHERE concept_id = ?1").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
