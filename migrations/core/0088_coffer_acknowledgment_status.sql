-- A gift's thank-you record is independent of receipt workflow and delivery.
ALTER TABLE cf_gift_acknowledgments ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cf_gift_acknowledgments ADD COLUMN interaction_id TEXT REFERENCES cf_interactions(id) ON DELETE SET NULL;
ALTER TABLE cf_gift_acknowledgments ADD COLUMN note_id TEXT REFERENCES cf_donor_notes(id) ON DELETE SET NULL;
ALTER TABLE cf_gift_acknowledgments ADD COLUMN communication_id TEXT REFERENCES cf_communications(id) ON DELETE SET NULL;
ALTER TABLE cf_gift_acknowledgments ADD COLUMN outcome_unknown INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cf_gift_acknowledgments ADD COLUMN updated_by_id TEXT NOT NULL DEFAULT 'coffer-import';
ALTER TABLE cf_gift_acknowledgments ADD COLUMN updated_by_role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE cf_gift_acknowledgments ADD COLUMN change_source TEXT NOT NULL DEFAULT 'automatic';
ALTER TABLE cf_settings ADD COLUMN thank_soft_credits INTEGER NOT NULL DEFAULT 0 CHECK(thank_soft_credits IN (0,1));
CREATE TRIGGER cf_gift_ack_audit_insert AFTER INSERT ON cf_gift_acknowledgments
BEGIN
 INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
 SELECT NEW.updated_at,NEW.updated_by_id,NEW.updated_by,NEW.updated_by_role,'gift.acknowledgment','gift',NEW.gift_id,g.donor_id,
 json_object('oldStatus','not acknowledged','status',NEW.status,'method',NEW.method,'acknowledgedOn',NEW.acknowledged_on,'letterId',NEW.letter_id,'batchId',NEW.batch_id,'interactionId',NEW.interaction_id,'noteId',NEW.note_id,'communicationId',NEW.communication_id,'source',NEW.change_source,'version',NEW.version)
 FROM cf_gifts g WHERE g.id=NEW.gift_id;
END;
CREATE TRIGGER cf_gift_ack_audit_update AFTER UPDATE ON cf_gift_acknowledgments
BEGIN
 INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
 SELECT NEW.updated_at,NEW.updated_by_id,NEW.updated_by,NEW.updated_by_role,'gift.acknowledgment','gift',NEW.gift_id,g.donor_id,
 json_object('oldStatus',OLD.status,'status',NEW.status,'method',NEW.method,'acknowledgedOn',NEW.acknowledged_on,'letterId',NEW.letter_id,'batchId',NEW.batch_id,'interactionId',NEW.interaction_id,'noteId',NEW.note_id,'communicationId',NEW.communication_id,'source',NEW.change_source,'version',NEW.version)
 FROM cf_gifts g WHERE g.id=NEW.gift_id;
END;
CREATE TRIGGER cf_ack_email_failed AFTER UPDATE OF delivery_status ON cf_acks
WHEN NEW.delivery_status IN ('bounced','complained','rejected') AND OLD.delivery_status<>NEW.delivery_status
BEGIN
 UPDATE cf_gift_acknowledgments SET version=version+1,status='not acknowledged',acknowledged_on=NULL,method=NULL,reason=NULL,outcome_unknown=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_by='Receipt provider',updated_by_id='coffer-mail',updated_by_role='owner',change_source='automatic'
 WHERE gift_id=NEW.gift_id AND letter_id=NEW.id AND change_source='automatic';
END;
CREATE TRIGGER cf_ack_email_uncertain AFTER UPDATE OF delivery_status ON cf_acks
WHEN NEW.delivery_status IN ('sending','uncertain') AND NEW.gift_id IS NOT NULL
BEGIN
 INSERT INTO cf_gift_acknowledgments(gift_id,status,batch_id,letter_id,source,outcome_unknown,updated_at,updated_by,updated_by_id)
 VALUES(NEW.gift_id,'not acknowledged',NEW.batch_id,NEW.id,'Coffer email receipt',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'Receipt sender','coffer-mail')
 ON CONFLICT(gift_id) DO UPDATE SET version=version+1,batch_id=excluded.batch_id,letter_id=excluded.letter_id,outcome_unknown=1,updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_id=excluded.updated_by_id,change_source='automatic' WHERE status='not acknowledged';
END;
DROP TRIGGER cf_gift_ack_erasure;
CREATE TRIGGER cf_gift_ack_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 UPDATE cf_gift_acknowledgments SET reason=NULL,interaction_id=NULL,note_id=NULL,communication_id=NULL,letter_id=NULL,batch_id=NULL,source_reference=NULL,source='Coffer',updated_by='Coffer',updated_by_id='coffer-erasure' WHERE gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
END;

ALTER TABLE cf_letter_events ADD COLUMN signature_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cf_communications ADD COLUMN thank_recorded_at TEXT;
