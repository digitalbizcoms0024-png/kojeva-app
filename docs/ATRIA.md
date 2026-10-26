# Atria creative tags

Atria tags Kojeva's creatives (videos and images) on ten dimensions: theme, core desire, persona,
emotions, visual hook, offer type, media format, production quality, key message, USP. It works
down the spend ranking, so the big spenders are tagged first (97% of 30-day spend in Oct 2026).

There is no Atria API key: Atria is reachable only through its Claude connector. So a **weekly
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
     prefix `/api/ingest`, custom headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`
     (no prefix). Sessions get the headers added automatically and never see the values.
5. **Schedule the task**: "Kojeva Hub · Atria tag sync", Mondays 10:07 UTC (after the 09:17 Meta sync),
   fresh session per run. Add the **Atria connector** to it in claude.ai's scheduled tasks.
   Weekly, not daily, to save Atria credits (owner, Oct 26).

**What it asks Atria about** (`/api/ingest/atria/pending`): creatives with spend in the last 30 days
that Atria hasn't been asked about, plus, a week after the last ask, ones Atria hadn't tagged yet or
sent no preview for. A tagged creative with its preview is final and never asked about again.

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

1. **Draft.** With no personas yet, the weekly task reads `GET /api/ingest/atria/personas` (Atria's
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
- **Replacing drafts.** While no persona is confirmed, `POST /personas` with `replaceDrafts: true`
  deletes the current drafts (and clears any Claude assignments to them) before adding the new
  list. Once one is active it answers 409: change confirmed personas in Settings.

## Format suggestions
Claude also suggests each creative's **format** (`FORMATS` / `FORMAT_DEFINITIONS` in
`shared/taxonomy.ts`). `/unlabeled` returns assets without a format decision, the format list with
definitions, and up to 3 Meta ad ids per asset (`adIds`). The task gets the video file through the Atria
tool `get_ad_account_ad`, pulls ~8 frames across it with ffmpeg and judges from them plus Atria's tags
(media format, production quality, visual hook). `/labels` takes optional `format` (a key, or null if
none fits), stored in `atria_assets.format_label`. It's a suggestion only: the concept's format stays
hand-set, then read from names, and Needs Tagging shows "Claude: … · use" to accept it. The task's
environment must allow `cdn.tryatria.com` (and `*.fbcdn.net`).

## Motivations
Why a viewer would buy, separate from who they are (`MOTIVATIONS` in `shared/taxonomy.ts`): proof
needed, price/value, under-eye puffiness, comfort, convenience, self-care/relaxation and
demonstration-led discovery. `/unlabeled` returns assets without a motivation decision plus the keys;
`/labels` takes optional `motivations` (a list of keys, `[]` for none). A hand-set list in Needs
Tagging wins until "Use Claude's label". Concepts carry the union of their ads' lists, and Insights
has a "By motivation" panel.

## Weekly task prompt
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

## Copies of a creative
A duplicated or re-uploaded ad gets a new Meta video id or image hash, and Atria tags each id on
its own (following spend), so copies often stay `not_tagged_yet`. The weekly task sends Atria's
`preview_image_url` with every asset; its file name is the same for copies of one creative and is
stored as `atria_assets.preview_key`. An untagged asset whose preview matches a tagged one takes
that asset's tags and Claude's labels (`twin_of`, migration 0024). Claude labels only the original;
its copies' spend counts toward its place in the label queue and new labels pass on to the copies.
A copy's own Atria tags win once it has them. `GET /api/ingest/atria/gaps` (read-only) says why
posts that spent in the last 7 days still have no tags.

## Creatives Atria hasn't tagged
Atria tags following spend, so new and small creatives can wait a long time, and some ads (Meta
hides the media of "Post ID" ads from `ads_read`) can't be sent to Atria at all; those stand in
with `p:<post id>` as their asset id. `/api/ingest/atria/unlabeled` lists them too with
`atriaTagged: false`, and the weekly task labels them by looking at the ad itself (frames, copy,
names). When Atria tags one later its tags change, so it's labelled again with them.

## Looking at an ad without Atria credits
Every Atria connector call uses Atria credits, so the weekly task fetches only tags from Atria.
To look at an ad (format, and labels for creatives Atria hasn't tagged) it calls
`GET /api/ingest/atria/media/<ad id>`, which reads the ad's copy and a video or image link through
the hub's own Meta connection (`worker/meta/media.ts`, read-only). When Meta hides a video from
`ads_read` ("Post ID" ads) the route still returns the copy and a thumbnail.

## Coverage map: what's mapped
The map places ads that spent at least `MIN_MAP_SPEND_CENTS` ($50) in the selected period
(`shared/metrics.ts`); smaller tests still count everywhere else and are listed as "not mapped".
"Not on the map" is shown as spend (and its share of mapped spend), with the biggest unplaced ads,
so small tests don't inflate it. Needs Tagging → Not on the coverage map lists the same ads: tick
several and set a persona and awareness once to place them all (hand-set, so never overwritten).
