-- Conflicting signed source facts cannot be cleared by an ordinary refresh.
ALTER TABLE cf_shop_orders ADD COLUMN conflicted INTEGER NOT NULL DEFAULT 0 CHECK(conflicted IN (0,1));
