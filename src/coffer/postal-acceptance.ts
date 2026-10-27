import { sql, type Row, type Stmt } from './db'

/** A provider acceptance links the same receipt, independently of USPS delivery. */
export function postalAcknowledgments(deliveryId: string, now: string, day: string, actor: { id: string; name: string; role: string }): Stmt {
 return sql(`INSERT INTO cf_gift_acknowledgments(gift_id,status,acknowledged_on,method,batch_id,letter_id,source,updated_at,updated_by,updated_by_id,updated_by_role,outcome_unknown)
  SELECT a.gift_id,CASE WHEN a.delivery_status IN ('bounced','complained','rejected') THEN 'not acknowledged' ELSE 'acknowledged' END,
  CASE WHEN a.delivery_status IN ('bounced','complained','rejected') THEN NULL ELSE ? END,'letter',a.batch_id,a.id,'Coffer postal receipt',?,?,?,?,0
  FROM cf_postal_documents p JOIN cf_acks a ON a.id=p.letter_id AND a.attempt_id=p.attempt_id JOIN cf_donors d ON d.id=a.donor_id AND d.erased_at IS NULL
  WHERE p.delivery_id=? AND a.gift_id IS NOT NULL AND a.void_reason IS NULL
  ON CONFLICT(gift_id) DO UPDATE SET version=version+1,status=excluded.status,acknowledged_on=excluded.acknowledged_on,method='letter',batch_id=excluded.batch_id,letter_id=excluded.letter_id,
  communication_id=NULL,interaction_id=NULL,note_id=NULL,reason=NULL,source=excluded.source,source_reference=NULL,outcome_unknown=0,updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_id=excluded.updated_by_id,updated_by_role=excluded.updated_by_role,change_source='automatic'
  WHERE cf_gift_acknowledgments.letter_id IS NULL OR cf_gift_acknowledgments.letter_id=excluded.letter_id`, day, now, actor.name, actor.id, actor.role, deliveryId)
}

/** Network evidence persists even if the authorizing session expires in flight. */
export function postalOutcome(deliveryId: string, result: Row, now: string): Stmt[] {
 const note = result.state === 'submitted' ? 'Lob accepted this postal piece. USPS delivery is not yet confirmed.' : result.state === 'rejected' ? 'Lob rejected this postal submission. This document remains printable; review the provider before any new mailing.' : 'Postal submission could not be confirmed. Check Lob before printing or sending another copy. Coffer will not retry it.'
 return [sql(`UPDATE cf_postal_deliveries SET state=CASE WHEN provider_message_id IS NOT NULL AND ?='uncertain' THEN state ELSE ? END,
  provider_message_id=COALESCE(provider_message_id,?),submitted_at=COALESCE(submitted_at,?) WHERE id=?`, result.state, result.state, result.messageId ?? null, result.state === 'submitted' ? now : null, deliveryId),
  sql(`UPDATE cf_acks SET delivery_status=CASE WHEN delivery_status='sending' THEN ? ELSE delivery_status END,
   route=CASE WHEN ?='rejected' AND delivery_status='sending' THEN 'print' ELSE route END,message_id=COALESCE(message_id,?),submitted_at=COALESCE(submitted_at,?),
   delivery_note=CASE WHEN delivery_status='sending' THEN ? ELSE delivery_note END
   WHERE id IN (SELECT letter_id FROM cf_postal_documents WHERE delivery_id=?) AND attempt_id IN (SELECT attempt_id FROM cf_postal_documents WHERE delivery_id=?)`, result.state, result.state, result.messageId ?? null, result.state === 'submitted' ? now : null, note, deliveryId, deliveryId)]
}
