# Roadmap

Each phase is one branch + PR. A phase is done when its acceptance criteria pass.

## Phase 0: Spec + skeleton ✅ (this PR)
- Docs, `CLAUDE.md`, Cloudflare Worker + D1 schema + React app.
- Rankings (Ads / Pods / Editors), Dashboard, Naming Tool, read-only Needs Tagging and Settings, on **sample data**.
- Naming parser and metric math with tests built from real ad names.

## Phase 1: Live Meta data ✅ (built; first live sync pending)
- "Connect with Facebook" (OAuth, `ads_read`) or paste a Graph Explorer token. Either is swapped for a
  60-day token, checked against the ad account, and stored AES-GCM encrypted. An optional
  `META_SYSTEM_TOKEN` secret (never expires) takes precedence.
- Sync: all ads (every status) with ad set, campaign, creative and post ID; daily ad-level insights.
  Nightly cron re-pulls the last 7 days. Backfill 90/180/365 days from Settings, in 14-day requests.
- Thumbnails: Meta's URLs, refreshed every sync (they expire). Copying to R2 is deferred.
- Pods attributed on every sync with `shared/attribution.ts` (ad set name first); manual values kept.
- Sample data is wiped on first connection. Banners: sync failure, token expiry, not locked.
- Cloudflare Access JWT verified on every API call; Meta can't be connected until Access is configured.

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
