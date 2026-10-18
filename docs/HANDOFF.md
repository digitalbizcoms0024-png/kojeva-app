# Handoff — state as of Oct 18, 2026

Read `CLAUDE.md` first (rules), then `docs/ROADMAP.md`. Work happens on branch
`claude/affectionate-cannon-rltll0`; pushing it deploys through Cloudflare Workers Builds
(`npm run deploy`: migrations → build → deploy).

## Live app
- https://kojeva-hub.digitalbizcoms0024.workers.dev (behind Cloudflare Access)
- Meta ad account `act_2930078677198801`, connected with a pasted token (expires ~Dec 15, 2026;
  renew in Settings → Meta Ads).
- Preview with fake sample data: https://claude.ai/artifact/KRoqzTR2Q9XTmqVUQGjkCz
  (`npm run build:preview`).

## Open right now
1. **D1 free-plan read limit (5M rows/day) was hit on Oct 17.** Every API call fails until the
   daily reset (00:00 UTC). Commit `7652036` adds an in-memory read cache per `data_version`
   (`worker/cache.ts`, migration 0012) so repeat views cost ~1 row. After the reset, **retry the
   latest build** in Cloudflare (Workers & Pages → kojeva-hub → Deployments): migrations 0010–0012
   and everything since `bfeff53` only go live with that deploy.
2. After that deploy, check: Dashboard loads; Month to date matches Ads Manager's "This month";
   Incrementality → Last 7 days shows Agency (~$61K) and Dhia (~$1.7K); Harris "KOJEVA 3 | STATIC |
   Scarcity" shows as a hit.
3. **Personas**: the nightly Atria task drafts them; a person confirms in Settings → Personas. The
   Coverage Map stays empty until then.
4. If reads still run out, the next step is Workers Paid ($5/mo). The owner chose to stay free.

## Decisions made with the owner (don't re-ask)
- **Hit rule = either**: CPA ≤ $14 **or** ROAS ≥ 1.7 (migration 0011 sets it).
- **Best ad decides**: a concept is a hit if the concept or any single ad in it hits on its own
  window (`judgeAds` in `worker/queries.ts`, `decidedBy` shown as "via <ad>").
- Late hits: rolling 7-day window after the judging window, counted in hit rate.
- Date ranges: Last 7 days / Last 30 days / Month to date / All time / Custom.
- Incrementality page compares **7-day click vs incremental only**; numbers matched Ads Manager's
  Compare attribution settings (incremental ≈ 7-day click for this account). Report-only.
- Triple Whale: model "Clicks & Views" (deterministic views), lifetime window, never blended.
- The hub is permanently read-only on Meta (no ad management).

## Open question with the owner
- "ST _ Comparison _ Gua Sha vs Kojeva _ V1" (Harris, KOJEVA 3 | STATIC | Comparison) is a hit
  in the owner's view, but Meta's numbers only hit on day 1 (days 1–3: CPA $23.25, ROAS 1.27;
  no 7-day window reaches target). Waiting for their Ads Manager screenshot/date range.

## Scheduled tasks (claude.ai)
- "Kojeva Hub · Atria tag sync" (daily 10:07 UTC, Atria connector): tags, awareness/belief/offer
  labels, persona drafts and placement. Prompt documented in `docs/ATRIA.md`.
- "Kojeva Hub · Triple Whale sync" (daily 10:37 UTC, Triple Whale connector): pushes to
  `/api/ingest/tw`. First successful run Oct 17 (1,762 rows).
- Both reach the hub through the environment network secret "Kojeva Hub ingest"
  (host kojeva-hub…, path `/api/ingest/`, CF-Access-Client-Id/Secret headers).
- Reminder Oct 23: parked "Why it works" AI notes (needs an ANTHROPIC_API_KEY Worker secret).

## Checks before pushing
`npm run typecheck && npm test && npm run build` (219 tests passing at handoff).
