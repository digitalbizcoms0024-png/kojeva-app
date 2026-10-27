-- Ads with an image per placement could keep Meta's Stories image while the feed image's hash stayed
-- stored, so later syncs thought the feed image was in place (ad "1", Oct 26). Forget the hashes so
-- the next sync looks every such thumbnail up again (one row written per such post, once).
UPDATE posts SET thumb_hash = NULL WHERE thumb_hash IS NOT NULL;
