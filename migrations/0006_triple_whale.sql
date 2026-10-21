-- Triple Whale pixel-attributed results per Meta ad and day, pushed by a nightly Claude task
-- (see docs/TRIPLE_WHALE.md). Kept apart from ad_daily: Meta and Triple Whale are never blended.
CREATE TABLE tw_daily (
  ad_id          TEXT NOT NULL,          -- Meta ad ID (Triple Whale's ad_id for facebook-ads)
  date           TEXT NOT NULL,          -- shop time zone (America/Chicago)
  orders_milli   INTEGER NOT NULL,       -- attributed orders × 1000 (multi-touch models give fractions)
  revenue_cents  INTEGER NOT NULL,       -- attributed order revenue
  PRIMARY KEY (ad_id, date)
);
CREATE INDEX tw_daily_date ON tw_daily(date);

-- Days Triple Whale has been synced for. A day listed here with no tw_daily row for an ad means
-- 0 attributed orders; a day not listed here is unknown (shown as "—").
CREATE TABLE tw_days (
  date       TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  synced_at  TEXT NOT NULL
);
