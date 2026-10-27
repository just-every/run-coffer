import { recoveryPolicyRequired, policyConfigured, legacyRecoveryPolicy } from './recovery-notices-rules'
import { advanceRecoveryNotices } from './recovery-notices'
import { automationContext, automationAllows, automationRecords, claimAutomation } from '../automation-grants'
import { all, commit, fail, guard, newId, one, sql, today, type Context, type Row } from '../db'
import { settings } from '../settings'
import { emailPortalLink } from '../giving/portal'
import { stripeId } from '../giving/recording'
import { stripe, type GivingEnv } from '../giving/stripe'
import { action } from './activity'

/** Read the existing provider default, never collect card data in Coffer. */
export async function checkCardExpiry(c: Context, env: GivingEnv, current: Row) {
 const granted=await automationContext(env,'recovery',c.now)
 if(!granted)return
 c=granted
 const scope=automationRecords(c,'d.id')
 const saved = await one(c, `SELECT s.* FROM cf_subscriptions s JOIN cf_donors d ON d.id=s.donor_id
  WHERE s.id=? AND s.customer_id=? AND d.erased_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id) AND ${scope.sql}`, current.id, stripeId(current.customer),...scope.params)
 if (!saved || !automationAllows(c,saved.donor_id)) return
 if (!['active','trialing','past_due','incomplete'].includes(current.status)) {
  await commit(c,[sql('DELETE FROM cf_card_expiry_notices WHERE subscription_id=?',saved.id)])
  return
 }
 let method = current.default_payment_method
 if (!method) {
  await commit(c,[])
  const customer = await stripe(env, '/customers/'+encodeURIComponent(saved.customer_id))
  if (customer.id!==saved.customer_id || customer.deleted) fail('invalid_payment','Stripe returned a different customer.',409)
  method = customer.invoice_settings?.default_payment_method
 }
 const methodId = stripeId(method)
 // Replacing or removing the default method removes the old reference at once.
 await commit(c,[sql('DELETE FROM cf_card_expiry_notices WHERE subscription_id=? AND payment_method_id<>?',saved.id,methodId)])
 if (!methodId) return
 await commit(c,[])
 const payment = typeof method==='object' && method.card ? method : await stripe(env,'/payment_methods/'+encodeURIComponent(methodId))
 if (payment.id!==methodId || stripeId(payment.customer)!==saved.customer_id) fail('invalid_payment','Stripe returned a payment method for a different customer.',409)
 const year=payment.card?.exp_year, month=payment.card?.exp_month
 if (payment.type!=='card' || !Number.isInteger(year) || !Number.isInteger(month) || month<1 || month>12) {
  await commit(c,[sql('DELETE FROM cf_card_expiry_notices WHERE subscription_id=?',saved.id)])
  return
 }
 await commit(c,[sql('DELETE FROM cf_card_expiry_notices WHERE subscription_id=? AND (expiry_year<>? OR expiry_month<>?)',saved.id,year,month)])
 const day=today((await settings(c)).timezone,new Date(c.now)), currentYear=Number(day.slice(0,4)), currentMonth=Number(day.slice(5,7))
 if (year!==currentYear+(currentMonth===12?1:0) || month!==(currentMonth===12?1:currentMonth+1)) return
 if(await policyConfigured(c)||await recoveryPolicyRequired(c,saved.id)){
  const key='expiry:'+saved.id+':'+year+'-'+String(month).padStart(2,'0'),previous=await one(c,'SELECT case_started_at FROM cf_recovery_steps WHERE invoice_id=? ORDER BY ordinal LIMIT 1',key)
  const intent=await one(c,"SELECT amount_cents FROM cf_giving_intents WHERE customer_id=? AND frequency='monthly' ORDER BY created_at LIMIT 1",saved.customer_id)
  await advanceRecoveryNotices(c,env,saved.id,key,'expiry',intent?.amount_cents??saved.amount_cents,previous?.case_started_at??c.now,{methodId,year,month})
  return
 }
 if(await one(c,'SELECT subscription_id FROM cf_card_expiry_notices WHERE subscription_id=? AND payment_method_id=? AND expiry_year=? AND expiry_month=?',saved.id,methodId,year,month))return
 await claimAutomation(c,'recovery.expiry',1,saved.donor_id)
 const claimId=newId()
 await commit(c,[guard(legacyRecoveryPolicy,'POLICY_CHANGED','An explicit recovery notice policy now controls sending.'),sql(`INSERT OR IGNORE INTO cf_card_expiry_notices(subscription_id,payment_method_id,expiry_year,expiry_month,claim_id,state,checked_at)
  SELECT s.id,?,?,?,?,'sending',? FROM cf_subscriptions s JOIN cf_donors d ON d.id=s.donor_id
  WHERE s.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`,methodId,year,month,claimId,c.now,saved.id)])
 if (!await one(c,'SELECT subscription_id FROM cf_card_expiry_notices WHERE claim_id=?',claimId)) return
 let state='failed'
 try { state=await emailPortalLink(env,saved.donor_id,'Your monthly gift card expires next month',{authorize:()=>commit(c,[guard(legacyRecoveryPolicy,'POLICY_CHANGED','An explicit recovery notice policy now controls sending.'),guard('EXISTS(SELECT 1 FROM cf_card_expiry_notices WHERE subscription_id=? AND claim_id=? AND payment_method_id=?)','CARD_CHANGED','The current default card changed.',saved.id,claimId,methodId)])})?'sent':'skipped' } catch { /* Keep an uncertain send visible; do not resend automatically. */ }
 await commit(c,[sql('UPDATE cf_card_expiry_notices SET state=?,checked_at=? WHERE subscription_id=? AND claim_id=?',state,c.now,saved.id,claimId)])
 await action(c,{kind:'recovery.expiry_'+state,subjectId:saved.id,summary:state==='sent'?'Card-expiry portal warning accepted by the mail provider.':state==='skipped'?'No deliverable account for the card-expiry warning.':'Card-expiry email failed or delivery is uncertain.',why:'The current default card expires next calendar month in the organization’s time zone. This is a transactional notice, not an ask.'})
}

export function cardExpiryNotices(c: Pick<Context,'db'>) {
 return all(c, `SELECT n.subscription_id,n.expiry_year,n.expiry_month,n.state,n.checked_at,s.donor_id,d.name AS donor_name
  FROM cf_card_expiry_notices n JOIN cf_subscriptions s ON s.id=n.subscription_id JOIN cf_donors d ON d.id=s.donor_id
  WHERE d.erased_at IS NULL ORDER BY n.expiry_year,n.expiry_month,d.name`)
}
