-- A gift must belong to its actual monthly plan, not just its campaign.
CREATE TABLE cf_subscription_gifts (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES cf_subscriptions(id) ON DELETE CASCADE
);
CREATE INDEX cf_subscription_gift_plan ON cf_subscription_gifts(subscription_id);
