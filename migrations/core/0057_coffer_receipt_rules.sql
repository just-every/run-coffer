ALTER TABLE cf_settings ADD COLUMN religious_organization INTEGER NOT NULL DEFAULT 0 CHECK(religious_organization IN (0,1));
ALTER TABLE cf_settings ADD COLUMN token_year INTEGER;
ALTER TABLE cf_settings ADD COLUMN token_max_value_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cf_settings ADD COLUMN token_min_gift_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cf_settings ADD COLUMN token_max_cost_cents INTEGER NOT NULL DEFAULT 0;
CREATE TABLE cf_receipt_benefits (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('token','religious')),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 statement TEXT NOT NULL
);
CREATE TRIGGER cf_receipt_benefits_immutable BEFORE UPDATE ON cf_receipt_benefits
BEGIN SELECT RAISE(ABORT,'COFFER_RECEIPT_BENEFIT_IMMUTABLE'); END;
CREATE TRIGGER cf_receipt_benefits_erasure BEFORE UPDATE OF donor_id ON cf_gifts
WHEN EXISTS(SELECT 1 FROM cf_donors WHERE id=NEW.donor_id AND erased_at IS NOT NULL)
BEGIN DELETE FROM cf_receipt_benefits WHERE gift_id=NEW.id; END;
