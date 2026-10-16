-- Atria creative tags, keyed by creative asset: "v:<video id>" or "i:<image hash>".
-- Filled nightly by a scheduled Claude task through /api/ingest/atria.
ALTER TABLE ads ADD COLUMN asset_id TEXT;
CREATE INDEX ads_asset ON ads(asset_id);
CREATE TABLE atria_assets (
  asset_id   TEXT PRIMARY KEY,
  status     TEXT NOT NULL,   -- tagged | not_tagged_yet | incomplete_tags | not_in_account
  tags       TEXT,            -- JSON: { theme: [...], core_desire: [...], ... }
  fetched_at TEXT NOT NULL
);
