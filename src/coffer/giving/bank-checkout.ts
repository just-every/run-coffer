import { choice, fail, one, type Row } from '../db'
import { stripe, type GivingEnv } from './stripe'
import { day, stripeId } from '../payments/stripe-data'
import { settings } from '../settings'

export function checkoutMethod(p: Row, ordinary: boolean) {
 // Coffer has no bank-number collection door, including direct form submissions.
 if (Object.keys(p).some(key=>/account.?number|routing.?number|card.?number|\bcvc\b/i.test(key))) fail('bank_data','Enter payment details only on Stripe.',400)
 const method=choice(p.paymentMethod??'card',['card','us_bank_account'] as const,'payment method')
 if(method==='us_bank_account'&&(!ordinary||p.frequency!=='once'))fail('bank_scope','Bank checkout is available for one-time campaign gifts. Choose card for other gifts.',400)
 return method
}
export const bankSessionParams = {
 'allowed_payment_method_types[0]':'us_bank_account',
 'payment_method_options[us_bank_account][verification_method]':'instant',
 'payment_method_options[us_bank_account][financial_connections][permissions][0]':'payment_method',
}
const opaque=(value: any,prefix: string)=>typeof value==='string'&&new RegExp('^'+prefix+'[A-Za-z0-9_]+$').test(value)

/** Re-read the session, intent, charge and mandate at the provider boundary.
 * A signed event is a wake-up, never a settlement or authorization assertion. */
export async function bankCheckoutState(env: GivingEnv, saved: Row, suppliedSession?: Row, suppliedCharge?: Row) {
 const session: Row=suppliedSession??await stripe<Row>(env,'/checkout/sessions/'+encodeURIComponent(saved.session_id))
 if(session.id!==saved.session_id||session.metadata?.coffer_intent!==saved.id||stripeId(session.customer)!==saved.customer_id||session.currency!=='usd'||session.amount_total!==saved.amount_cents||session.mode!=='payment'||session.payment_method_types?.length!==1||session.payment_method_types[0]!=='us_bank_account')fail('bank_mismatch','Stripe returned a different bank checkout.',409)
 const piId=stripeId(session.payment_intent)
 if(!opaque(piId,'pi_'))fail('bank_pending','Stripe has not confirmed this bank payment yet.',409)
 const payment=await stripe(env,'/payment_intents/'+encodeURIComponent(piId))
 if(payment.id!==piId||payment.metadata?.coffer_intent!==saved.id||stripeId(payment.customer)!==saved.customer_id||payment.currency!=='usd'||payment.amount!==saved.amount_cents||payment.payment_method_types?.length!==1||payment.payment_method_types[0]!=='us_bank_account')fail('bank_mismatch','The bank payment differs from the agreed gift.',409)
 const prior=await one({db:env.DB},'SELECT * FROM cf_bank_checkouts WHERE intent_id=?',saved.id)
 const retained=prior
 if(retained?.status==='returned')return {status:'returned',payment,charge:null}
 if(retained?.status==='succeeded'&&payment.status!=='succeeded')fail('bank_uncertain','Stripe no longer confirms this settled payment. Review the original gift; no new gift was recorded.',409)
 if(['requires_payment_method','canceled'].includes(payment.status)) {
  await env.DB.prepare("UPDATE cf_bank_checkouts SET status=CASE WHEN status IN ('succeeded','returned') THEN status ELSE 'failed' END,observed_at=? WHERE intent_id=?").bind(new Date().toISOString(),saved.id).run()
  return {status:'failed',payment,charge:null}
 }
 if(!['processing','succeeded'].includes(payment.status)||session.status!=='complete')fail('bank_uncertain','The bank payment is not confirmed. No gift has been recorded.',409)
 const chargeId=stripeId(payment.latest_charge),method=stripeId(payment.payment_method)
 if(!opaque(chargeId,'ch_')||!opaque(method,'pm_'))fail('bank_uncertain','The bank authorization is incomplete.',409)
 const charge: Row=suppliedCharge??await stripe<Row>(env,'/charges/'+encodeURIComponent(chargeId))
 const mandate=stripeId(charge.payment_method_details?.us_bank_account?.mandate)
 if(charge.id!==chargeId||stripeId(charge.payment_intent)!==piId||stripeId(charge.customer)!==saved.customer_id||charge.currency!=='usd'||charge.amount!==saved.amount_cents||charge.payment_method_details?.type!=='us_bank_account'||stripeId(charge.payment_method)!==method||!opaque(mandate,'mandate_'))fail('bank_mismatch','Stripe returned a different bank authorization.',409)
 if(prior&&(prior.payment_intent_id!==piId||prior.payment_method_id!==method||prior.mandate_id!==mandate))fail('bank_changed','This bank checkout authorization changed. No gift was recorded.',409)
 const authorization=await stripe(env,'/mandates/'+encodeURIComponent(mandate))
 // A late return can deactivate the mandate before any notification arrives.
 // Reconcile that same independently settled payment;
 // an inactive mandate grants no new collection or pending-payment authority.
 const historicalMandate=payment.status==='succeeded'&&authorization.status==='inactive'
 if(authorization.id!==mandate||stripeId(authorization.payment_method)!==method||(authorization.status!=='active'&&!historicalMandate)||authorization.payment_method_details?.type!=='us_bank_account'||authorization.customer_acceptance?.type!=='online'||(!Number.isSafeInteger(authorization.customer_acceptance?.accepted_at)||authorization.customer_acceptance.accepted_at<=0))fail('bank_mandate','Stripe has not confirmed the bank mandate.',409)
 if(payment.status==='succeeded'&&(session.payment_status!=='paid'||charge.status!=='succeeded'||!charge.paid||!charge.balance_transaction||payment.amount_received!==saved.amount_cents))fail('bank_uncertain','Stripe has not confirmed settled funds.',409)
 if(payment.status==='succeeded'){
  const transaction=await stripe(env,'/balance_transactions/'+encodeURIComponent(stripeId(charge.balance_transaction)))
  if(transaction.id!==stripeId(charge.balance_transaction)||stripeId(transaction.source)!==charge.id||transaction.currency!=='usd'||transaction.type!=='charge'||transaction.amount!==saved.amount_cents||!Number.isSafeInteger(transaction.fee)||transaction.net!==transaction.amount-transaction.fee)fail('bank_uncertain','The settled bank funds have not reconciled.',409)
 }
 const now=new Date().toISOString()
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO cf_bank_checkouts VALUES(?,?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET status=CASE WHEN cf_bank_checkouts.status='returned' THEN 'returned' WHEN cf_bank_checkouts.status='succeeded' AND excluded.status='processing' THEN 'succeeded' ELSE excluded.status END,observed_at=excluded.observed_at`).bind(saved.id,piId,method,mandate,payment.status,now),
  env.DB.prepare(`INSERT INTO cf_pending_bank_payments(id,fund,amount_cents,received_on,status) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status`).bind(piId,saved.fund??'Unrestricted',saved.amount_cents,day(payment.created,(await settings({db:env.DB})).timezone),payment.status),
 ])
 const current=await one({db:env.DB},'SELECT status FROM cf_bank_checkouts WHERE intent_id=?',saved.id)
 return {status:current!.status as string,payment,charge}
}

/** A signed checkout event can recover a lost create response without another
 * provider write. It may only fill the exact held request's absent session. */
export async function recoverBankSession(env: GivingEnv, sessionId: string) {
 const session=await stripe(env,'/checkout/sessions/'+encodeURIComponent(sessionId))
 const saved=await one({db:env.DB},"SELECT * FROM cf_giving_intents WHERE id=? AND payment_method='us_bank_account' AND bank_submission_state='uncertain' AND session_id IS NULL",session.metadata?.coffer_intent??'')
 if(!saved)return
 if(session.id!==sessionId||stripeId(session.customer)!==saved.customer_id||session.currency!=='usd'||session.amount_total!==saved.amount_cents||session.mode!=='payment'||session.payment_method_types?.length!==1||session.payment_method_types[0]!=='us_bank_account')fail('bank_mismatch','This checkout does not match the held request.',409)
 await env.DB.prepare("UPDATE cf_giving_intents SET session_id=?,bank_submission_state='created' WHERE id=? AND session_id IS NULL AND bank_submission_state='uncertain'").bind(sessionId,saved.id).run()
}
