-- Property and donor-stated internal values never enter cf_gifts or cash totals.
CREATE TABLE cf_in_kind_gifts (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 description TEXT NOT NULL,
 quantity TEXT NOT NULL,
 stated_value_cents INTEGER NOT NULL CHECK(stated_value_cents>=0),
 received_on TEXT NOT NULL,
 original_received_on TEXT NOT NULL,
 goods TEXT NOT NULL CHECK(goods IN ('unknown','none','provided','intangible religious benefits')),
 goods_description TEXT,
 goods_cents INTEGER NOT NULL DEFAULT 0 CHECK(goods_cents>=0),
 form_8283 TEXT NOT NULL DEFAULT 'unknown' CHECK(form_8283 IN ('unknown','section_b','not_section_b')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 property_version INTEGER NOT NULL DEFAULT 1 CHECK(property_version>0),
 disposed_on TEXT,
 disposal_method TEXT CHECK(disposal_method IN ('sold','exchanged','consumed','distributed','otherwise disposed')),
 disposal_exception TEXT CHECK(disposal_exception IN ('none','donor-certified-500','charitable-use')),
 disposal_evidence TEXT,
 became_aware_on TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX cf_in_kind_donor ON cf_in_kind_gifts(donor_id);
CREATE TABLE cf_in_kind_acknowledgments (
 id TEXT PRIMARY KEY,
 in_kind_id TEXT NOT NULL REFERENCES cf_in_kind_gifts(id) ON DELETE CASCADE,
 property_version INTEGER NOT NULL CHECK(property_version>0),
 acknowledged_on TEXT NOT NULL,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(in_kind_id,property_version)
);
CREATE INDEX cf_in_kind_ack_property ON cf_in_kind_acknowledgments(in_kind_id);

ALTER TABLE cf_in_kind_gifts ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE cf_in_kind_gifts ADD COLUMN fund TEXT NOT NULL DEFAULT 'Unrestricted';
CREATE TABLE cf_in_kind_revisions (
 id TEXT PRIMARY KEY,
 in_kind_id TEXT NOT NULL REFERENCES cf_in_kind_gifts(id),
 property_version INTEGER NOT NULL CHECK(property_version>1),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 UNIQUE(in_kind_id,property_version)
);
CREATE VIEW cf_in_kind_current AS SELECT g.id,g.donor_id,
 COALESCE(json_extract(r.snapshot,'$.description'),g.description) AS description,
 COALESCE(json_extract(r.snapshot,'$.quantity'),g.quantity) AS quantity,
 COALESCE(json_extract(r.snapshot,'$.stated_value_cents'),g.stated_value_cents) AS stated_value_cents,
 g.received_on,g.original_received_on,
 COALESCE(json_extract(r.snapshot,'$.goods'),g.goods) AS goods,
 CASE WHEN r.id IS NULL THEN g.goods_description ELSE json_extract(r.snapshot,'$.goods_description') END AS goods_description,
 COALESCE(json_extract(r.snapshot,'$.goods_cents'),g.goods_cents) AS goods_cents,
 COALESCE(json_extract(r.snapshot,'$.form_8283'),g.form_8283) AS form_8283,
 g.version,g.property_version,g.disposed_on,g.disposal_method,g.disposal_exception,g.disposal_evidence,g.became_aware_on,g.created_at,g.updated_at,g.fund
 FROM cf_in_kind_gifts g LEFT JOIN cf_in_kind_revisions r ON r.in_kind_id=g.id AND r.property_version=g.property_version;

-- Property uses the same contribution ledger, with explicit zero monetary cents.
-- Its internal stated value is a separate field; corrections append new lines.
DROP VIEW cf_contribution_ledger;
CREATE VIEW cf_contribution_ledger AS
 SELECT id,version,donor_id,kind,reverses,received_on,amount_cents,method,reference,fund,pledge_id,goods,goods_cents,goods_description,note,source,created_at,created_by,
 NULL AS property_id,NULL AS property_description,NULL AS quantity,NULL AS stated_value_cents FROM cf_gifts
 UNION ALL
 SELECT p.id,1,g.donor_id,CASE WHEN p.contribution_cents<0 THEN 'reversal' ELSE 'gift' END,
 CASE WHEN p.contribution_cents<0 THEN g.id ELSE NULL END,p.received_on,p.contribution_cents,
 g.method,p.source_id,p.fund,g.pledge_id,'none',0,NULL,p.kind,'stripe-adjustment',p.created_at,'Stripe',NULL,NULL,NULL,NULL
 FROM cf_payment_entries p JOIN cf_gifts g ON g.id=p.gift_id WHERE p.contribution_cents<>0
 UNION ALL
 SELECT g.id,1,g.donor_id,'in_kind',NULL,g.received_on,0,'in_kind',g.id,g.fund,NULL,g.goods,g.goods_cents,g.goods_description,NULL,'in_kind',g.created_at,g.created_by,
 g.id,g.description,g.quantity,g.stated_value_cents FROM cf_in_kind_gifts g
 UNION ALL
 SELECT r.id,r.property_version,g.donor_id,'in_kind_correction',g.id,g.received_on,0,'in_kind',r.id,g.fund,NULL,
 json_extract(r.snapshot,'$.goods'),json_extract(r.snapshot,'$.goods_cents'),json_extract(r.snapshot,'$.goods_description'),NULL,'in_kind',r.created_at,r.created_by,
 g.id,json_extract(r.snapshot,'$.description'),json_extract(r.snapshot,'$.quantity'),json_extract(r.snapshot,'$.stated_value_cents')
 FROM cf_in_kind_revisions r JOIN cf_in_kind_gifts g ON g.id=r.in_kind_id;

CREATE TRIGGER cf_in_kind_facts_immutable BEFORE UPDATE ON cf_in_kind_gifts
WHEN NEW.id IS NOT OLD.id OR NEW.received_on IS NOT OLD.received_on OR NEW.original_received_on IS NOT OLD.original_received_on
 OR NEW.fund IS NOT OLD.fund OR NEW.quantity IS NOT OLD.quantity OR NEW.stated_value_cents IS NOT OLD.stated_value_cents
 OR NEW.goods IS NOT OLD.goods OR NEW.goods_cents IS NOT OLD.goods_cents OR NEW.form_8283 IS NOT OLD.form_8283
 OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
 OR ((NEW.description IS NOT OLD.description OR NEW.goods_description IS NOT OLD.goods_description)
  AND NOT EXISTS(SELECT 1 FROM cf_donors WHERE id=OLD.donor_id AND erased_at IS NOT NULL))
 OR (NEW.donor_id IS NOT OLD.donor_id
  AND NOT EXISTS(SELECT 1 FROM cf_donors WHERE id=OLD.donor_id AND erased_at IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=OLD.donor_id AND into_id=NEW.donor_id)
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merge_journal WHERE status='undoing' AND source_id=NEW.donor_id AND target_id=OLD.donor_id))
BEGIN SELECT RAISE(ABORT,'COFFER_IN_KIND_IMMUTABLE'); END;
CREATE TRIGGER cf_in_kind_no_delete BEFORE DELETE ON cf_in_kind_gifts
BEGIN SELECT RAISE(ABORT,'COFFER_IN_KIND_IMMUTABLE'); END;
CREATE TRIGGER cf_in_kind_revision_immutable BEFORE UPDATE ON cf_in_kind_revisions
WHEN NEW.id IS NOT OLD.id OR NEW.in_kind_id IS NOT OLD.in_kind_id OR NEW.property_version IS NOT OLD.property_version
 OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
 OR NOT EXISTS(SELECT 1 FROM cf_in_kind_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=OLD.in_kind_id AND d.erased_at IS NOT NULL)
 OR json_remove(NEW.snapshot,'$.description','$.goods_description') IS NOT json_remove(OLD.snapshot,'$.description','$.goods_description')
 OR NEW.reason<>'[erased]'
BEGIN SELECT RAISE(ABORT,'COFFER_IN_KIND_IMMUTABLE'); END;
CREATE TRIGGER cf_in_kind_revision_no_delete BEFORE DELETE ON cf_in_kind_revisions
BEGIN SELECT RAISE(ABORT,'COFFER_IN_KIND_IMMUTABLE'); END;
CREATE TRIGGER cf_in_kind_id_unique BEFORE INSERT ON cf_in_kind_gifts
WHEN EXISTS(SELECT 1 FROM cf_contribution_ledger WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'COFFER_LEDGER_ID_EXISTS'); END;
CREATE TRIGGER cf_in_kind_revision_id_unique BEFORE INSERT ON cf_in_kind_revisions
WHEN EXISTS(SELECT 1 FROM cf_contribution_ledger WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'COFFER_LEDGER_ID_EXISTS'); END;
CREATE TRIGGER cf_gift_property_id_unique BEFORE INSERT ON cf_gifts
WHEN EXISTS(SELECT 1 FROM cf_in_kind_gifts WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cf_in_kind_revisions WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'COFFER_LEDGER_ID_EXISTS'); END;
CREATE TRIGGER cf_payment_property_id_unique BEFORE INSERT ON cf_payment_entries
WHEN EXISTS(SELECT 1 FROM cf_in_kind_gifts WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cf_in_kind_revisions WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'COFFER_LEDGER_ID_EXISTS'); END;

CREATE VIEW cf_monetary_contributions AS SELECT * FROM cf_contribution_ledger WHERE kind IN ('gift','reversal');
