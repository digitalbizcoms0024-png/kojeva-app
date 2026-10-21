-- Awareness level and the belief a creative shifts, labelled nightly by the Atria Claude task from
-- Atria's tags (see docs/ATRIA.md). belief is Claude's wording; belief_group is the shared label
-- Insights groups by. Hand-set values live on assignments and always win.
ALTER TABLE atria_assets ADD COLUMN awareness TEXT;      -- unaware | problem | solution | product | most
ALTER TABLE atria_assets ADD COLUMN belief TEXT;
ALTER TABLE atria_assets ADD COLUMN belief_group TEXT;
ALTER TABLE atria_assets ADD COLUMN labeled_at TEXT;
ALTER TABLE assignments ADD COLUMN awareness TEXT;
ALTER TABLE assignments ADD COLUMN belief_group TEXT;
