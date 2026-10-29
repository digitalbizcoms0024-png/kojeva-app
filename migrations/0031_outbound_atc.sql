-- Ad Swipe (owner, Oct 29): outbound clicks (Meta's outbound_clicks) and adds to cart (the actions'
-- add-to-cart type) per ad per day. NULL on days synced before this column existed: missing, not zero.
ALTER TABLE ad_daily ADD COLUMN outbound_clicks INTEGER;
ALTER TABLE ad_daily ADD COLUMN add_to_cart INTEGER;
