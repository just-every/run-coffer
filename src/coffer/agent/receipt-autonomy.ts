import { automationContext, claimAutomation } from '../automation-grants'
import { requireGrant } from '../agent-grants'
import { executeGranted } from '../agent-grants-execution'
import { storedAgentContext } from '../agent-grant-context'
import { commit, CofferError, event, fail, one, sql, type Context, type Row } from '../db'
import { missingReceipts, prepareMissingReceiptBatch } from './receipts'
import { receiptPolicy } from './receipt-autonomy-policy'
export { receiptAutonomyState, saveReceiptAutonomy } from './receipt-autonomy-policy'
export { receiptStatementRecovery, recoverReceiptStatement } from './receipt-autonomy-statements'

async function review(c:Context,gift:Row,reasons:string[],batchId:string|null) {
 await commit(c,[sql('INSERT INTO cf_receipt_reviews VALUES(?,?,?,?) ON CONFLICT(gift_id) DO UPDATE SET reasons=excluded.reasons,batch_id=excluded.batch_id,updated_at=excluded.updated_at',gift.id,JSON.stringify(reasons),batchId,c.now),
 event(c,'agent.receipts.held','gift',gift.id,gift.donor_id,{reasons,batchId})])
}
/** Both the built-in preparation grant and the explicitly chosen external key
 * authorize this work. Every native dispatch transaction rechecks both. */
export async function runReceiptAutonomy(original:Context) {
 if(!original.env)fail('MAIL_UNAVAILABLE','Receipt sending is unavailable.',503)
 const builtin=await automationContext(original.env,'receipts',original.now)
 if(!builtin)fail('GRANT_DISABLED','Missing-receipt automation is stopped.',403)
 const c={...builtin,authority:{sql:`(${original.authority.sql}) AND (${builtin.authority.sql})`,params:[...original.authority.params,...builtin.authority.params]}}
 const policy=await receiptPolicy(c),found=await missingReceipts(c)
 if(!policy.selected_key_id) {
  const chosen=found.filter(g=>g.goods!=='unknown'&&g.net_cents>g.goods_cents)
  if(!chosen.length)return {queued:0,held:found.length,sent:0,id:null,batches:[]}
  await claimAutomation(c,'receipts.prepare',chosen.length)
  return {...await prepareMissingReceiptBatch(c,chosen),held:found.length-chosen.length,sent:0,batches:[]}
 }
 const key=await storedAgentContext(c,policy.selected_key_id)
 const agent:Context={...key,authority:{sql:`(${key.authority.sql}) AND EXISTS(SELECT 1 FROM cf_receipt_autonomy WHERE id=1 AND version=?) AND EXISTS(SELECT 1 FROM cf_agent_grant_control WHERE id=1 AND receipt_key_id=?)`,params:[...key.authority.params,policy.version,policy.selected_key_id]}}
 await requireGrant(agent,'ack.prepare');const grant=await requireGrant(agent,'ack.send'),scope=new Set<string>(JSON.parse(grant.donor_ids))
 // Do not broaden the external key to match the built-in all-record grant.
 const scoped=found.filter(g=>scope.has(g.donor_id)),standard=scoped.filter(g=>!g.hold_reasons.length),held=scoped.filter(g=>g.hold_reasons.length)
 const heldContext={...c,authority:agent.authority}
 const batches:Row[]=[];let sent=0,queued=0
 for(const g of held) {
  let batchId:null|string=null
  if(g.goods!=='unknown'&&g.net_cents>g.goods_cents) {
   await claimAutomation(c,'receipts.prepare',1,g.donor_id)
   const batch=await prepareMissingReceiptBatch(heldContext,[g]);batchId=batch.id;batches.push(batch);queued++
  }
  await review(heldContext,g,g.hold_reasons,batchId)
 }
 // One receipt per dispatch makes each frozen recipient's policy guard exact
 // and prevents an unusual merge field from stopping unrelated standard mail.
 for(const gift of standard) {
  await claimAutomation(c,'receipts.prepare',1,gift.donor_id)
  const current:Context={...agent,authority:{sql:`(${agent.authority.sql}) AND EXISTS(
   SELECT 1 FROM cf_gift_balances g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=? AND g.version=? AND g.net_cents=? AND d.version=?
   AND g.net_cents<=(SELECT max_standard_cents FROM cf_receipt_autonomy WHERE id=1)
   AND g.goods<>'unknown' AND g.net_cents>g.goods_cents AND d.erased_at IS NULL AND d.constituent_status='active'
   AND d.address_line1 IS NOT NULL AND d.city IS NOT NULL AND d.postal_code IS NOT NULL AND d.email IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM cf_gift_acknowledgments k WHERE k.gift_id=? AND (k.status='do not acknowledge' OR k.outcome_unknown=1 OR (k.status='acknowledged' AND k.updated_by_id<>?)))`,params:[...agent.authority.params,gift.id,gift.version,gift.net_cents,(await one(c,'SELECT version FROM cf_donors WHERE id=?',gift.donor_id))!.version,gift.id,agent.actor.id]}}
  const batch=await prepareMissingReceiptBatch(current,[gift]);queued++;batches.push(batch)
  const letter=await one(c,'SELECT * FROM cf_acks WHERE batch_id=?',batch.id)
  if(letter?.merge_blanks!=='[]') {
   await review(c,gift,['Template fields need human review'],batch.id);continue
  }
  try {
   const outcome=await executeGranted(current,'ack.send',{batchId:batch.id,version:1})
   sent+=outcome.submitted??0
   await commit(current,[sql("UPDATE cf_agent_activity SET undo_kind=NULL,undo_data=NULL,summary=?,why=? WHERE kind='receipts.prepare' AND subject_id=?",`Dispatched receipt batch: ${outcome.submitted??0} sender-accepted; ${outcome.print??0} awaiting mailing.`, 'Sent under the selected named grant and its standing template approval. Check delivery or review mailing; a submitted email cannot be recalled.',batch.id)])
   batches[batches.length-1]={...batch,...outcome}
   if(!outcome.submitted)await review(c,gift,[outcome.print?'Print and mailing need a person':'Delivery needs a person to investigate'],batch.id)
  } catch(error) {
   if(!(error instanceof CofferError))throw error
   await review(c,gift,[error.message],batch.id)
   batches[batches.length-1]={...batch,heldReason:error.message}
  }
 }
 await commit(agent,[event(agent,'agent.receipts.run','receipt_autonomy','1',null,{queued,sent,held:held.length,batches:batches.map(b=>b.id),outsideScope:found.length-scoped.length})])
 return {id:batches[0]?.id??null,queued,sent,held:held.length+standard.length-sent,batches,outsideScope:found.length-scoped.length}
}
