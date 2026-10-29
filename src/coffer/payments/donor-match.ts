import { manager } from '../auth'
import { all, commit, event, fail, guard, id, integer, one, sql, type Context, type Row, type Stmt } from '../db'
import { stripe, type GivingEnv } from '../giving/stripe'
import { syncCharge } from './charges'
import { syncEntry } from './entries'
import { syncPayout } from './payouts'
import { cents, stripeId, stripePages } from './stripe-data'
import { paymentWrite } from './write'

const installation = (env: GivingEnv) => env.RER_INSTALLATION_ID || env.AUTH_ORIGIN
const currentDonors = `SELECT DISTINCT d.id,d.version FROM (
 SELECT id AS donor_id,email FROM cf_donors UNION SELECT donor_id,email FROM cf_donor_aliases
 UNION SELECT donor_id,value AS email FROM cf_contact_points WHERE kind='email' AND active=1
) a LEFT JOIN cf_donor_merges m ON m.donor_id=a.donor_id
JOIN cf_donors d ON d.id=COALESCE(m.into_id,a.donor_id)
WHERE lower(a.email)=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)
ORDER BY d.id`
export const emailCandidates = (c: { db: D1Database }, mail: string) => all(c,currentDonors,mail)
const facts = (charge: Row, mail: string | null) => JSON.stringify({
 id:charge.id,customer:stripeId(charge.customer),paymentIntent:stripeId(charge.payment_intent),
 amount:cents(charge.amount),refunded:cents(charge.amount_refunded??0),currency:charge.currency,
 balance:stripeId(charge.balance_transaction),created:charge.created,status:charge.status,paid:charge.paid,
 fund:String(charge.metadata?.fund??'Unrestricted').trim().slice(0,100)||'Unrestricted',email:mail,
})
export async function stripeAccount(env: GivingEnv) {
 const account=await stripe(env,'/account')
 if(typeof account.id!=='string'||!/^acct_[a-zA-Z0-9_]+$/.test(account.id))fail('MATCH_PROVIDER_INCOMPLETE','Stripe did not confirm its account.',502)
 return account.id as string
}

/** Observations update a hold, never an approved selection or a source identity.
 * A changed donor set, amount or account requires a fresh explicit review. */
export async function holdDonorMatch(env: GivingEnv, charge: Row, mail: string | null, candidates: Row[], authority?: Context) {
 const c={db:env.DB},account=await stripeAccount(env),snapshot=facts(charge,mail),list=JSON.stringify(candidates),now=new Date().toISOString()
 const existing=await one(c,'SELECT * FROM cf_payment_donor_matches WHERE charge_id=?',charge.id)
 if(existing?.state==='erased')return
 if(existing&&(existing.account_id!==account||existing.installation_id!==installation(env)))fail('MATCH_ACCOUNT_CHANGED','This charge belongs to another connection or installation. No donor was assigned.')
 await paymentWrite(env,[sql(`INSERT INTO cf_payment_donor_matches
  (charge_id,installation_id,account_id,state,customer_id,email,facts,candidates,created_at,updated_at)
  VALUES(?,?,?,'held',?,?,?,?,?,?) ON CONFLICT(charge_id) DO UPDATE SET
  version=version+1,state='held',facts=excluded.facts,candidates=excluded.candidates,email=excluded.email,
  donor_id=NULL,donor_version=NULL,approved_version=NULL,approved_by=NULL,approved_actor_version=NULL,approved_at=NULL,updated_at=excluded.updated_at
  WHERE cf_payment_donor_matches.state<>'erased' AND (facts<>excluded.facts OR candidates<>excluded.candidates)`,
  charge.id,installation(env),account,stripeId(charge.customer)||null,mail,snapshot,list,now,now)],authority)
}

export function matchGuards(row: Row): Stmt[] {
 return [guard(`EXISTS(SELECT 1 FROM cf_payment_donor_matches r JOIN cf_donors d ON d.id=r.donor_id
  WHERE r.charge_id=? AND r.version=? AND r.state='approved' AND r.donor_id=? AND d.version=r.donor_version
  AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)
  AND EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=r.approved_by AND o.version=r.approved_actor_version AND o.status='active' AND o.role IN ('owner','admin')))`,
  'MATCH_CHANGED','The review or donor changed. Refresh before assigning this payment.',row.charge_id,row.version,row.donor_id)]
}
export async function approvedMatch(env: GivingEnv, charge: Row, mail: string | null) {
 const row=await one({db:env.DB},'SELECT * FROM cf_payment_donor_matches WHERE charge_id=?',charge.id)
 if(!row||row.state==='erased')return null
 if(row.account_id!==await stripeAccount(env)||row.installation_id!==installation(env))fail('MATCH_ACCOUNT_CHANGED','This payment needs review under its original Stripe account and installation.')
 const candidates=await emailCandidates({db:env.DB},mail??'')
 if(row.facts!==facts(charge,mail)||row.candidates!==JSON.stringify(candidates)){
  await holdDonorMatch(env,charge,mail,candidates)
  return null
 }
 if(row.state!=='approved')return null
 return row
}

export async function donorMatchView(c: Pick<Context,'db'>, chargeId: string) {
 const row=await one(c,'SELECT * FROM cf_payment_donor_matches WHERE charge_id=?',chargeId)
 if(!row)fail('NOT_FOUND','That donor review is not available.',404)
 const candidates=row.state==='erased'?[]:await all(c,`SELECT d.id,d.version,d.name,d.email FROM cf_donors d
  WHERE d.id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND d.erased_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) ORDER BY d.name,d.id`,row.candidates)
 const gift=await one(c,`SELECT g.id,g.donor_id,d.name FROM cf_stripe_charges s JOIN cf_gifts g ON g.id=s.gift_id
  JOIN cf_donors d ON d.id=g.donor_id WHERE s.id=? AND d.erased_at IS NULL`,chargeId)
 return {...row,facts:JSON.parse(row.facts),candidates,gift}
}
export async function donorMatchQueue(c: Pick<Context,'db'>) {
 const rows=await all(c,'SELECT charge_id FROM cf_payment_donor_matches ORDER BY created_at DESC,charge_id')
 return {matches:await Promise.all(rows.map(row=>donorMatchView(c,row.charge_id)))}
}

/** Read the complete relevant provider facts before releasing any money.
 * Only documented charge, refund and balance-transaction network edges are used. */
async function providerReview(env: GivingEnv, chargeId: string) {
 const account=await stripeAccount(env),charge=await stripe(env,'/charges/'+encodeURIComponent(chargeId))
 if(charge.id!==chargeId||charge.currency!=='usd'||charge.status!=='succeeded'||charge.paid!==true||cents(charge.amount)<=0)fail('MATCH_PROVIDER_INCOMPLETE','Stripe did not confirm this successful USD charge.',502)
 const customerId=stripeId(charge.customer),customer=customerId?await stripe(env,'/customers/'+encodeURIComponent(customerId)):null
 if(customer&&(customer.id!==customerId||customer.deleted))fail('MATCH_PROVIDER_INCOMPLETE','Stripe did not confirm the current customer.',502)
 const mail=String(charge.billing_details?.email??charge.receipt_email??customer?.email??'').trim().toLowerCase()||null
 const txnId=stripeId(charge.balance_transaction)
 if(!txnId)fail('MATCH_PROVIDER_INCOMPLETE','Stripe has not supplied the actual payment fee.',502)
 const entry=await stripe(env,'/balance_transactions/'+encodeURIComponent(txnId))
 if(entry.id!==txnId||stripeId(entry.source)!==chargeId||entry.currency!=='usd'||cents(entry.amount)!==charge.amount||cents(entry.net)!==entry.amount-cents(entry.fee))fail('MATCH_PROVIDER_INCOMPLETE','Stripe did not confirm the exact charge and fee.',502)
 const entries=[entry],seen=new Set<string>();let refunded=0
 for await(const refund of stripePages(env,'/refunds?charge='+encodeURIComponent(chargeId),true)){
  if(typeof refund.id!=='string'||seen.has(refund.id)||stripeId(refund.charge)!==chargeId||refund.currency!=='usd')fail('MATCH_PROVIDER_INCOMPLETE','Stripe returned an incomplete refund history.',502)
  seen.add(refund.id)
  if(refund.status!=='succeeded')continue
  const amount=cents(refund.amount),balanceId=stripeId(refund.balance_transaction)
  if(amount<=0||!balanceId)fail('MATCH_PROVIDER_INCOMPLETE','Stripe did not confirm a completed refund.',502)
  const txn=await stripe(env,'/balance_transactions/'+encodeURIComponent(balanceId))
  if(txn.id!==balanceId||stripeId(txn.source)!==refund.id||txn.currency!=='usd'||cents(txn.amount)!==-amount||cents(txn.net)!==txn.amount-cents(txn.fee))fail('MATCH_PROVIDER_INCOMPLETE','Stripe did not confirm the refund adjustment.',502)
  refunded+=amount;entries.push(txn)
 }
 if(refunded!==cents(charge.amount_refunded??0))fail('MATCH_PROVIDER_INCOMPLETE','Stripe refund history is incomplete. The payment stays held.',502)
 // Refuse a connection swap across the network reads, before any write.
 if(await stripeAccount(env)!==account)fail('MATCH_ACCOUNT_CHANGED','The Stripe account changed during review.')
 return {account,charge,mail,entries}
}

export async function refreshDonorMatch(c: Context, env: GivingEnv, chargeId: string) {
 if(!manager(c.actor))fail('manager_required','Only the owner or an admin reviews donor matches.',403)
 const row=await one(c,'SELECT * FROM cf_payment_donor_matches WHERE charge_id=?',chargeId)
 if(!row||row.state==='erased')fail('MATCH_CHANGED','This payment cannot be reviewed.')
 const current=await providerReview(env,chargeId)
 if(row.account_id!==current.account||row.installation_id!==installation(env))fail('MATCH_ACCOUNT_CHANGED','Restore the original connection before reviewing this payment.')
 await holdDonorMatch(env,current.charge,current.mail,await emailCandidates(c,current.mail??''),c)
 return donorMatchView(c,chargeId)
}
export async function approveDonorMatch(c: Context, env: GivingEnv, chargeId: string, input: Row) {
 if(!manager(c.actor))fail('manager_required','Only the owner or an admin reviews donor matches.',403)
 const version=integer(Number(input.version),'Review version',1),donorId=id(input.donorId,'Donor'),donorVersion=integer(Number(input.donorVersion),'Donor version',1)
 if(input.confirm!=='yes')fail('confirmation_required','Confirm this exact donor assignment.',400)
 const row=await one(c,'SELECT * FROM cf_payment_donor_matches WHERE charge_id=?',chargeId)
 if(!row||row.state==='erased')fail('MATCH_CHANGED','This payment cannot be assigned.')
 if(row.state==='resolved'){
  if(row.donor_id!==donorId||row.approved_version!==version)fail('MATCH_CHANGED','This payment already has a different decision.')
  return donorMatchView(c,chargeId)
 }
 const current=await providerReview(env,chargeId),candidates=await emailCandidates(c,current.mail??'')
 if(row.account_id!==current.account||row.installation_id!==installation(env))fail('MATCH_ACCOUNT_CHANGED','The Stripe account or installation changed. No donor was assigned.')
 if(row.facts!==facts(current.charge,current.mail)||row.candidates!==JSON.stringify(candidates))fail('MATCH_CHANGED','Provider facts or matching donors changed. Refresh and review again.')
 if(!candidates.some(d=>d.id===donorId&&d.version===donorVersion))fail('MATCH_CHANGED','Choose a current candidate from this review.')
 const approver=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id)
 if(row.state==='approved'&&(row.donor_id!==donorId||row.approved_version!==version))fail('MATCH_CHANGED','This payment already has a different decision.')
 if(row.state!=='approved')await commit(c,[
  guard("EXISTS(SELECT 1 FROM cf_payment_donor_matches WHERE charge_id=? AND version=? AND state='held')",'MATCH_CHANGED','This review already changed.',chargeId,version),
  guard(`(SELECT json_group_array(json_object('id',id,'version',version)) FROM (${currentDonors}))=?`,'MATCH_CHANGED','Matching donors changed during review.',current.mail??'',JSON.stringify(candidates)),
  sql("UPDATE cf_payment_donor_matches SET state='approved',donor_id=?,donor_version=?,approved_version=?,approved_by=?,approved_actor_version=?,approved_at=?,version=version+1,updated_at=? WHERE charge_id=?",donorId,donorVersion,version,c.actor.id,approver?.version,c.now,c.now,chargeId),
  event(c,'payments.donorMatchApproved','payment',chargeId,donorId,{accountId:current.account,reviewVersion:version}),
 ])
 const saved=await syncCharge(env,chargeId,c)
 if(!saved)fail('MATCH_CHANGED','The payment changed before recording. Refresh its review.')
 for(const entry of current.entries)await syncEntry(env,entry,c)
 await commit(c,[sql("UPDATE cf_payment_donor_matches SET state='resolved',version=version+1 WHERE charge_id=? AND state='approved'",chargeId)])
 for(const payout of await all(c,'SELECT payout_id FROM cf_payment_match_payouts WHERE charge_id=?',chargeId))await syncPayout(env,payout.payout_id,c)
 return donorMatchView(c,chargeId)
}

/** Redact all affected source evidence, retaining an opaque replay tombstone.
 * A shared address is never enough to recreate an erased person's payment. */
export function donorMatchErasure(donorId: string): Stmt[] {
 const affected=`donor_id=? OR EXISTS(SELECT 1 FROM json_each(candidates) WHERE json_extract(value,'$.id')=?)
 OR lower(email) IN (SELECT lower(email) FROM cf_donors WHERE id=? UNION SELECT lower(value) FROM cf_contact_points WHERE donor_id=? AND kind='email')`
 return [sql(`UPDATE cf_payment_donor_matches SET state='erased',email=NULL,customer_id=NULL,facts='{}',candidates='[]',
 donor_id=NULL,donor_version=NULL,approved_by=NULL,approved_actor_version=NULL,approved_at=NULL,version=version+1 WHERE ${affected}`,donorId,donorId,donorId,donorId)]
}
