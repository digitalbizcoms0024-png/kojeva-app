-- Hit rate is measured per concept: a testing ad set, or one part of an ad set that
-- combined several ("Batch 3 & 5"). Rebuilt on every sync by shared/concepts.ts.
CREATE TABLE concepts (
  id         TEXT PRIMARY KEY,   -- ad set id, or "<adset id>#<part>"
  adset_id   TEXT NOT NULL,
  adset_name TEXT NOT NULL,
  label      TEXT NOT NULL,      -- "KOJEVA 3 | STATIC | Scarcity", "STATIC | Batch 5"
  pod_id     TEXT NOT NULL REFERENCES pods(id)
);
ALTER TABLE ads ADD COLUMN concept_id TEXT;
CREATE INDEX ads_concept ON ads(concept_id);
