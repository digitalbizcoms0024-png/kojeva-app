# Kojeva Hub

Internal performance and creative-intelligence tool for Kojeva's Meta ads. It ranks
ads, attributes them to the 4 creative pods (Harris, Dhia, Shameer, Ali) and
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
- `npm run db:reset:local` — recreate the local DB, apply migrations, load sample data.
- `npm test` — Vitest (parser + metrics). `npm run typecheck` — both tsconfigs.
- `npm run build` — production build. Deploy only when asked: `npm run deploy`.

Before pushing: `npm run typecheck && npm test && npm run build` must all pass.

## Rules that matter
- **Never blend Meta and Triple Whale numbers.** Show them side by side, always labelled with the source.
- **Missing is not zero.** Ratios return `null` when the denominator is 0 and render as "—".
- **Money is integer cents** in the DB and API; convert only in `src/format.ts`.
- **Rank by post, not by ad.** Copies of an ad share a post (`effective_object_story_id`) and are grouped.
- **Never overwrite manual tags.** `assignments.*_source` records `name | manual | atria`; a re-parse may only fill fields whose source is `name` or empty.
- **Metric definitions live in `shared/metrics.ts`** and are documented in `docs/METRICS.md`. Change both together, with tests.
- **New ad-name patterns** go in `shared/naming.ts` with a test case in `shared/naming.test.ts` using the real name. See `docs/NAMING.md`.
- Pod colors come from the validated palette in `src/index.css` (`--pod-*`). Always show the pod name next to its color. Status colors (good/warn/bad) are reserved and always paired with an icon.
- Charts: one y-axis per chart (no dual axes), hover tooltips, thin marks. See `docs/DESIGN.md`.
- Read-only Meta access (`ads_read`) until the ad-management phase. Any write action needs a preview, explicit approval, defaults to paused, and an audit log entry.
- Secrets (Meta token, Triple Whale key, ingest key) are Worker secrets (`wrangler secret put`), never in code or `wrangler.jsonc`.
- Sample data (`scripts/gen-sample.ts`) is fake. Any screen showing it must show the "Sample data" banner (driven by `DATA_MODE`).
