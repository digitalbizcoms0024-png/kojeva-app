-- Phase 1: live Meta data.

-- Meta's thumbnail URLs are signed and expire, so they're refreshed on every sync.
ALTER TABLE posts ADD COLUMN thumbnail_url TEXT;
ALTER TABLE posts DROP COLUMN thumbnail_key;
ALTER TABLE ads ADD COLUMN creative_id TEXT;
ALTER TABLE ads ADD COLUMN updated_at TEXT;

-- At most one connection. The token is AES-GCM encrypted with the TOKEN_KEY secret.
CREATE TABLE meta_connections (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  method        TEXT NOT NULL,                   -- oauth | pasted
  user_id       TEXT,
  user_name     TEXT,
  ad_account_id TEXT NOT NULL,
  token_cipher  TEXT NOT NULL,
  token_iv      TEXT NOT NULL,
  expires_at    TEXT,                            -- NULL = never expires
  connected_at  TEXT NOT NULL,
  connected_by  TEXT                             -- Access email of whoever connected
);
