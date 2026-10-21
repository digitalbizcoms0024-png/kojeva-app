-- One-off: the media buyer's corrections after checking the ads (Oct 21, 2026), replacing the
-- "AI UGC" umbrella from 0018. Hand-set (tags_source = 'manual'): syncs never change them.
UPDATE assignments SET format = 'UGC', tags_source = 'manual', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = 'media buyer'
WHERE post_id IN (SELECT post_id FROM ads WHERE adset_name = 'IH | Harris | KOJEVA 15 | HUSBAND');
UPDATE assignments SET format = 'AIVoiceover', tags_source = 'manual', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = 'media buyer'
WHERE post_id IN (SELECT post_id FROM ads WHERE adset_name IN (
  'IH | Harris | KOJEVA 15 | DEPUFF',
  'Dhia | Kojeva_AskHerWhichBrush_AdRecreation_Brief',
  'Dhia | Kojeva_MorningRoutineGirlies_Brief'
));
UPDATE assignments SET format = 'UGCMontage', tags_source = 'manual', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = 'media buyer'
WHERE post_id IN (SELECT post_id FROM ads WHERE adset_name = 'Dhia | Problem Vs Solution 2');
-- Shown data changed: drop saved responses (the stats stay).
INSERT INTO settings (key, value) VALUES ('data_version', lower(hex(randomblob(8)))) ON CONFLICT(key) DO UPDATE SET value = excluded.value;
DELETE FROM snapshots WHERE key NOT LIKE 'stats:%';
