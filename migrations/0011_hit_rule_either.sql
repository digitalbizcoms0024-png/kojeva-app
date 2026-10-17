-- Kojeva's hit rule is CPA ≤ target OR ROAS ≥ target (confirmed Oct 2026). The default used to be
-- "both"; set it on a saved targets row too. One row; later changes in Settings still win.
UPDATE settings SET value = json_set(value, '$.hitRule', 'either') WHERE key = 'targets';
