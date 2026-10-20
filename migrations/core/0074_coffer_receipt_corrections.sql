-- Number reservations survive discarded and erased documents. Restored documents
-- carry their original numbers, so import never allocates replacement identities.
CREATE TABLE cf_receipt_counters(year INTEGER PRIMARY KEY, last_number INTEGER NOT NULL);
ALTER TABLE cf_acks ADD COLUMN receipt_year INTEGER;
ALTER TABLE cf_acks ADD COLUMN receipt_sequence INTEGER;
ALTER TABLE cf_acks ADD COLUMN void_reason TEXT;
ALTER TABLE cf_acks ADD COLUMN replaces_id TEXT;
CREATE UNIQUE INDEX cf_acks_receipt_number ON cf_acks(receipt_year,receipt_sequence);
ALTER TABLE cf_in_kind_acknowledgments ADD COLUMN receipt_year INTEGER;
ALTER TABLE cf_in_kind_acknowledgments ADD COLUMN receipt_sequence INTEGER;
ALTER TABLE cf_in_kind_acknowledgments ADD COLUMN void_reason TEXT;
ALTER TABLE cf_in_kind_acknowledgments ADD COLUMN replaces_id TEXT;
CREATE UNIQUE INDEX cf_in_kind_acknowledgments_receipt_number ON cf_in_kind_acknowledgments(receipt_year,receipt_sequence);
CREATE TABLE receipt_existing AS
 SELECT document_id,kind,year,ROW_NUMBER() OVER(PARTITION BY year ORDER BY issued_at,document_id) AS number FROM (
 SELECT a.id AS document_id,'cash' AS kind,CAST(substr(b.prepared_at,1,4) AS INTEGER) AS year,b.prepared_at AS issued_at FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id
 UNION ALL SELECT id,'property',CAST(substr(created_at,1,4) AS INTEGER),created_at FROM cf_in_kind_acknowledgments);
UPDATE cf_acks SET receipt_year=(SELECT year FROM receipt_existing WHERE document_id=cf_acks.id AND kind='cash'),receipt_sequence=(SELECT number FROM receipt_existing WHERE document_id=cf_acks.id AND kind='cash');
UPDATE cf_in_kind_acknowledgments SET receipt_year=(SELECT year FROM receipt_existing WHERE document_id=cf_in_kind_acknowledgments.id AND kind='property'),receipt_sequence=(SELECT number FROM receipt_existing WHERE document_id=cf_in_kind_acknowledgments.id AND kind='property');
INSERT INTO cf_receipt_counters SELECT year,MAX(number) FROM receipt_existing GROUP BY year;
DROP TABLE receipt_existing;
CREATE TRIGGER cf_acks_number AFTER INSERT ON cf_acks WHEN NEW.receipt_sequence IS NULL
BEGIN
 INSERT INTO cf_receipt_counters(year,last_number) VALUES(CAST(substr((SELECT prepared_at FROM cf_ack_batches WHERE id=NEW.batch_id),1,4) AS INTEGER),1) ON CONFLICT(year) DO UPDATE SET last_number=last_number+1;
 UPDATE cf_acks SET receipt_year=CAST(substr((SELECT prepared_at FROM cf_ack_batches WHERE id=NEW.batch_id),1,4) AS INTEGER),receipt_sequence=(SELECT last_number FROM cf_receipt_counters WHERE year=CAST(substr((SELECT prepared_at FROM cf_ack_batches WHERE id=NEW.batch_id),1,4) AS INTEGER)) WHERE id=NEW.id;
END;
CREATE TRIGGER cf_acks_number_immutable BEFORE UPDATE ON cf_acks
WHEN OLD.receipt_sequence IS NOT NULL AND (NEW.receipt_sequence IS NOT OLD.receipt_sequence OR NEW.receipt_year IS NOT OLD.receipt_year OR NEW.replaces_id IS NOT OLD.replaces_id)
BEGIN SELECT RAISE(ABORT,'COFFER_RECEIPT_IDENTITY'); END;
CREATE TRIGGER cf_in_kind_acknowledgments_number AFTER INSERT ON cf_in_kind_acknowledgments WHEN NEW.receipt_sequence IS NULL
BEGIN
 INSERT INTO cf_receipt_counters(year,last_number) VALUES(CAST(substr(NEW.created_at,1,4) AS INTEGER),1) ON CONFLICT(year) DO UPDATE SET last_number=last_number+1;
 UPDATE cf_in_kind_acknowledgments SET receipt_year=CAST(substr(NEW.created_at,1,4) AS INTEGER),receipt_sequence=(SELECT last_number FROM cf_receipt_counters WHERE year=CAST(substr(NEW.created_at,1,4) AS INTEGER)) WHERE id=NEW.id;
END;
CREATE TRIGGER cf_in_kind_acknowledgments_number_immutable BEFORE UPDATE ON cf_in_kind_acknowledgments
WHEN OLD.receipt_sequence IS NOT NULL AND (NEW.receipt_sequence IS NOT OLD.receipt_sequence OR NEW.receipt_year IS NOT OLD.receipt_year OR NEW.replaces_id IS NOT OLD.replaces_id)
BEGIN SELECT RAISE(ABORT,'COFFER_RECEIPT_IDENTITY'); END;
CREATE TRIGGER cf_receipt_void_refund AFTER INSERT ON cf_payment_entries WHEN NEW.contribution_cents<>0
BEGIN UPDATE cf_acks SET void_reason=COALESCE(void_reason,'Processor contribution changed') WHERE gift_id=NEW.gift_id
 OR EXISTS(SELECT 1 FROM json_each(statement_gifts) j WHERE json_extract(j.value,'$.id')=NEW.gift_id); END;
CREATE TRIGGER cf_receipt_void_reversal AFTER INSERT ON cf_gifts WHEN NEW.kind='reversal'
BEGIN UPDATE cf_acks SET void_reason=COALESCE(void_reason,'Gift reversed') WHERE gift_id=NEW.reverses
 OR EXISTS(SELECT 1 FROM json_each(statement_gifts) j WHERE json_extract(j.value,'$.id')=NEW.reverses); END;
CREATE TRIGGER cf_receipt_void_allocation AFTER INSERT ON cf_gift_allocations WHEN 1
BEGIN UPDATE cf_acks SET void_reason=COALESCE(void_reason,'Gift allocation changed') WHERE gift_id=NEW.gift_id
 OR EXISTS(SELECT 1 FROM json_each(statement_gifts) j WHERE json_extract(j.value,'$.id')=NEW.gift_id); END;
CREATE TRIGGER cf_receipt_void_reassignment AFTER UPDATE OF donor_id ON cf_gifts WHEN NEW.donor_id<>OLD.donor_id
BEGIN UPDATE cf_acks SET void_reason=COALESCE(void_reason,'Gift reassigned') WHERE gift_id=NEW.id
 OR EXISTS(SELECT 1 FROM json_each(statement_gifts) j WHERE json_extract(j.value,'$.id')=NEW.id); END;
CREATE TRIGGER cf_receipt_void_property AFTER UPDATE OF property_version,donor_id ON cf_in_kind_gifts
WHEN NEW.property_version<>OLD.property_version OR NEW.donor_id<>OLD.donor_id
BEGIN UPDATE cf_in_kind_acknowledgments SET void_reason=COALESCE(void_reason,'Property facts or donor changed') WHERE in_kind_id=NEW.id; END;
-- Existing issued copies also disclose stale financial or property facts.
UPDATE cf_acks SET void_reason='Gift contribution or ownership changed'
WHERE EXISTS(SELECT 1 FROM cf_gift_balances g WHERE g.id=cf_acks.gift_id AND statement_gifts IS NULL AND (g.net_cents<>cf_acks.amount_cents OR g.donor_id<>cf_acks.donor_id))
 OR EXISTS(SELECT 1 FROM json_each(statement_gifts) j JOIN cf_gift_balances g ON g.id=json_extract(j.value,'$.id') WHERE g.net_cents<>json_extract(j.value,'$.amount_cents'));
UPDATE cf_in_kind_acknowledgments SET void_reason='Property facts changed' WHERE property_version<>(SELECT property_version FROM cf_in_kind_gifts WHERE id=in_kind_id);
