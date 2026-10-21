import { sql, today, type Context, type Row } from './db'
import { settings } from './settings'

/** Persist sender acceptance and the linked thank-you fact in one transaction. */
export async function receiptAcceptance(c: Context, letter: Row, messageId: string) {
 const day=today((await settings(c)).timezone,new Date(c.now))
 return [sql("UPDATE cf_acks SET message_id=?,submitted_at=?,delivery_status=CASE WHEN delivery_status='sending' THEN 'submitted' ELSE delivery_status END WHERE id=? AND attempt_id=?",messageId,c.now,letter.id,letter.attempt_id),
 sql(`INSERT INTO cf_gift_acknowledgments(gift_id,status,acknowledged_on,method,batch_id,letter_id,source,updated_at,updated_by,updated_by_id,updated_by_role)
 SELECT gift_id,CASE WHEN delivery_status IN ('bounced','complained') THEN 'not acknowledged' ELSE 'acknowledged' END,?,'email',batch_id,id,'Coffer email receipt',?,?,?,? FROM cf_acks WHERE id=? AND gift_id IS NOT NULL AND attempt_id=?
 ON CONFLICT(gift_id) DO UPDATE SET version=version+1,status=excluded.status,acknowledged_on=excluded.acknowledged_on,method='email',batch_id=excluded.batch_id,letter_id=excluded.letter_id,communication_id=NULL,interaction_id=NULL,note_id=NULL,reason=NULL,source=excluded.source,source_reference=NULL,outcome_unknown=0,updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_id=excluded.updated_by_id,updated_by_role=excluded.updated_by_role,change_source='automatic'`,day,c.now,c.actor.name,c.actor.id,c.actor.role,letter.id,letter.attempt_id)]
}
