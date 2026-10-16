# Roadmap

Each phase is one branch + PR. A phase is done when its acceptance criteria pass.

## Phase 0: Spec + skeleton ✅ (this PR)
- Docs, `CLAUDE.md`, Cloudflare Worker + D1 schema + React app.
- Rankings (Ads / Pods / Editors), Dashboard, Naming Tool, read-only Needs Tagging and Settings, on **sample data**.
- Naming parser and metric math with tests built from real ad names.

## Phase 1: Live Meta data
**Needs:** a Meta developer app (see `ARCHITECTURE.md` → Meta), the Cloudflare account, D1 database created.
- "Connect with Facebook" (Facebook Login for Business, `ads_read`), with token stored encrypted in D1.
  Later, an optional system-user token for a connection that never expires.
- Nightly Cron sync: ads, ad sets, campaigns, creatives (`effective_object_story_id`), daily insights.
  Re-pull the last 7 days every run (late attribution). Backfill 90+ days via Queues.
- Copy thumbnails to R2 (Meta URLs expire).
- Attribute pods on every sync with `shared/attribution.ts` (ad set name first), skipping manual assignments.
- Banner: last successful sync; reconnect warning before the token expires.
- Cloudflare Access in front of the app.

**Done when:** totals for a date range match Ads Manager (same timezone, 7-day click / 1-day view
attribution, same purchase event) within 1%; copies are grouped by post; 2,000+ posts stay fast.

## Phase 2: Attribution
- Review attribution conflicts (copies whose ad sets name different strategists).
- Needs Tagging: inline + bulk edit of pod / editor / angle / format / hook / landing page.
- Optional one-time import of a creative tracker (creative ID → strategist).
- Editable targets and pod roster in Settings.

**Done when:** ≥ 90% of last-30-day spend is attributed to a pod.

## Phase 3: Creative intelligence
- Atria tags + transcripts via a nightly scheduled Claude task that posts to `/api/ingest/atria`.
- Creative Insights: CPA / ROAS / hit rate by angle, format, hook. Concept grouping.
- "Why it works" AI notes, always citing the numbers they're based on.

## Phase 4: Triple Whale + analytics
- Triple Whale attributed revenue/ROAS per ad as separate columns.
- Fatigue signals (frequency ↑, CTR ↓, CPA drift), trend charts, CSV export.

## Phase 5: Operations (needs `ads_management`)
- Approval queue: copy winners to Cost Cap Scale / Bid Cap Graveyard by post ID, pause losers.
- Every action previewed, approved, created paused, logged.
