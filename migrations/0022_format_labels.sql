-- Claude's format suggestion per creative (nightly Atria task, from its frames and Atria's tags).
-- format_label is a FORMATS key, or NULL when none fits; format_at is when it was decided (NULL =
-- not looked at yet). A suggestion only: hand-set formats and names win, and nothing applies it
-- without someone accepting it in Needs Tagging.
ALTER TABLE atria_assets ADD COLUMN format_label TEXT;
ALTER TABLE atria_assets ADD COLUMN format_at TEXT;
