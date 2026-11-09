-- Private signed observations and exact reviewed money decisions. No credentials.
CREATE TABLE cf_shop_orders (
 id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, shop_id TEXT NOT NULL, shop_domain TEXT NOT NULL,
 order_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'held',
 identity_hash TEXT, source_hash TEXT, source TEXT, facts TEXT NOT NULL DEFAULT '{}', issues TEXT NOT NULL DEFAULT '[]',
 review TEXT, fingerprint TEXT, evidence TEXT, gift_id TEXT REFERENCES cf_gifts(id),
 approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL,
 UNIQUE(installation_id,shop_id,order_id)
);
CREATE TABLE cf_shop_events (
 id TEXT PRIMARY KEY, order_key TEXT NOT NULL REFERENCES cf_shop_orders(id), topic TEXT NOT NULL,
 payload_hash TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
);
CREATE TABLE cf_shop_processor_bindings (
 charge_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, order_key TEXT NOT NULL REFERENCES cf_shop_orders(id)
);
CREATE TABLE cf_shop_erased_identities (hash TEXT PRIMARY KEY);
CREATE TRIGGER cf_shop_source_identity BEFORE UPDATE ON cf_shop_orders
WHEN NEW.id<>OLD.id OR NEW.installation_id<>OLD.installation_id OR NEW.shop_id<>OLD.shop_id
 OR NEW.shop_domain<>OLD.shop_domain OR NEW.order_id<>OLD.order_id
 OR (OLD.gift_id IS NOT NULL AND NEW.gift_id IS NOT OLD.gift_id)
BEGIN SELECT RAISE(ABORT,'COFFER_SHOP_IDENTITY'); END;
