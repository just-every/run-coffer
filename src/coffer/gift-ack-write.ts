import { requireRole } from './auth'
import { choice, date, fail, guard, id, integer, longText, newId, one, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { SOFT_ACK_METHODS } from './soft-credit-ack'
import { settings } from './settings'

/** Shared by the gift form and the atomic log-conversation-and-thank door. */
export async function giftAcknowledgmentWrite(c: Context, command: string, p: Row): Promise<{ statements: Stmt[]; result: Row }> {
 requireRole(c.actor, command === 'gift.doNotAcknowledge' ? ['owner','admin'] : ['owner','admin','member'], 'change a gift acknowledgment')
 const giftId = id(p.giftId, 'Gift'), version = integer(Number(p.version), 'Acknowledgment version', 0)
 const gift = await one(c, `SELECT g.* FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=? AND g.kind='gift' AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`, giftId)
 if (!gift) fail('NOT_FOUND', 'Choose a gift on a live donor.', 404)
 const status = command === 'gift.acknowledge' ? 'acknowledged' : command === 'gift.doNotAcknowledge' ? 'do not acknowledge' : 'not acknowledged'
 let day: string|null=null, method: string|null=null, interactionId: string|null=null, noteId: string|null=null, reason: string|null=null
 const statements: Stmt[] = [guard(`EXISTS(SELECT 1 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=? AND g.donor_id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`, 'GIFT_CHANGED', 'This donor or gift changed. Refresh before saving.', giftId,gift.donor_id),guard('COALESCE((SELECT version FROM cf_gift_acknowledgments WHERE gift_id=?),0)=?', 'VERSION', 'This acknowledgment changed. Refresh before saving.', giftId,version)]
 if (status === 'acknowledged') {
  day=date(p.acknowledgedOn,'Thank-you date'); method=choice(p.method,SOFT_ACK_METHODS,'thank-you method')
  if(day<gift.received_on||day>today((await settings(c)).timezone,new Date(c.now)))fail('INPUT','The thank-you date must be between the gift date and today.',400)
  interactionId=optional(p.interactionId,'Conversation',100)
  if(interactionId){
   if(optional(p.notes,'Thank-you message',8000))fail('INPUT','Choose a conversation or record a thank-you note.',400)
   const kind=method==='email'?'email':method==='phone call'?'call':method==='in person'?'meeting':null
   if(!kind)fail('INPUT','Record a thank-you note for this method.',400)
   statements.push(guard('EXISTS(SELECT 1 FROM cf_interactions WHERE id=? AND donor_id=? AND occurred_on=? AND kind=?)','ACK_INTERACTION','Choose a conversation with this donor on the same date and by the same method.',interactionId,gift.donor_id,day,kind))
  }else{
   const body=longText(p.notes,'Thank-you message');noteId=newId()
   statements.push(sql('INSERT INTO cf_donor_notes(id,donor_id,occurred_on,body,source,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?)',noteId,gift.donor_id,day,body,'Coffer gift thank-you',c.now,c.actor.name))
  }
 }else if(status==='do not acknowledge')reason=text(p.reason,'Reason not to acknowledge',1000)
 statements.push(sql(`INSERT INTO cf_gift_acknowledgments(gift_id,version,status,acknowledged_on,method,interaction_id,note_id,reason,source,updated_at,updated_by,updated_by_id,updated_by_role,change_source)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'manual') ON CONFLICT(gift_id) DO UPDATE SET version=excluded.version,status=excluded.status,acknowledged_on=excluded.acknowledged_on,method=excluded.method,interaction_id=excluded.interaction_id,note_id=excluded.note_id,reason=excluded.reason,batch_id=NULL,letter_id=NULL,communication_id=NULL,source=excluded.source,source_reference=NULL,outcome_unknown=0,updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_id=excluded.updated_by_id,updated_by_role=excluded.updated_by_role,change_source='manual'`,giftId,version+1,status,day,method,interactionId,noteId,reason,'Coffer recorded thank-you',c.now,c.actor.name,c.actor.id,c.actor.role))
 return {statements,result:{id:giftId,donorId:gift.donor_id,version:version+1,status,acknowledgedOn:day,method,interactionId,noteId}}
}
