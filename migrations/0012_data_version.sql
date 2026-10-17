-- A token that changes whenever stored data changes (sync, Atria/Triple Whale ingest, any edit).
-- Read results are cached in memory under it, so repeat page views read 1 row instead of the
-- whole daily table (D1 free plan: 5M rows read/day). See worker/cache.ts.
INSERT OR IGNORE INTO settings (key, value) VALUES ('data_version', lower(hex(randomblob(8))));
