-- Classification augments existing ledger lines; no second contribution is made.
CREATE TABLE cf_contribution_types (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id),
 kind TEXT NOT NULL CHECK(kind IN ('daf','qcd')),
 custodian TEXT,
 soft_credit_id TEXT REFERENCES cf_soft_credits(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL
);
CREATE TABLE cf_stock_contributions (
 in_kind_id TEXT PRIMARY KEY REFERENCES cf_in_kind_gifts(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 symbol TEXT NOT NULL, shares TEXT NOT NULL,
 transfer_on TEXT NOT NULL,
 high_price_micros INTEGER NOT NULL CHECK(high_price_micros>0),
 low_price_micros INTEGER NOT NULL CHECK(low_price_micros>0 AND low_price_micros<=high_price_micros),
 recorded_value_cents INTEGER NOT NULL CHECK(recorded_value_cents>=0),
 sold_on TEXT, sale_proceeds_cents INTEGER CHECK(sale_proceeds_cents>=0),
 created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 CHECK((sold_on IS NULL AND sale_proceeds_cents IS NULL) OR (sold_on IS NOT NULL AND sale_proceeds_cents IS NOT NULL))
);
CREATE TRIGGER cf_typed_contribution_immutable BEFORE UPDATE ON cf_contribution_types
WHEN NEW.gift_id IS NOT OLD.gift_id OR NEW.kind IS NOT OLD.kind OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
 OR (NEW.custodian IS NOT OLD.custodian AND NOT (NEW.custodian IS NULL AND EXISTS(SELECT 1 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=OLD.gift_id AND d.erased_at IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'COFFER_CONTRIBUTION_TYPE_IMMUTABLE'); END;
CREATE TRIGGER cf_typed_contribution_no_delete BEFORE DELETE ON cf_contribution_types
BEGIN SELECT RAISE(ABORT,'COFFER_CONTRIBUTION_TYPE_IMMUTABLE'); END;
CREATE TRIGGER cf_stock_original_immutable BEFORE UPDATE ON cf_stock_contributions
WHEN NEW.in_kind_id IS NOT OLD.in_kind_id OR NEW.symbol IS NOT OLD.symbol OR NEW.shares IS NOT OLD.shares OR NEW.transfer_on IS NOT OLD.transfer_on
 OR NEW.high_price_micros IS NOT OLD.high_price_micros OR NEW.low_price_micros IS NOT OLD.low_price_micros OR NEW.recorded_value_cents IS NOT OLD.recorded_value_cents
 OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
 OR OLD.sold_on IS NOT NULL OR NEW.version<>OLD.version+1 OR NEW.sold_on IS NULL OR NEW.sale_proceeds_cents IS NULL
BEGIN SELECT RAISE(ABORT,'COFFER_STOCK_ORIGINAL_IMMUTABLE'); END;
CREATE TRIGGER cf_stock_no_delete BEFORE DELETE ON cf_stock_contributions
BEGIN SELECT RAISE(ABORT,'COFFER_STOCK_ORIGINAL_IMMUTABLE'); END;
-- A generic property edit cannot silently diverge from its security valuation.
CREATE TRIGGER cf_stock_property_correction BEFORE INSERT ON cf_in_kind_revisions
WHEN EXISTS(SELECT 1 FROM cf_stock_contributions s JOIN cf_in_kind_gifts g ON g.id=s.in_kind_id WHERE s.in_kind_id=NEW.in_kind_id
 AND (json_extract(NEW.snapshot,'$.quantity') IS NOT g.quantity OR json_extract(NEW.snapshot,'$.stated_value_cents') IS NOT s.recorded_value_cents OR json_extract(NEW.snapshot,'$.description') IS NOT g.description))
BEGIN SELECT RAISE(ABORT,'COFFER_STOCK_ORIGINAL_IMMUTABLE'); END;
CREATE TRIGGER cf_stock_property_sale BEFORE UPDATE OF disposed_on ON cf_in_kind_gifts
WHEN NEW.disposed_on IS NOT OLD.disposed_on AND EXISTS(SELECT 1 FROM cf_stock_contributions WHERE in_kind_id=NEW.id AND (sold_on IS NULL OR sold_on IS NOT NEW.disposed_on))
BEGIN SELECT RAISE(ABORT,'COFFER_STOCK_SALE_REQUIRED'); END;
CREATE TRIGGER cf_contribution_type_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 UPDATE cf_contribution_types SET custodian=NULL WHERE gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
END;
-- Import undo may delete an unused constituent, but an advisor who has since
-- received recognition for a new typed gift is no longer unused. Owner erasure
-- clears its soft credits first and remains supported.
CREATE TRIGGER cf_typed_advisor_delete BEFORE DELETE ON cf_donors
WHEN OLD.erased_at IS NULL AND EXISTS(SELECT 1 FROM cf_contribution_types t JOIN cf_soft_credits s ON s.id=t.soft_credit_id WHERE s.donor_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'COFFER_TYPED_CONTRIBUTION_IN_USE'); END;
