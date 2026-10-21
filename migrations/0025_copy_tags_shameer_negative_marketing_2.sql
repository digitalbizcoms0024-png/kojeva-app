-- One-off (Oct 21, 2026, the media buyer's request): the tags set by hand on ad "2" in
-- "Shameer | Static 3 | Negative Marketing #2" go to the other ads in that ad set. Everything but the
-- editor (angle, format, hook, landing page, awareness, belief group, persona, offer, motivations).
-- Saved as hand-set; ads already tagged by hand are left alone. Not a rule: later ads aren't copied.
WITH src AS (
  SELECT s.* FROM assignments s
  WHERE s.tags_source = 'manual'
    AND s.post_id = (SELECT post_id FROM ads WHERE adset_name = 'Shameer | Static 3 | Negative Marketing #2' AND name = '2' LIMIT 1)
)
INSERT INTO assignments (post_id, angle, format, hook, landing_page, awareness, belief_group, persona_id, offer, motivations, tags_source, updated_at, updated_by)
SELECT DISTINCT a.post_id, src.angle, src.format, src.hook, src.landing_page, src.awareness, src.belief_group, src.persona_id, src.offer, src.motivations,
  'manual', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'media buyer'
FROM ads a CROSS JOIN src
WHERE a.adset_name = 'Shameer | Static 3 | Negative Marketing #2' AND a.post_id <> src.post_id
ON CONFLICT(post_id) DO UPDATE SET
  angle = excluded.angle, format = excluded.format, hook = excluded.hook, landing_page = excluded.landing_page,
  awareness = excluded.awareness, belief_group = excluded.belief_group, persona_id = excluded.persona_id,
  offer = excluded.offer, motivations = excluded.motivations,
  tags_source = 'manual', updated_at = excluded.updated_at, updated_by = excluded.updated_by
WHERE assignments.tags_source IS NOT 'manual';
-- Shown data changed: drop saved responses (the stats stay).
INSERT INTO settings (key, value) VALUES ('data_version', lower(hex(randomblob(8)))) ON CONFLICT(key) DO UPDATE SET value = excluded.value;
DELETE FROM snapshots WHERE key NOT LIKE 'stats:%';
