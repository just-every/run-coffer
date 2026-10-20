import { all, commit, event, fail, guard, id, integer, one, sql, type Context, type Row } from '../db'
import { amount } from '../money'
import { stripe, requireStripe, type GivingEnv } from '../giving/stripe'
import { stripeId } from './stripe-data'
import { syncEntry } from './entries'

/** Persist the authorized attempt before the network call. An interrupted answer
 * is visible uncertainty, never permission to make another refund. */
export async function requestRefund(c: Context, env: GivingEnv, p: Row) {
 const requestId=id(p.requestId,'Refund request'),giftId=id(p.giftId,'Gift'),cents=amount(p,'amount','Refund amount')
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))fail('INPUT','Refresh the refund form to get a valid request identifier.',400)
 const expected=integer(Number(p.expectedNetCents),'Expected remaining cents',1)
 const previous=await one(c,'SELECT * FROM cf_refund_requests WHERE id=?',requestId)
 if(previous){
  if(previous.gift_id!==giftId || previous.amount_cents!==cents || previous.expected_net_cents!==expected)fail('REFUND_CHANGED','This request identifier already belongs to a different refund.')
  return previous
 }
 requireStripe(env)
 const gift=await one(c,`SELECT g.*,s.id AS charge_id FROM cf_gift_balances g JOIN cf_stripe_charges s ON s.gift_id=g.id JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=? AND d.erased_at IS NULL`,giftId)
 if(!gift)fail('NOT_FOUND','Choose a recorded Stripe gift belonging to a current donor.',404)
 if(cents>expected)fail('REFUND_AMOUNT','The refund exceeds the remaining gift.',400)
 await commit(c,[
  guard('EXISTS(SELECT 1 FROM cf_gift_balances WHERE id=? AND net_cents=?)','GIFT_CHANGED','The remaining contribution changed. Refresh before refunding.',giftId,expected),
  guard("NOT EXISTS(SELECT 1 FROM cf_refund_requests WHERE charge_id=? AND status IN ('uncertain','pending','requires_action'))",'REFUND_PENDING','A refund for this charge is unresolved. Check Stripe before preparing another.',gift.charge_id),
  sql("INSERT INTO cf_refund_requests(id,gift_id,charge_id,amount_cents,expected_net_cents,status,created_at,created_by) VALUES(?,?,?,?,?,'uncertain',?,?)",requestId,giftId,gift.charge_id,cents,expected,c.now,c.actor.id),
  event(c,'payments.refundRequested','refund',requestId,gift.donor_id,{giftId,amountCents:cents}),
 ])
 let refund: Row
 try { refund=await stripe(env,'/refunds',{charge:gift.charge_id,amount:cents,'metadata[coffer_refund_request]':requestId},'coffer-refund-'+requestId) }
 catch { return (await one(c,'SELECT * FROM cf_refund_requests WHERE id=?',requestId))! }
 if(stripeId(refund.charge)!==gift.charge_id || refund.amount!==cents || refund.currency!=='usd' || typeof refund.id!=='string' || !refund.id.startsWith('re_'))fail('REFUND_UNCERTAIN','Stripe did not confirm this exact refund. Check Stripe; do not submit another.',502)
 await reconcileRefund(env,refund,requestId)
 return (await one(c,'SELECT * FROM cf_refund_requests WHERE id=?',requestId))!
}

/** A signed webhook can resolve an interrupted response using the request's
 * metadata. Provider facts remain recordable even if the initiating session ended. */
export async function reconcileRefund(env: GivingEnv, refund: Row, requestedId?: string) {
 if(refund.status==='succeeded' && refund.balance_transaction)await syncEntry(env,stripeId(refund.balance_transaction))
 if(refund.failure_balance_transaction)await syncEntry(env,stripeId(refund.failure_balance_transaction))
 const requestId=requestedId??refund.metadata?.coffer_refund_request
 if(!requestId)return
 const saved=await one({db:env.DB},'SELECT * FROM cf_refund_requests WHERE id=?',requestId)
 if(!saved)return
 if(saved.charge_id!==stripeId(refund.charge) || saved.amount_cents!==refund.amount || refund.currency!=='usd')fail('REFUND_CHANGED','The Stripe refund differs from its saved request.',502)
 const state=['succeeded','pending','failed','canceled','requires_action'].includes(refund.status)?refund.status:'uncertain'
 await env.DB.prepare('UPDATE cf_refund_requests SET refund_id=?,status=?,checked_at=? WHERE id=?').bind(refund.id,state,new Date().toISOString(),requestId).run()
}

export async function adjustmentState(c: Pick<Context,'db'>) {
 const [refunds,disputes,notices,gifts]=await Promise.all([
  all(c,'SELECT r.*,d.name FROM cf_refund_requests r JOIN cf_gifts g ON g.id=r.gift_id JOIN cf_donors d ON d.id=g.donor_id ORDER BY r.created_at DESC,r.id'),
  all(c,'SELECT s.*,d.name FROM cf_payment_disputes s JOIN cf_gifts g ON g.id=s.gift_id JOIN cf_donors d ON d.id=g.donor_id ORDER BY s.updated_at DESC,s.id'),
  all(c,'SELECT n.*,o.display_name AS owner_name FROM cf_payment_notices n LEFT JOIN oa_operators o ON o.id=n.owner_id ORDER BY n.created_at DESC,n.id'),
  all(c,`SELECT g.id,g.net_cents,d.name,s.id AS charge_id FROM cf_gift_balances g JOIN cf_stripe_charges s ON s.gift_id=g.id JOIN cf_donors d ON d.id=g.donor_id WHERE g.net_cents>0 AND d.erased_at IS NULL ORDER BY g.received_on DESC,g.id`),
 ])
 return {refunds,disputes,notices,gifts}
}
