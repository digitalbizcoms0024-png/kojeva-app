# Atria creative tags

Atria tags Kojeva's creatives (videos and images) on ten dimensions: theme, core desire, persona,
emotions, visual hook, offer type, media format, production quality, key message, USP. It works
down the spend ranking, so the big spenders are tagged first (97% of 30-day spend in Oct 2026).

There is no Atria API key: Atria is reachable only through its Claude connector. So a **nightly
scheduled Claude task** reads tags with the connector and pushes them to the hub:

```
Claude task (Atria connector)                     Kojeva Hub (Worker)
  GET  /api/ingest/atria/pending   ───────────▶   assets needing tags, by spend
  Atria: get_ad_account_creative_tags (×20)
  POST /api/ingest/atria           ───────────▶   stored in atria_assets
```

Assets are keyed `v:<video id>` / `i:<image hash>` (from each ad's creative, recorded by the Meta
sync). Both routes accept only the Access **service token** whose client ID is `ATRIA_CLIENT_ID`;
people can't call them, and the token can't call anything else.

## One-time setup
1. **Service token** — Cloudflare → Zero Trust → Access controls → Service credentials → Service
   tokens → Create, name `kojeva-atria-sync`, duration "Non-expiring". Copy the **Client ID** and
   **Client Secret** (the secret is shown once).
2. **Let it through Access** — Zero Trust → Access controls → Applications → `kojeva-hub - Cloudflare
   Workers` → Policies → Add a policy: Action **Service Auth**, Include **Service Token** =
   `kojeva-atria-sync`. Save.
3. **Tell the hub which token** — put the Client ID in `wrangler.jsonc` → `vars.ATRIA_CLIENT_ID`
   (not secret on its own) and push.
4. **Let Claude reach the hub** — in the Claude Code cloud environment's settings (Edit environment):
   - Network access → **Custom**, Allowed domains `kojeva-hub.digitalbizcoms0024.workers.dev`, keep
     "Also include default list of common package managers" ticked.
   - Network secrets → Add secret: Allowed websites `kojeva-hub.digitalbizcoms0024.workers.dev`, Path
     prefix `/api/ingest/atria`, custom headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`
     (no prefix). Sessions get the headers added automatically and never see the values.
5. **Schedule the task**: "Kojeva Hub · Atria tag sync", daily 10:07 UTC (after the 09:17 Meta sync),
   fresh session per run. Add the **Atria connector** to it in claude.ai's scheduled tasks.

## Nightly task prompt
```
Sync Atria creative tags into Kojeva Hub. Use bash + curl and the Atria connector.
Hub: https://kojeva-hub.digitalbizcoms0024.workers.dev
The environment's network secret adds the Access headers to /api/ingest/atria requests automatically.
Atria account_id: 8d763d97729547f9839030bdbbfac292

Repeat up to 5 rounds:
1. GET /api/ingest/atria/pending?limit=60 → { assets: [{ assetId, videoId, imageHash }] }.
   Stop when the list is empty.
2. In batches of up to 20, call Atria get_ad_account_creative_tags with the videoIds as
   video_ids and imageHashes as image_hashes.
3. POST /api/ingest/atria with JSON { "assets": [...] } where each item is
   { "assetId": "v:<video_id>" or "i:<image_hash>",
     "status": untagged_reason ?? "tagged",
     "tags": tags (only when status is "tagged") }.
Never request transcriptions (they cost Atria credits). Finish with one line: rounds run,
assets sent, how many were tagged. If a hub call fails, report the status and body and stop.
```
