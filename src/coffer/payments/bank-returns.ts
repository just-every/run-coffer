import { fail, one, sql, today, type Row } from '../db'
import { routingOwner } from '../relationship-owner'
import { settings } from '../settings'
import { stripeId } from './stripe-data'
import { paymentWrite } from './write'
import type { GivingEnv } from '../giving/stripe'

/** Stripe represents a late ACH failure as a dispute. Insufficient funds is
 * NACHA R01; its balance debit is the existing append-only contribution reversal. */
export async function bankReturn(env: GivingEnv, dispute: Row) {
 if(dispute.reason!=='insufficient_funds')return
 const c={db:env.DB},chargeId=stripeId(dispute.charge)
 const gift=await one(c,`SELECT g.*,d.erased_at,i.id AS intent_id FROM cf_stripe_charges s JOIN cf_gifts g ON g.id=s.gift_id JOIN cf_donors d ON d.id=g.donor_id JOIN cf_giving_intents i ON i.id IN (SELECT intent_id FROM cf_bank_checkouts WHERE payment_intent_id=g.reference) WHERE s.id=? AND i.payment_method='us_bank_account'`,chargeId)
 if(!gift)return
 const existing=await one(c,'SELECT * FROM cf_bank_returns WHERE charge_id=?',chargeId)
 if(existing){
  // Restoring financial history grants no staff identity. Keep the one task,
  // routing it to a current owner when its archived assignee is unavailable.
  const task=existing.task_id&&!gift.erased_at?await one(c,'SELECT t.id,t.owner_id,o.status AS owner_status FROM cf_call_tasks t LEFT JOIN oa_operators o ON o.id=t.owner_id WHERE t.id=?',existing.task_id):null
  if(task&&task.owner_status!=='active'){
   const owner=await routingOwner(env.DB,gift.donor_id)
   if(owner)await paymentWrite(env,[sql('UPDATE cf_call_tasks SET owner_id=?,version=version+1 WHERE id=? AND owner_id=?',owner.id,task.id,task.owner_id)])
  }
  return
 }
 const entry=await one(c,"SELECT * FROM cf_payment_entries WHERE source_id=? AND charge_id=? AND kind='dispute'",dispute.id,chargeId)
 if(!entry||entry.amount_cents!==-gift.amount_cents||entry.contribution_cents!==-gift.amount_cents||dispute.currency!=='usd'||dispute.amount!==gift.amount_cents)fail('bank_return_uncertain','The bank return has not reconciled. Review Stripe before any correction.',409)
 const owner=gift.erased_at?null:await routingOwner(env.DB,gift.donor_id),now=new Date().toISOString(),taskId='bank-return-'+chargeId
 if(!gift.erased_at&&!owner)fail('bank_return_owner','Assign an active installation owner to review the bank return.',409)
 await paymentWrite(env,[
  ...(owner?[sql(`INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask,task_kind,gift_id)
   SELECT ?,id,?,'manual','Review returned ACH gift: insufficient funds (R01). No automatic retry or new debit.',0,?,?,?,0,'follow_up',? FROM cf_donors WHERE id=? AND erased_at IS NULL`,taskId,'bank-return:'+chargeId,owner.id,today((await settings(c)).timezone),now,gift.id,gift.donor_id)]:[]),
  sql('INSERT OR IGNORE INTO cf_bank_returns VALUES(?,?,?,?,?,?)',chargeId,dispute.id,entry.id,'R01',owner?taskId:null,now),
  sql("UPDATE cf_bank_checkouts SET status='returned',observed_at=? WHERE intent_id=?",now,gift.intent_id),
  sql("UPDATE cf_pending_bank_payments SET status='returned' WHERE id=?",gift.reference),
  sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) SELECT ?,'stripe','Stripe','agent','payments.bankReturned','gift',?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_events WHERE action='payments.bankReturned' AND subject_id=?)`,now,gift.id,gift.donor_id,JSON.stringify({returnCode:'R01',entryId:entry.id,taskId:owner?taskId:null}),gift.id),
 ])
}
