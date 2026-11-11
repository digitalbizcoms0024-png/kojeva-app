# Kojeva Hub

Internal performance and creative-intelligence tool for Kojeva's Meta ads. It ranks
ads, attributes them to the creative pods (active since Nov 11: Shameer, Ali, Pod 0 - Andrei, Pod 1 - Reika,
Pod 2 - Adrian, Caicos; Harris and Dhia are former pods) and
measures each pod's hit rate. Read `docs/PRD.md` for scope and `docs/ROADMAP.md`
for which phase we're in.

## Stack
- React 19 + Vite + Tailwind v4 (`src/`), served as static assets by a Cloudflare Worker.
- Hono API on the Worker (`worker/`), all routes under `/api`.
- Cloudflare D1 (SQLite) for storage (`migrations/`). R2 for thumbnails (Phase 1).
- Code shared by both sides lives in `shared/` (naming parser, metric math, API types).
- Auth is Cloudflare Access in front of the whole app; there is no login code in the app.

## Commands
- `npm run dev` — Vite + Worker locally at http://localhost:5173 (uses local D1 in `.wrangler/`).
  `wrangler.jsonc` sets `ACCESS_TEAM_DOMAIN`, so the local API answers 401; create `.dev.vars` with `ACCESS_TEAM_DOMAIN=""` for local work.
- `npm run db:reset:local` — recreate the local DB, apply migrations, load sample data.
- `npm test` — Vitest (parser + metrics). `npm run typecheck` — both tsconfigs.
- `npm run build` — production build. Pushing to the production branch deploys via Cloudflare Workers Builds (`npm run deploy`: migrations → build → deploy).
- `npm run build:preview` — single-file preview (in-browser SQLite + sample data) for claude.ai.

Before pushing: `npm run typecheck && npm test && npm run build` must all pass.

## Rules that matter
- **Meta is the only performance source.** Triple Whale was removed (Oct 2026, migration 0014); don't add it back without the owner asking.
- **Missing is not zero.** Ratios return `null` when the denominator is 0 and render as "—".
- **Money is integer cents** in the DB and API; convert only in `src/format.ts`.
- **Rank by post, not by ad.** Copies of an ad share a post (`effective_object_story_id`) and are grouped.
- **Pods come from ad set names** ("IH | Harris | …"), via `shared/attribution.ts`. Pods added in Settings (Trybe: "TRYBE | …") are rows in `pods` with a `prefix` and a color `slot` (`POD_SLOTS`), loaded into `GROUPS` per request (`worker/pods.ts`) and by the app from `/api/meta` (`src/podColors.ts`); never hard-code the pod list. An ad set naming an in-house pod and a partner ("Shameer | Trybe | …") counts for both (`co_pod_id`, `creditsPod`), once in totals (`sharedCents`). Agency ad sets (ME/QW/TV/YD) and anything launched before the pods started go to the **Agency** group, shown beside the pods but never counted in them. Ad names are mostly random. See `docs/NAMING.md`.
- **Pod members credit by person** (owner, Nov 11): an added pod's `members` named in an ad set credit that pod, over another in-house pod's prefix ("Pod 0 | Reika | …" → POD 1). POD 0 was split this way: Andrei (POD 0), Reika (POD 1), Adrian (POD 2), old ads included. Changing members or in-house re-credits at once; members are in the rules fingerprint.
- **Former pods** (`pods.active`, `left_on`, migration 0033; Harris and Dhia from Nov 10): their data stays everywhere (Rankings, concepts, reports), and their ad sets still credit them (their last ads are still launching). They leave the pod leaderboard's default view, the in-house views and spend by pod for ranges ending on or after `left_on` (`podActiveOn`); the leaderboard's "All pods, with former" filter shows them, labelled Former. Pickers list them last, "(former)". Settings → Pods & agency → Active.
- **Winner calls are the media buyer's only** (`worker/calls.ts`, `MEDIA_BUYER_EMAILS`): a miss they call a winner/super winner counts as a hit (`isHit` in `shared/metrics.ts`; never test `status === "hit"` alone). Syncs never change a call. See `docs/METRICS.md`.
- **CS report** (`worker/report.ts`, `shared/periods.ts`, `src/report.ts`): fortnightly; a concept counts in the period it launched, later results show as Late verdicts. Numbers come from stored data; only learnings/read are written (Claude task drafts, editors edit, an edit is never overwritten). See `docs/METRICS.md`.
- **BFCM** (`shared/bfcm.ts`, BFCM page): the CBO | Promo | BFCM campaign, Nov 8 – Dec 1, with Scale / Watch / Cut calls on the usual targets. Promo campaigns ("Promo" in the name) are never concepts, so they stay out of pod hit rates. See `docs/METRICS.md`.
- **Winner tiers** (`winnerTier`, `podScores` in `shared/metrics.ts`; `loadCopyTotals` in `worker/queries.ts`): a hit is a KPI winner; it becomes a Spend winner ($5k) or Breakthrough ($20k) on spend across every copy of its creatives while near KPI since launch (ROAS ≥ 1.5 or CPA ≤ $16), and drops back if it fades. The pod score's winners part counts 1 / 3 / 6 points per decided concept, KPI-only capped at 2/3. Thresholds in Settings → Targets. See `docs/METRICS.md`.
- **Hit rate is per concept, not per ad.** A concept is one testing ad set (`shared/concepts.ts`), split when older ad sets combined several ("Batch 3 & 5"). Scaling ad sets are never concepts. Once every ad in a concept is off, a concept still testing (or with no ad at $100) is judged at once on all its spend (`judgeTurnedOff`). Concepts are rebuilt on every sync, and automatically once after a deploy that changes the crediting/concept rules (`worker/rules.ts` fingerprints the rule code, its constants and the pods table) — no manual sync needed.
- **Angle/format are read from names** (`shared/classify.ts`) when not set by hand; add keywords with a test case from a real concept or ad set name.
- **Never overwrite manual tags.** `assignments.pod_source` is `manual | name | adset | era` (tags: `manual | name | atria`); a sync may only fill fields whose source isn't `manual`.
- **Metric definitions live in `shared/metrics.ts`** and are documented in `docs/METRICS.md`. Change both together, with tests.
- **New ad-name patterns** go in `shared/naming.ts` with a test case in `shared/naming.test.ts` using the real name. See `docs/NAMING.md`.
- Pod colors come from the validated palette in `src/index.css` (`--pod-*`). Always show the pod name next to its color. Status colors (good/warn/bad) are reserved and always paired with an icon.
- Charts: one y-axis per chart (no dual axes), hover tooltips, thin marks. See `docs/DESIGN.md`.
- **D1 writes are the scarce resource** (free plan: 100k rows written/day). Syncs read what is stored and write only changed rows; keep it that way, and test that an unchanged re-sync writes 0 rows.
- **D1 reads are capped too** (free plan: 5M rows read/day). Two versions (`worker/cache.ts`): `stats_version` for the ad numbers (bumped by `bumpStats`: a sync that wrote rows, a change in concept membership, new targets, Settings → Rebuild summaries) and `data_version` for everything shown (bumped by every write). The heavy loaders (concept numbers, test windows, fatigue, range totals, sparklines, account trend, hit creatives) are memoized with `scope: "stats"` and must depend on nothing a tag edit changes: group by pod/tags afterwards from current assignments. Results are stored in the `snapshots` table too, so fresh isolates don't recompute. Live-sized data (`scripts/measure-reads.ts`): Dashboard after a sync ~320k once, after a tag edit ~21k, on a fresh isolate ~120. `worker/summaries.test.ts` checks the cached pages equal a from-scratch recomputation after edits; extend it when you add a stats loader. D1 bills rows *read*, including sorts and window functions: read `ad_daily` from `ads` (`ads a CROSS JOIN ad_daily d ON d.ad_id = a.id`, so each ad's days come by key), find first/last spend with `ORDER BY d.date LIMIT 1` per ad, never scan all history per request, and avoid window functions over `ad_daily`. Check with `scripts/measure-reads.ts` after changing any query on `ad_daily`. Any new write path must call `bumpVersion` when it changed rows (requests that aren't sync/ingest are bumped by the middleware).
- Meta sync lives in `worker/meta/` (Graph API v26.0). Test against fake Graph responses with `worker/testing/db.ts` (sql.js D1); this sandbox can't reach graph.facebook.com.
- **Coverage map**: running ads by persona × awareness (`worker/coverage.ts`). Personas live in `personas`; Claude only drafts and suggests them (`/api/ingest/atria/personas`), people confirm in Settings, and Claude assigns ads only after that. Hand-set persona/offer in `assignments` win. See `docs/ATRIA.md`.
- Incrementality (7-day click / incremental attribution) was removed Nov 10 2026: the sync no longer requests it and nothing shows it; its old `ad_daily` columns are unused. Don't add it back without the owner asking. See `docs/METRICS.md`.
- **Gemini creative analysis** (`worker/analysis.ts`, `worker/gemini.ts`, `shared/analysis.ts`): Gemini watches an ad and returns fixed-list tags plus a readout, one row per creative in `creative_analyses`, beside Atria (never replacing it). Editors run it from the ad card; the nightly job analyzes new ads from $50 spent, capped per night. Hand edits always win. See `docs/ATRIA.md` → Gemini.
- Atria tags arrive via `/api/ingest/atria` from a weekly Claude task (Mondays) signed in with an Access service token (`requireService`); service tokens can't use any other write route. See `docs/ATRIA.md`.
- Connection, sync and editing routes require Cloudflare Access and a place on the edit list (`worker/access.ts`, `requireAccess` on each write route; `worker/roles.ts`, Settings → Who can edit). Everyone else signed in is view-only. Don't weaken that; new write routes use `requireAccess` too.
- **Warm-up after a sync** (`warmDashboard`, `WARM_PATHS` in `worker/index.ts`): the nightly sync and `/api/sync` with `warm` (Dashboard → Sync now, the last backfill window) make the dashboard's reads one at a time and store them, because eight panels rebuilding the stats in parallel in one isolate ran out of Worker resources (HTTP 503, Oct 23–24). Keep `WARM_PATHS` equal to the URLs the Dashboard requests. The internal key (`internalReadHeaders`) is per isolate and GET-only.
- **Never share an unfinished promise between requests** (module-level caches in `worker/cache.ts` hold only finished results): if the request that started it is cancelled, its I/O never completes and every request awaiting it hangs.
- D1 allows at most **100 bound values per statement**; chunk anything built from a list. `worker/testing/sqljs-d1.ts` enforces it in tests.
- **Read-only on Meta, permanently** (`ads_read`, plus `pages_show_list` + `pages_read_engagement` since Nov 10 so Gemini can download videos owned by the Page: `videoSource` in `worker/meta/media.ts`). The hub reports and analyses; it never creates, edits or pauses ads. Ad management is out of scope.
- Secrets (`META_APP_SECRET`, `TOKEN_KEY`, `GEMINI_API_KEY`) are Worker secrets, never in code or `wrangler.jsonc`. The Meta user token is stored encrypted in D1.
- Sample data (`scripts/gen-sample.ts`) is fake. The UI shows the "Sample data" banner until a Meta sync succeeds; the first connection wipes it. Never reseed a live database.
