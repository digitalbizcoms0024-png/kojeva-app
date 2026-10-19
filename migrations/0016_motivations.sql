-- Motivation tags (MOTIVATIONS in shared/taxonomy.ts): why someone buys or what they need to see,
-- several per creative. Claude labels them nightly from Atria's tags (atria_assets); a hand-set
-- list in assignments wins. JSON arrays of keys; NULL = not labelled / not set by hand.
ALTER TABLE atria_assets ADD COLUMN motivations TEXT;
ALTER TABLE atria_assets ADD COLUMN motivations_at TEXT;
ALTER TABLE assignments ADD COLUMN motivations TEXT;
