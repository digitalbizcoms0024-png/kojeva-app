-- Active and former pods, and POD 0 split by person (owner, Nov 11 2026).
-- A former pod keeps all its data; it leaves the pod leaderboard for ranges ending on or after
-- left_on, and new ads can't be tagged to it.
ALTER TABLE pods ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pods ADD COLUMN left_on TEXT;

-- Harris and Dhia left Kojeva.
UPDATE pods SET active = 0, left_on = '2026-11-10' WHERE id IN ('harris', 'dhia');

-- POD 0 is Andrei's alone; Reika and Adrian get their own pods. Ad sets naming a member are that
-- member's pod, old "Pod 0 | Reika | …" ones included (shared/attribution.ts). Colour slots 3 and 4
-- are new in POD_SLOTS. Only where POD 0 exists (not on a fresh or sample database).
UPDATE pods SET members = '["Andrei"]' WHERE id = 'pod-0';
INSERT OR IGNORE INTO pods (id, code, name, color, kind, prefix, slot, inhouse, members)
  SELECT 'pod-1', 'PD1', 'POD 1', '#0f5c8c', 'pod', 'POD1', 3, 1, '["Reika"]' WHERE EXISTS (SELECT 1 FROM pods WHERE id = 'pod-0');
INSERT OR IGNORE INTO pods (id, code, name, color, kind, prefix, slot, inhouse, members)
  SELECT 'pod-2', 'PD2', 'POD 2', '#7d6a00', 'pod', 'POD2', 4, 1, '["Adrian"]' WHERE EXISTS (SELECT 1 FROM pods WHERE id = 'pod-0');
