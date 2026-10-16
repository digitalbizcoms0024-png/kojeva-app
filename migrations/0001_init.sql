-- Kojeva Hub schema. Money is integer cents; dates are 'YYYY-MM-DD' in the ad
-- account's timezone. See docs/ARCHITECTURE.md for the entity model.

CREATE TABLE pods (
  id    TEXT PRIMARY KEY,           -- 'harris'
  code  TEXT NOT NULL UNIQUE,       -- 'HAR', used in ad names
  name  TEXT NOT NULL,              -- the pod's creative strategist
  color TEXT NOT NULL
);

CREATE TABLE editors (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  pod_id TEXT REFERENCES pods(id)
);

-- One row per Meta post (effective_object_story_id). Copies of an ad share a post.
CREATE TABLE posts (
  id            TEXT PRIMARY KEY,
  media_type    TEXT NOT NULL DEFAULT 'video',   -- video | image | carousel
  thumbnail_key TEXT,                            -- R2 object key
  created_time  TEXT
);

-- One row per Meta ad ID.
CREATE TABLE ads (
  id            TEXT PRIMARY KEY,
  post_id       TEXT NOT NULL REFERENCES posts(id),
  name          TEXT NOT NULL,
  campaign_id   TEXT,
  campaign_name TEXT,
  adset_id      TEXT,
  adset_name    TEXT,
  status        TEXT NOT NULL,                   -- ACTIVE | PAUSED | ARCHIVED | ...
  created_time  TEXT
);
CREATE INDEX ads_post ON ads(post_id);

-- Who made a post and what it is. Each field records where its value came from
-- so a manual edit is never overwritten by a re-parse.
CREATE TABLE assignments (
  post_id       TEXT PRIMARY KEY REFERENCES posts(id),
  pod_id        TEXT REFERENCES pods(id),
  pod_source    TEXT,                            -- manual | name | adset
  editor_id     TEXT REFERENCES editors(id),
  angle         TEXT,
  format        TEXT,
  hook          TEXT,
  landing_page  TEXT,
  tags_source   TEXT,                            -- name | manual | atria
  updated_at    TEXT,
  updated_by    TEXT
);

-- Meta-reported daily delivery per ad.
CREATE TABLE ad_daily (
  ad_id          TEXT NOT NULL REFERENCES ads(id),
  date           TEXT NOT NULL,
  spend_cents    INTEGER NOT NULL DEFAULT 0,
  impressions    INTEGER NOT NULL DEFAULT 0,
  link_clicks    INTEGER NOT NULL DEFAULT 0,
  purchases      INTEGER NOT NULL DEFAULT 0,
  revenue_cents  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, date)
);
CREATE INDEX ad_daily_date ON ad_daily(date);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                            -- JSON
);

CREATE TABLE sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,                     -- meta | triplewhale | atria | sample
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,                     -- running | ok | error
  message     TEXT
);

INSERT INTO pods (id, code, name, color) VALUES
  ('harris',  'HAR', 'Harris',  '#2a78d6'),
  ('dhia',    'DHI', 'Dhia',    '#eb6834'),
  ('shameer', 'SHA', 'Shameer', '#1baf7a'),
  ('ali',     'ALI', 'Ali',     '#eda100');

INSERT INTO settings (key, value) VALUES
  ('targets', '{"targetCpa":14,"targetRoas":1.7,"testWindowDays":3,"minTestSpend":100,"hitRule":"both"}'),
  ('legacy_prefix_map', '{}');
