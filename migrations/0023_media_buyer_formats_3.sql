-- One-off: the media buyer's format for 7 Reasons after checking the ad (Oct 21, 2026). Hand-set.
UPDATE assignments SET format = 'AIVoiceover', tags_source = 'manual', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = 'media buyer'
WHERE post_id IN (SELECT post_id FROM ads WHERE adset_name = 'IH | Harris | KOJEVA 15 | 7 REASONS');
INSERT INTO settings (key, value) VALUES ('data_version', lower(hex(randomblob(8)))) ON CONFLICT(key) DO UPDATE SET value = excluded.value;
DELETE FROM snapshots WHERE key NOT LIKE 'stats:%';
