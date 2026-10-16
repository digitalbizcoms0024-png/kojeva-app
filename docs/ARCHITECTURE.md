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

`meta_connections` (migration 0002) holds at most one encrypted Meta token with its expiry. Phase 4
adds `tw_ad_daily` so Triple Whale numbers never mix with Meta's.

## API
| Route | Returns |
|---|---|
| `GET /api/meta` | data mode, last sync, latest date, targets, pods |
| `GET /api/rankings?range=week\|month\|all\|custom&from&to&sort&pod&status&q&limit` | posts with totals in range, ranked |
| `GET /api/posts/:id?range…` | one post: totals, all-time totals, every copy, daily series |
| `GET /api/pods?range…` | per-pod totals, concepts launched, hits/misses/testing, hit rate, editors |

| `GET /api/connection` | Meta connection status, missing secrets, Access status, OAuth redirect URI |
| `GET /api/connection/facebook/start` → `/callback` | Facebook login (OAuth) |
| `POST /api/connection/token` | connect with a pasted token |
| `POST /api/connection/disconnect` | forget the stored token |
| `POST /api/sync` `{since, until, ads}` | sync one window (≤ 31 days) |
| `GET /api/concepts?range&pod` | concepts with judging window, totals and hit status |
| `PATCH /api/posts/:id/assignment` | set pod / editor / tags by hand, or `reset` to automatic |
| `POST /api/assignments/bulk` `{postIds, patch}` | same, for up to 500 posts |
| `PUT /api/settings` `{targets?, attribution?}` | edit targets; attribution changes re-credit every post |
| `POST /api/editors`, `DELETE /api/editors/:id` | editor roster |
| `POST /api/attribute` | re-credit every post from stored data |

Ranges are relative to the latest synced day, not the wall clock. Connection, sync and editing routes
return 403 until Cloudflare Access is configured; once it is, every `/api` call needs a valid Access JWT.
D1 accepts at most 100 bound values per statement; the test adapter enforces the same limit.

## Configuration
| Name | Kind | Where |
|---|---|---|
| `META_APP_ID`, `META_AD_ACCOUNT_ID`, `META_GRAPH_VERSION` | var | `wrangler.jsonc` |
| `ACCESS_TEAM_DOMAIN` (`tiny-band-a384.cloudflareaccess.com`) | var | `wrangler.jsonc` |
| `ACCESS_AUD` (optional: limits sign-ins to this one Access app) | var | `wrangler.jsonc` |
| `META_APP_SECRET` | secret | Worker → Settings → Variables and Secrets |
| `TOKEN_KEY` (random, 32+ chars) | secret | same |
| `META_SYSTEM_TOKEN` (optional) | secret | same |

Vars in `wrangler.jsonc` overwrite dashboard vars on every deploy; secrets are kept.

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
   - Deploy command: `npm run deploy` (applies migrations, builds, deploys). `deploy:sample` is an alias
     kept for the existing project setting; it no longer reseeds.
3. Worker → Settings → Domains & Routes → workers.dev → enable Cloudflare Access, allow the team's emails.
