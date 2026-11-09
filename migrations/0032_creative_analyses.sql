-- Gemini creative analysis (owner, Nov 9): one row per creative (asset), shared by its copies.
-- tags/readout are Gemini's JSON; manual holds hand edits, which always win and survive re-analysis.
CREATE TABLE creative_analyses (
  asset_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- analyzed | failed | no_media
  media TEXT,                    -- video | image
  model TEXT,
  tags TEXT,
  readout TEXT,
  manual TEXT,
  error TEXT,
  analyzed_at TEXT,
  requested_by TEXT
);
