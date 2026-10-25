import { all, commit, event, fail, guard, sql } from '../db'
import { box, hidden } from '../ui/common'
import { portalContext, type PortalDonor } from './portal-identity'
import { portalPage } from './portal-ui'
import { stripeId } from './recording'
import { savedCardConsent } from './saved-card-consent'
import { stripe, type GivingEnv } from './stripe'

async function ownSavedCard(env:GivingEnv,donor:PortalDonor){
 const c=await portalContext(env,donor),accounts=await all(c,'SELECT customer_id FROM cf_giving_customers WHERE donor_id=?',donor.id)
 if(accounts.length!==1)fail('CUSTOMER_UNAVAILABLE','Please contact the organization to verify your saved payment account.',409)
 const customerId=accounts[0].customer_id
 const custody=guard('(SELECT count(*) FROM cf_giving_customers WHERE donor_id=?)=1 AND EXISTS(SELECT 1 FROM cf_giving_customers WHERE donor_id=? AND customer_id=?) AND NOT EXISTS(SELECT 1 FROM cf_giving_customers WHERE customer_id=? AND donor_id<>?) AND NOT EXISTS(SELECT 1 FROM cf_subscriptions WHERE customer_id=? AND donor_id<>?)','CUSTOMER_CHANGED','Your saved payment account changed. Please contact the organization.',donor.id,donor.id,customerId,customerId,donor.id,customerId,donor.id)
 await commit(c,[custody])
 const customer=await stripe(env,'customers/'+encodeURIComponent(customerId)),methodId=stripeId(customer.invoice_settings?.default_payment_method)
 if(customer.id!==customerId||customer.deleted||!methodId)fail('PAYMENT_METHOD_REQUIRED','Save a default payment card at Stripe before granting permission.',409)
 const method=await stripe(env,'payment_methods/'+encodeURIComponent(methodId))
 if(method.id!==methodId||stripeId(method.customer)!==customerId||method.type!=='card')fail('PAYMENT_METHOD_UNVERIFIED','Stripe could not verify a saved card on your payment account.',409)
 return {c,customerId,methodId,custody,consent:await savedCardConsent(c,donor.id,customerId,methodId)}
}

export async function savedCardConsentPage(env:GivingEnv,donor:PortalDonor,saved=false){
 const {c,customerId,methodId,custody,consent}=await ownSavedCard(env,donor)
 await commit(c,[custody])
 const granted=consent?.status==='granted'
 return portalPage('Saved card permission',`${saved?'<p class="notice" role="status">Your saved card permission was recorded.</p>':''}${box('Permission for your current saved card',`<p>Your permission for the default card currently saved at Stripe is ${granted?'granted':'not granted'}. This permission applies only to that card. A replacement card needs its own permission.</p><p>You can let authorized staff use this saved card to start a recurring gift after you separately authorize its amount, schedule and immediate first installment. Granting permission here does not start a gift or charge your card.</p><form method="post" action="/giving/portal/saved-card">${hidden('customerId',customerId)}${hidden('paymentMethodId',methodId)}${hidden('version',consent?.id??0)}${hidden('status',granted?'withdrawn':'granted')}${granted?'<p>Withdrawal prevents staff from starting new plans with this card. Existing recurring gifts continue; manage them from your giving account.</p>':'<label><input type="checkbox" name="confirm" value="yes" required> I permit authorized staff to use this saved card for recurring gifts I separately authorize.</label>'}${granted?hidden('confirm','yes'):''}<button>${granted?'Withdraw saved card permission':'Grant saved card permission'}</button></form>`)}<p><a href="/giving/portal">Back to your giving account</a></p>`)
}

export async function saveSavedCardConsent(env:GivingEnv,donor:PortalDonor,data:URLSearchParams){
 if(data.has('donorId')&&data.get('donorId')!==donor.id)fail('FORBIDDEN','Only your own saved card permission can be recorded.',403)
 if(data.get('confirm')!=='yes')fail('CONFIRMATION_REQUIRED','Confirm permission for your saved card.',400)
 const status=data.get('status')
 if(status!=='granted'&&status!=='withdrawn')fail('INPUT','Choose whether to grant or withdraw saved card permission.',400)
 const {c,customerId,methodId,custody,consent}=await ownSavedCard(env,donor),version=Number(data.get('version'))
 if(data.get('customerId')!==customerId||data.get('paymentMethodId')!==methodId)fail('PAYMENT_METHOD_CHANGED','Your saved card changed. Reload and review its permission.',409)
 if(!data.has('version')||!Number.isSafeInteger(version)||version!==(consent?.id??0))fail('SAVED_CARD_CONSENT_CHANGED','Your saved card permission changed. Reload before confirming.',409)
 if(consent?.status===status){await commit(c,[custody]);return}
 await commit(c,[custody,guard('COALESCE((SELECT id FROM cf_saved_card_consents WHERE donor_id=? AND customer_id=? AND payment_method_id=? ORDER BY id DESC LIMIT 1),0)=?','SAVED_CARD_CONSENT_CHANGED','Your saved card permission changed. Reload before confirming.',donor.id,customerId,methodId,version),sql('INSERT INTO cf_saved_card_consents(donor_id,customer_id,payment_method_id,status,recorded_at,recorded_by) VALUES(?,?,?,?,?,?)',donor.id,customerId,methodId,status,c.now,c.actor.id),event(c,'portal.savedCardConsent','donor',donor.id,donor.id,{customerId,paymentMethodId:methodId,status,method:'authenticated donor portal'})])
}
