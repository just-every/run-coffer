import { all, commit, one, sql, today, type Context, type Row } from './db'
import { settings } from './settings'

/** Interrupted submission claims and Mango handoffs are held until a person
 * resolves them or the sender confirms the exact message. Alias g is a gift. */
export const UNRESOLVED_THANK_YOU = `EXISTS(SELECT 1 FROM cf_welcome_enrollments e JOIN cf_welcome_steps s ON s.donor_id=e.donor_id AND s.step='thank'
 JOIN cf_communications m ON m.message_key=s.message_key WHERE e.first_gift_id=g.id
 AND (m.status IN ('preparing','uncertain','listed') OR (m.status='submitted' AND m.thank_recorded_at IS NULL))
 AND NOT EXISTS(SELECT 1 FROM cf_gift_acknowledgments k WHERE k.gift_id=g.id AND k.change_source='manual' AND k.updated_at>=m.created_at))`

/** One projection for donor histories and the gift ledger. A reviewed historical
 * cutoff supplies no invented thank-you date, method or external message link. */
export async function withGiftAcknowledgments(c: {db:D1Database}, gifts:Row[]) {
 if(!gifts.length)return
 const ids=JSON.stringify(gifts.map(g=>g.id))
 const [recorded,prior,held,cutoff]=await Promise.all([
  all(c,`SELECT k.*,a.delivery_status,a.submitted_at,CASE WHEN EXISTS(SELECT 1 FROM cf_letter_events e WHERE e.letter_id=a.id AND e.event='delivered' AND e.signature_verified=1) THEN 1 ELSE 0 END AS provider_delivered, i.notes AS interaction_content,n.body AS note_content,COALESCE(n.confidential,0) AS note_confidential FROM cf_gift_acknowledgments k LEFT JOIN cf_acks a ON a.id=k.letter_id LEFT JOIN cf_interactions i ON i.id=k.interaction_id LEFT JOIN cf_donor_notes n ON n.id=k.note_id WHERE k.gift_id IN (SELECT value FROM json_each(?))`,ids),
  all(c,'SELECT gift_id FROM cf_prior_acknowledgements WHERE gift_id IN (SELECT value FROM json_each(?))',ids),
  all(c,`SELECT g.id FROM cf_gifts g WHERE g.id IN (SELECT value FROM json_each(?)) AND ${UNRESOLVED_THANK_YOU}`,ids),
  one(c,'SELECT acknowledge_from FROM cf_receipt_autonomy WHERE id=1'),
 ])
 const byId=new Map(recorded.map(r=>[r.gift_id,r])),beforeCutoff=new Set(prior.map(r=>r.gift_id))
 for(const gift of gifts){
  gift.before_acknowledge_from=beforeCutoff.has(gift.id)||Boolean(cutoff?.acknowledge_from&&gift.received_on<cutoff.acknowledge_from)
  gift.acknowledgment=byId.get(gift.id)??(beforeCutoff.has(gift.id)?{status:'acknowledged',source:'Reviewed move-in cutoff',acknowledged_on:null,method:null,batch_id:null,letter_id:null,reason:null}:{status:'not acknowledged',version:0})
  const a=gift.acknowledgment
  if(a.status==='not acknowledged'&&held.some(h=>h.id===gift.id))a.outcome_unknown=1
  if(a.note_confidential){delete a.note_content}
  a.delivery=a.delivery_status==='bounced'||a.delivery_status==='complained'?'bounced':a.provider_delivered?'delivered (provider-reported)':a.method==='email'?'delivery not confirmed':null
  a.link=a.letter_id?{kind:'letter',id:a.letter_id,href:`/app/letters/${a.batch_id}`} : a.communication_id?{kind:'message',id:a.communication_id,href:'/app/agent/appeals'}:a.interaction_id?{kind:'interaction',id:a.interaction_id,content:a.interaction_content}:a.note_id?{kind:'note',id:a.note_id,content:a.note_content}:null
 }
}

/** Only the supported native thank step can acknowledge its originating gift.
 * A provider list handoff remains a visible hold, never evidence of a send. */
export async function communicationAcknowledgment(c: Context, message: Row, disposition: string): Promise<void> {
 let stepId=message.source_kind==='welcome'?message.source_id:null
 if(message.source_kind==='appeal')stepId=(await one(c,"SELECT json_extract(segment,'$.resendOf') AS step_id FROM cf_appeals WHERE id=?",message.source_id))?.step_id
 if(!stepId)return
 const step=await one(c,`SELECT s.step,e.first_gift_id FROM cf_welcome_steps s JOIN cf_welcome_enrollments e ON e.donor_id=s.donor_id WHERE s.id=?`,stepId)
 if(!step||step.step!=='thank')return
 const accepted=['accepted','sent','delivered'].includes(disposition)
 const failed=['bounced','dropped','not_sent','rejected','suppressed'].includes(disposition)
 const giftId=step.first_gift_id,day=today((await settings(c)).timezone,new Date(c.now))
 if(accepted){
  await commit(c,[sql(`INSERT INTO cf_gift_acknowledgments(gift_id,status,acknowledged_on,method,communication_id,source,updated_at,updated_by,updated_by_id,updated_by_role)
   SELECT ?,'acknowledged',?,'email',?,'Coffer welcome thank-you',?,?,?,? WHERE EXISTS(SELECT 1 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=? AND d.erased_at IS NULL) AND EXISTS(SELECT 1 FROM cf_communications WHERE id=? AND thank_recorded_at IS NULL)
   ON CONFLICT(gift_id) DO UPDATE SET version=version+1,status='acknowledged',acknowledged_on=excluded.acknowledged_on,method='email',communication_id=excluded.communication_id,batch_id=NULL,letter_id=NULL,interaction_id=NULL,note_id=NULL,reason=NULL,source=excluded.source,source_reference=NULL,outcome_unknown=0,updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_id=excluded.updated_by_id,updated_by_role=excluded.updated_by_role,change_source='automatic'
   `,giftId,day,message.id,c.now,c.actor.name,c.actor.id,c.actor.role,giftId,message.id),sql('UPDATE cf_communications SET thank_recorded_at=COALESCE(thank_recorded_at,?) WHERE id=?',c.now,message.id)])
 }else if(failed){
  await commit(c,[sql(`UPDATE cf_gift_acknowledgments SET version=version+1,status='not acknowledged',acknowledged_on=NULL,method=NULL,outcome_unknown=0,updated_at=?,updated_by=?,updated_by_id=?,updated_by_role=?,change_source='automatic' WHERE gift_id=? AND communication_id=? AND change_source='automatic' AND (status='acknowledged' OR outcome_unknown=1)`,c.now,c.actor.name,c.actor.id,c.actor.role,giftId,message.id)])
 }else{
  await commit(c,[sql(`INSERT INTO cf_gift_acknowledgments(gift_id,status,communication_id,source,outcome_unknown,updated_at,updated_by,updated_by_id,updated_by_role)
   VALUES(?,'not acknowledged',?,'Coffer welcome thank-you',1,?,?,?,?) ON CONFLICT(gift_id) DO UPDATE SET version=version+1,communication_id=excluded.communication_id,outcome_unknown=1,updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_id=excluded.updated_by_id,updated_by_role=excluded.updated_by_role,change_source='automatic' WHERE status='not acknowledged' AND outcome_unknown=0`,giftId,message.id,c.now,c.actor.name,c.actor.id,c.actor.role)])
 }
}
