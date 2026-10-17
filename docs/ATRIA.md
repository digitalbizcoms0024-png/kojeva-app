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
     prefix `/api/ingest` (covers the Triple Whale route too), custom headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`
     (no prefix). Sessions get the headers added automatically and never see the values.
5. **Schedule the task**: "Kojeva Hub · Atria tag sync", daily 10:07 UTC (after the 09:17 Meta sync),
   fresh session per run. Add the **Atria connector** to it in claude.ai's scheduled tasks.

## Awareness level and belief (labelled by the same task)
Atria has no awareness or belief tag, so after syncing tags the task labels each tagged creative itself
(no transcripts, no API key): `GET /api/ingest/atria/unlabeled` lists tagged assets without labels (or
whose tags changed), with their tags, ad names and the **belief groups already in use**;
`POST /api/ingest/atria/labels` stores `{ assetId, awareness, belief, beliefGroup }`.

- **awareness**: Schwartz's five levels: `unaware | problem | solution | product | most`.
- **belief**: Claude's sentence, "<believes now> → <ad makes them believe>".
- **beliefGroup**: a short shared name (reused across creatives) that Insights groups by.
- A concept's awareness is the most common label across its creatives; its belief groups are the union.
- Hand-set values in Needs Tagging (Awareness, Belief shifted) always win. Re-sending unchanged labels
  writes 0 rows.

## Personas and offer (coverage map)
The coverage map (`worker/coverage.ts`, Coverage Map page) places every running ad by persona ×
awareness level. Personas are a short list of specific people (table `personas`):

1. **Draft.** With no personas yet, the nightly task reads `GET /api/ingest/atria/personas` (Atria's
   persona tags by spend) and posts 5–8 drafts to `POST /api/ingest/atria/personas`.
2. **Confirm.** People rename, merge, delete or add them in Settings → Personas and press Confirm.
   Until then Claude doesn't assign personas and the map shows an empty state.
3. **Assign.** `/unlabeled` then also returns assets without a persona decision plus the active
   personas; `/labels` takes `personaId` (an active persona, or null for "fits none") and `offer`
   (discount/price offer, true/false). Both are optional so older prompts keep working.
4. **Suggest.** When several ads fit nobody, the task posts one persona as a suggestion (at most 3
   waiting). People approve or dismiss it; dismissed names aren't suggested again.

- Adding or approving a persona sends the "fits none" creatives back to Claude for another look.
  Deleting one sends its creatives back too; merging moves them to the other persona.
- Hand-set persona, awareness and offer in Needs Tagging always win (`assignments.persona_id`,
  `assignments.offer`). Re-sending unchanged labels writes 0 rows.

## Nightly task prompt
The live prompt is stored on the scheduled task "Kojeva Hub · Atria tag sync". Part 1 is the tag sync
below; part 2 keeps the persona list going (drafts when empty); part 3 runs `/unlabeled` → label →
`/labels` in up to 3 rounds of 40 with the level definitions, belief format, offer and persona above,
reusing existing belief group names, then suggests at most one new persona.

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
