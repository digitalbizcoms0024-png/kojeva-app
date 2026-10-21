-- Copies of a creative (a duplicated ad, a re-upload) get a new Meta video id or image hash, and
-- Atria tags each id on its own, following spend, so copies often stay untagged. Atria's preview
-- image is the same file for the same creative: preview_key is that file's name, and an untagged
-- asset whose preview matches a tagged one takes its tags and Claude's labels (twin_of = that asset).
ALTER TABLE atria_assets ADD COLUMN preview_key TEXT;
ALTER TABLE atria_assets ADD COLUMN twin_of TEXT;
CREATE INDEX atria_assets_preview ON atria_assets (preview_key);
CREATE INDEX atria_assets_twin ON atria_assets (twin_of);
