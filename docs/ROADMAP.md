# Roadmap

Each phase is one branch + PR. A phase is done when its acceptance criteria pass.

## Phase 0: Spec + skeleton ✅ (this PR)
- Docs, `CLAUDE.md`, Cloudflare Worker + D1 schema + React app.
- Rankings (Ads / Pods / Editors), Dashboard, Naming Tool, read-only Needs Tagging and Settings, on **sample data**.
- Naming parser and metric math with tests built from real ad names.

## Phase 1: Live Meta data ✅ (built; first live sync pending)
- Paste a Graph Explorer token (the app's Marketing API use case has no Facebook Login, so the OAuth
  route exists but Meta refuses its redirect). The token is swapped for a
  60-day token, checked against the ad account, and stored AES-GCM encrypted.
- Graph paging halves the page size and retries when Meta answers "reduce the amount of data". An optional
  `META_SYSTEM_TOKEN` secret (never expires) takes precedence.
- Sync: all ads (every status) with ad set, campaign, creative and post ID; daily ad-level insights.
  Nightly cron re-pulls the last 7 days. Backfill 90/180/365 days from Settings, in 14-day requests.
- Thumbnails: Meta's URLs, refreshed every sync (they expire). Copying to R2 is deferred.
- Pods attributed on every sync with `shared/attribution.ts` (ad set name first); manual values kept.
  Agency group (migration 0003) for ME/QW/TV/YD ad sets and anything launched before the pods.
- Hit rate per concept (migration 0004): one testing ad set = one concept, combined ad sets split by
  ad name. Concepts table on the Pods tab.
- Sample data is wiped on first connection. Banners: sync failure, token expiry, not locked.
- Cloudflare Access JWT verified on every API call; Meta can't be connected until Access is configured.

**Done when:** totals for a date range match Ads Manager (same timezone, 7-day click / 1-day view
attribution, same purchase event) within 1%; copies are grouped by post; 2,000+ posts stay fast.

## Phase 2: Attribution ✅
- Needs Tagging: inline + bulk edit of pod / editor / angle / format / hook / landing page. Hand-set
  values are `manual` and survive syncs; "use auto" / "Back to automatic" hands them back.
- Settings: editable targets (CPA, ROAS, judging days, qualifying spend, hit rule), agency codes and
  pods start date (saving re-credits every post from stored data, no Meta call), editor roster.
- All edits require Cloudflare Access and record who made them (`updated_by`).
- Later, if needed: attribution conflict review, creative-tracker import.

**Done when:** ≥ 90% of last-30-day spend is credited to a pod or the agency.

## Phase 3: Creative intelligence (in progress)
- ✅ Angle and format read from concept, ad set and ad names (`shared/classify.ts`), tested on real
  names; hand-set tags win. Synced posts get these as their automatic tags.
- ✅ Creative Insights page: hit rate, test CPA / ROAS / spend per angle or format, by pod and period,
  with a drill-down to the concepts behind each row. Thin samples (< 3 decided) are flagged.
- ✅ (app side) Atria tags: Meta sync records each ad's video/image; `/api/ingest/atria` (service
  token only) receives tags from a nightly Claude task; tags shown on ads, concepts, and Insights "By
  Atria theme" / "By core desire". Setup steps in `docs/ATRIA.md`. Transcripts skipped (cost credits).
- ⏸ Parked (remind the user): "Why it works" AI notes per winning concept, citing its numbers. Needs a
  Claude API key as a Worker secret; a few dollars a month.

## Design pass ✅
- New look from Claude Design (see `docs/DESIGN.md`), separate Pods page, dashboard alerts (fatigue, new hits,
  untagged spend), suggested pods with Accept in Needs Tagging, configurable amber CPA band, recently
  generated names in the Naming Tool (per browser).

## Phase 4: Triple Whale + analytics (in progress)
- ✅ (app side) Triple Whale attributed orders/revenue per ad and day ("Clicks & deterministic views",
  lifetime), pushed nightly by a Claude task to `/api/ingest/tw` (`docs/TRIPLE_WHALE.md`). Shown as
  separate "· TW" values: Dashboard ROAS tile, ranking cards, ad detail, Pods page and table.
- Fatigue signals (frequency ↑, CTR ↓, CPA drift), trend charts, CSV export.

## Phase 5: Operations (needs `ads_management`)
- Approval queue: copy winners to Cost Cap Scale / Bid Cap Graveyard by post ID, pause losers.
- Every action previewed, approved, created paused, logged.
