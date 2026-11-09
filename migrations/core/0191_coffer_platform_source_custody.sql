CREATE TABLE cf_platform_erased_donors (identity_hash TEXT PRIMARY KEY);
ALTER TABLE cf_platform_sources ADD COLUMN identity_hash TEXT;
CREATE TRIGGER cf_platform_source_identity BEFORE UPDATE ON cf_platform_sources
WHEN NEW.source_id<>OLD.source_id OR NEW.batch_id<>OLD.batch_id OR NEW.facts_hash<>OLD.facts_hash
 OR NEW.identity_hash IS NOT OLD.identity_hash OR NEW.row_number<>OLD.row_number
 OR (OLD.gift_id IS NOT NULL AND NEW.gift_id IS NOT OLD.gift_id)
BEGIN SELECT RAISE(ABORT,'COFFER_PLATFORM_SOURCE_IMMUTABLE'); END;
