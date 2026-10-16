# Architecture

```
Browser ──► Cloudflare Access (Google login for the team)
              │
              ▼
        Worker "kojeva-hub"
          ├─ static assets (React app, dist/client)
          ├─ /api/*  Hono routes ──► D1 "kojeva-hub"
          ├─ Cron trigger (Phase 1): Meta sync ──► D1, thumbnails ──► R2
          └─ /api/ingest/* (Phase 3): Atria data pushed by a scheduled Claude task
```

## Data model (`migrations/0001_init.sql`)
| Table | One row per | Notes |
|---|---|---|
| `pods` | creative pod | id, code used in names (HAR/DHI/SHA/ALI), strategist name, color |
| `editors` | editor | belongs to a pod |
| `posts` | Meta post (`effective_object_story_id`) | the unit we rank; copies share it |
| `ads` | Meta ad ID | name, campaign, ad set, status, `post_id` |
| `assignments` | post | pod, editor, angle, format, hook, landing page + where each came from |
| `ad_daily` | ad × day | spend, impressions, link clicks, purchases, revenue (Meta-reported, cents) |
| `settings` | key | targets, legacy prefix map (JSON) |
| `sync_runs` | sync attempt | source, status, timestamps; drives the "last synced" banner |

Phase 1 adds `meta_connections` (encrypted token, expiry, ad account). Phase 4 adds
`tw_ad_daily` so Triple Whale numbers never mix with Meta's.

## API
| Route | Returns |
|---|---|
| `GET /api/meta` | data mode, last sync, latest date, targets, pods |
| `GET /api/rankings?range=week\|month\|all\|custom&from&to&sort&pod&status&q&limit` | posts with totals in range, ranked |
| `GET /api/posts/:id?range…` | one post: totals, all-time totals, every copy, daily series |
| `GET /api/pods?range…` | per-pod totals, concepts launched, hits/misses/testing, hit rate, editors |

Ranges are relative to the latest synced day, not the wall clock.

## Meta connection (Phase 1)
**Option A: Connect with Facebook (default).** The user clicks "Connect", logs in, grants
`ads_read`, picks `act_2930078677198801`. Needs a Meta developer app (any team member can create
one; it doesn't need to belong to Kojeva's Business Manager). Keep it in Development mode and add
teammates as app testers. The long-lived user token lasts ~60 days, so the app warns before expiry.

**Option B: System user token (permanent, needs a Business admin).** Business Settings → System
users → add → assign the ad account (View performance) and the app → generate a token with
`ads_read`, no expiry. Stored with `wrangler secret put META_TOKEN`.

The app supports both; B wins when present.

## Triple Whale (Phase 4)
API key from Triple Whale → Settings → API Keys, stored as a Worker secret.

## Atria (Phase 3)
Atria is only reachable through its MCP connector inside Claude, not from the Worker. A
scheduled Claude task runs nightly, reads tags/transcripts via the Atria MCP, and POSTs them to
`/api/ingest/atria` with a shared ingest key. Atria is enrichment only; the app works without it.

## Deploying (Cloudflare Workers Builds, auto-deploys from GitHub)
1. Cloudflare dashboard → Storage & databases → D1 → Create database `kojeva-hub`; put its ID in `wrangler.jsonc`.
2. Workers & Pages → Create → Import a repository → `kojeva-app`.
   - Build command: *(empty)*
   - Deploy command: `npm run deploy:sample` until Phase 1 (**it wipes and reseeds the DB on every deploy**), then `npm run deploy`.
3. Worker → Settings → Domains & Routes → workers.dev → enable Cloudflare Access, allow the team's emails.
