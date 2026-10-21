-- Pods added in Settings. They're matched by an ad set name part (prefix) instead of a strategist
-- name, and take a color slot from shared/taxonomy.ts → POD_SLOTS. Built-in pods leave both NULL.
ALTER TABLE pods ADD COLUMN prefix TEXT;
ALTER TABLE pods ADD COLUMN slot INTEGER;

-- Trybe (creator partner), confirmed by the owner Oct 2026: "TRYBE | Larissa V | Jawline Angle".
INSERT OR IGNORE INTO pods (id, code, name, color, kind, prefix, slot) VALUES ('trybe', 'TRY', 'Trybe', '#6250d6', 'pod', 'TRYBE', 0);
