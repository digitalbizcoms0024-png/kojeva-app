# Triple Whale

Triple Whale's pixel credits orders to ads its own way. The hub shows those numbers **beside**
Meta's, labelled "· TW" or "Triple Whale", and never adds the two together.

- **Model:** "Clicks & deterministic views", lifetime window. In Triple Whale's data the model is
  called `Clicks & Views`; the hub stores which model each day came from (`tw_days.model`).
- **What's stored:** per Meta ad and day, attributed orders (fractional, stored ×1000) and attributed
  revenue in cents (`tw_daily`). Spend is Meta's, so Triple Whale ROAS = TW revenue ÷ Meta spend, and
  Triple Whale CPA = Meta spend ÷ TW orders (`shared/metrics.ts`).
- **Dates:** Triple Whale's are in the shop's time zone (America/Chicago).
- **Missing is not zero:** a period with no synced Triple Whale day shows "—". Once a day is synced,
  an ad with no row that day had nothing attributed. If only part of a period is synced, the page
  says so ("Triple Whale: 12 of 30 days synced").
- **Writes:** each push is diffed against what's stored. An unchanged re-send writes 0 rows. About
  90 ads have attributed orders per day, so the nightly 7-day refresh writes a few hundred rows at most.

There is no Triple Whale API key. Triple Whale is reached through its Claude connector, so a
**nightly scheduled Claude task** reads it and pushes the numbers to the hub, the same way the Atria
task works:

```
Claude task (Triple Whale connector)              Kojeva Hub (Worker)
  GET  /api/ingest/tw/pending      ───────────▶   days to send (last 7 + unsynced days in the last 90)
  Triple Whale: run-sql on pixel_joined_tvf
  POST /api/ingest/tw              ───────────▶   stored in tw_daily / tw_days
```

Both routes accept only the Access service token whose client ID is `ATRIA_CLIENT_ID`: the same
token the Atria task uses. People can't call them, and the token can't call anything else.

## One-time setup
1. **Let the token's headers reach the new route.** In the Claude Code cloud environment
   (Edit environment → Network secrets), edit the existing secret's **Path prefix** from
   `/api/ingest/atria` to `/api/ingest`. That covers both `/api/ingest/atria` and `/api/ingest/tw`.
2. **Schedule the task:** "Kojeva Hub · Triple Whale sync", daily 10:37 UTC (after the 09:17 Meta
   sync and the 10:07 Atria task), fresh session per run, in the same environment. Add the
   **Triple Whale connector** to it in claude.ai's scheduled tasks.
3. Run it once by hand. The first run backfills the most recent 21 unsynced days; each night after
   that adds 21 more until the last 90 days are filled, and always re-pulls the last 7.

## Nightly task prompt
```
Sync Triple Whale attribution into Kojeva Hub. Use bash + curl and the Triple Whale connector
(tools named mcp__TripleWhale_MCP__*; load them with ToolSearch if needed). Do not modify any code
or repository.

Hub: https://kojeva-hub.digitalbizcoms0024.workers.dev
The environment's network secret adds the Cloudflare Access headers to requests under /api/ingest
automatically. Do not add, print, or look for them yourself.

1. GET /api/ingest/tw/pending?limit=21 → { "model": "Clicks & Views", "dates": [...] }.
   Stop if dates is empty.
2. For each group of up to 3 dates, run Triple Whale run-sql (maxRows 500) with exactly:
   SELECT p.event_date AS date, p.ad_id AS ad_id, SUM(p.orders_quantity) AS orders,
     SUM(p.order_revenue) AS revenue
   FROM pixel_joined_tvf() AS p
   WHERE p.channel = 'facebook-ads' AND p.model = 'Clicks & Views'
     AND p.attribution_window = 'lifetime' AND p.event_date IN (<the dates, quoted>)
     AND (p.orders_quantity > 0 OR p.order_revenue > 0)
   GROUP BY date, ad_id ORDER BY date, ad_id
   If the result is truncated, re-run one date at a time; if a single date is still truncated,
   add AND p.ad_id > '<last ad_id received>' and repeat until it isn't.
3. POST /api/ingest/tw with Content-Type: application/json and body
   { "model": "Clicks & Views",
     "days": [ { "date": "YYYY-MM-DD",
                 "ads": [ { "adId": "<ad_id>", "orders": <orders>, "revenue": <revenue> } ] } ] }
   Send every date from the group, even one with no rows (that records 0 attributed). Send the
   values as returned; the hub rounds them and skips rows whose ad_id isn't a Meta ad ID.

If a Triple Whale call fails, skip that group (don't send those dates) and continue. If a hub call
fails, report the HTTP status and body and stop. Finish with one line: dates sent, rows sent, rows
written, rows skipped.
```
