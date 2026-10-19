-- The gift's thank-you facts survive independently of its batch workflow.
-- Imported sources may omit a historical date or method; never invent them.
CREATE TABLE cf_gift_acknowledgments (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('acknowledged','not acknowledged','do not acknowledge')),
 acknowledged_on TEXT,
 method TEXT,
 batch_id TEXT REFERENCES cf_ack_batches(id),
 letter_id TEXT REFERENCES cf_acks(id),
 reason TEXT,
 source TEXT NOT NULL,
 source_reference TEXT,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL
);
INSERT INTO cf_gift_acknowledgments(gift_id,status,acknowledged_on,method,batch_id,letter_id,source,updated_at,updated_by)
 SELECT a.gift_id,'acknowledged',b.sent_on,'letter',b.id,a.id,'Coffer letter batch',b.exported_at,b.sent_recorded_by
 FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id
 WHERE a.gift_id IS NOT NULL AND a.live=1 AND b.status='sent';
-- Free source reasons can contain personal details. Erasure removes the entire
-- acknowledgment, as it already removes letter text and interactions.
CREATE TRIGGER cf_gift_ack_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_gift_acknowledgments WHERE gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
END;
