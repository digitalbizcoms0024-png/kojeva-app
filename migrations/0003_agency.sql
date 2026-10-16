-- The agency that produced ads before the in-house (IH) pods, ranked beside them.
ALTER TABLE pods ADD COLUMN kind TEXT NOT NULL DEFAULT 'pod';   -- pod | agency
INSERT INTO pods (id, code, name, color, kind) VALUES ('agency', 'AGY', 'Agency', '#8a847c', 'agency');

-- Agency ad sets start with these codes ("ME | R2-S12 | Statics"). podsStartDate null = detect
-- from the first "IH | <strategist>" ad set.
INSERT INTO settings (key, value) VALUES
  ('attribution', '{"agencyPrefixes":["ME","QW","TV","YD"],"podsStartDate":null}');
