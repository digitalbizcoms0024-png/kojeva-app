-- Daily reach per ad, for frequency (impressions ÷ reach) in fatigue signals.
-- NULL until a sync covers that day; never treated as zero.
ALTER TABLE ad_daily ADD COLUMN reach INTEGER;
