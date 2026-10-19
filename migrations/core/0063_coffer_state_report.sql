-- REPORT-008: each earlier address of a donor, kept with the day it stopped
-- applying (exclusive) and the source of the change. A gift counts under the
-- address in effect on its received date.
CREATE TABLE cf_donor_address_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 donor_id TEXT NOT NULL,
 address_line1 TEXT, address_line2 TEXT, city TEXT, region TEXT, postal_code TEXT, country TEXT,
 until_on TEXT NOT NULL CHECK (until_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 source TEXT NOT NULL,
 recorded_at TEXT NOT NULL
);
CREATE INDEX cf_donor_address_history_donor ON cf_donor_address_history(donor_id, until_on);

-- A writer stages the move date and source for its own batch, then clears it.
CREATE TABLE cf_address_moves (donor_id TEXT PRIMARY KEY, effective_on TEXT NOT NULL, source TEXT NOT NULL);

CREATE TRIGGER cf_donor_address_change AFTER UPDATE OF address_line1,address_line2,city,region,postal_code,country ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NULL AND (OLD.address_line1 IS NOT NEW.address_line1 OR OLD.address_line2 IS NOT NEW.address_line2
 OR OLD.city IS NOT NEW.city OR OLD.region IS NOT NEW.region OR OLD.postal_code IS NOT NEW.postal_code OR OLD.country IS NOT NEW.country)
BEGIN
 INSERT INTO cf_donor_address_history(donor_id,address_line1,address_line2,city,region,postal_code,country,until_on,source,recorded_at)
 VALUES(OLD.id,OLD.address_line1,OLD.address_line2,OLD.city,OLD.region,OLD.postal_code,OLD.country,
  COALESCE((SELECT effective_on FROM cf_address_moves WHERE donor_id=OLD.id),strftime('%Y-%m-%d','now')),
  COALESCE((SELECT source FROM cf_address_moves WHERE donor_id=OLD.id),'system'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER cf_donor_address_erasure AFTER UPDATE OF erased_at ON cf_donors WHEN NEW.erased_at IS NOT NULL
BEGIN DELETE FROM cf_donor_address_history WHERE donor_id=OLD.id; END;
CREATE TRIGGER cf_donor_address_removed AFTER DELETE ON cf_donors
BEGIN DELETE FROM cf_donor_address_history WHERE donor_id=OLD.id; END;
