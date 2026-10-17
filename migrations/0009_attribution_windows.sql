-- Purchases and revenue per ad and day under two more Meta attribution settings, beside the
-- default (the ad set's own setting) already in purchases / revenue_cents. NULL = not synced or
-- not returned by Meta; never treated as zero. Incremental purchases are modelled and can be
-- fractional, so they're stored ×1000.
ALTER TABLE ad_daily ADD COLUMN purchases_7dc INTEGER;
ALTER TABLE ad_daily ADD COLUMN revenue_7dc_cents INTEGER;
ALTER TABLE ad_daily ADD COLUMN purchases_inc_milli INTEGER;
ALTER TABLE ad_daily ADD COLUMN revenue_inc_cents INTEGER;
