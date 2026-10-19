-- Computed read results stored once per data version, so a fresh Worker isolate (after a deploy, or
-- a second one serving another viewer) reads 1 row instead of recomputing from ad_daily (D1's free
-- plan allows 5M rows read a day). Emptied whenever the data changes (worker/cache.ts).
CREATE TABLE snapshots (
  key      TEXT PRIMARY KEY,
  version  TEXT NOT NULL,
  body     TEXT NOT NULL
);
