-- The Meta image hash a post's thumbnail was taken from, when the ad has several images (one per
-- placement): the hub shows the Facebook feed one, and keeps it until its URL expires.
ALTER TABLE posts ADD COLUMN thumb_hash TEXT;
