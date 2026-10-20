-- One-off: formats set by the media buyer (Oct 20, 2026) for concepts whose names carry no
-- format word. Saved as hand-set tags (tags_source = 'manual'), so syncs never change them.
UPDATE assignments SET format = 'AIUGC', tags_source = 'manual', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = 'media buyer'
WHERE post_id IN (SELECT post_id FROM ads WHERE adset_name IN (
  'IH | Harris | KOJEVA 15 | 7 REASONS',
  'IH | Harris | KOJEVA 15 | DOUBLE CHIN',
  'IH | Harris | KOJEVA 15 | FAKE BRUSH',
  'IH | Harris | KOJEVA 15 | DEPUFF',
  'Dhia | Problem Vs Solution 2',
  'Dhia | Kojeva_AskHerWhichBrush_AdRecreation_Brief',
  'Dhia | Kojeva_MorningRoutineGirlies_Brief'
));
UPDATE assignments SET format = 'Animation', tags_source = 'manual', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = 'media buyer'
WHERE post_id IN (SELECT post_id FROM ads WHERE adset_name = 'IH | Harris | KOJEVA 15 | HUSBAND');
UPDATE assignments SET format = 'AIDrama', tags_source = 'manual', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = 'media buyer'
WHERE post_id IN (SELECT post_id FROM ads WHERE adset_name = 'IH | Harris | KOJEVA 15 | MINI MOVIE');
-- Shown data changed: drop saved responses (the stats stay).
INSERT INTO settings (key, value) VALUES ('data_version', lower(hex(randomblob(8)))) ON CONFLICT(key) DO UPDATE SET value = excluded.value;
DELETE FROM snapshots WHERE key NOT LIKE 'stats:%';
