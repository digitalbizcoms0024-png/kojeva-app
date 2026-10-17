-- Personas for the coverage map (persona × awareness). Claude drafts the list once from Atria's
-- tags, people edit and confirm it in Settings, then Claude assigns each creative to one persona
-- nightly. Status: draft (Claude's first list, not confirmed) | active | suggested (Claude
-- proposes a new one for an ad nobody fits) | dismissed (kept so it isn't suggested again).
CREATE TABLE personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- Claude's persona for a creative (NULL with persona_at set = fits none of the list) and whether
-- the ad carries a discount or offer (1/0, NULL = not labelled yet).
ALTER TABLE atria_assets ADD COLUMN persona_id TEXT;
ALTER TABLE atria_assets ADD COLUMN persona_at TEXT;
ALTER TABLE atria_assets ADD COLUMN offer INTEGER;

-- Hand-set values; NULL = use Claude's.
ALTER TABLE assignments ADD COLUMN persona_id TEXT;
ALTER TABLE assignments ADD COLUMN offer INTEGER;
