-- Winner calls: a concept that missed target, called a winner (or super winner) by the media
-- buyer for its spend and effect on the account. Never touched by syncs. evidence is the JSON
-- snapshot shown when the call was made (worker/calls.ts → CallEvidence).
CREATE TABLE concept_calls (
  concept_id TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('winner', 'super_winner')),
  reason     TEXT NOT NULL,
  evidence   TEXT NOT NULL,
  called_by  TEXT NOT NULL,
  called_at  TEXT NOT NULL
);
