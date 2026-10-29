import { membershipCapture, selectedMembership } from '../memberships/service'
import { requireRole } from '../auth'
import { all, choice, commit, event, fail, guard, one, sha256, sql, text, type Context, type Row, type Stmt } from '../db'
import { amount } from '../money'
import { settings } from '../settings'
import { today } from '../db'
import { planFacts } from './portal-plans'
import { stripeId, syncSubscription } from './recording'
import { invoice } from './webhooks'
import { stripe, type GivingEnv } from './stripe'
import { requireSavedCardConsent, savedCardConsent } from './saved-card-consent'

const staff=(c:Context)=>requireRole(c.actor,['owner','admin'],'create recurring plans')
const live=`d.erased_at IS NULL AND d.constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`
async function donorAccount(c:Context,donorId:string){
 staff(c)
 const donor=await one(c,`SELECT d.id,d.version,d.name,d.email FROM cf_donors d WHERE d.id=? AND ${live}`,donorId)
 if(!donor)fail('DONOR_UNAVAILABLE','Choose a current constituent record.',404)
 const customers=await all(c,'SELECT customer_id FROM cf_giving_customers WHERE donor_id=?',donor.id)
 if(customers.length!==1)fail('CUSTOMER_UNAVAILABLE','This constituent needs one verified saved Stripe customer before starting a plan.',409)
 const customerId=customers[0].customer_id
 if(await one(c,'SELECT 1 FROM cf_subscriptions WHERE customer_id=? AND donor_id<>?',customerId,donor.id))fail('CUSTOMER_AMBIGUOUS','Separate the shared Stripe customer before starting a plan.',409)
 return {donor,customerId}
}
async function savedMethod(c:Context,customerId:string){
 const customer=await stripe(c.env as GivingEnv,'customers/'+encodeURIComponent(customerId))
 if(customer.id!==customerId||customer.deleted)fail('CUSTOMER_UNAVAILABLE','The saved Stripe customer is no longer available.',409)
 if(customer.discount||(Array.isArray(customer.discounts)&&customer.discounts.length)||customer.balance||Object.values(customer.invoice_credit_balance??{}).some(value=>value!==0)||customer.currency&&customer.currency!=='usd')fail('CUSTOMER_BILLING_REVIEW','Review customer discounts, balances and currency at Stripe before starting a plan.',409)
 const paymentMethodId=stripeId(customer.invoice_settings?.default_payment_method)
 if(!paymentMethodId)fail('PAYMENT_METHOD_REQUIRED','The donor must save a default Stripe payment method before staff can start this plan.',409)
 const method=await stripe(c.env as GivingEnv,'payment_methods/'+encodeURIComponent(paymentMethodId))
 if(method.id!==paymentMethodId||stripeId(method.customer)!==customerId||!['card','us_bank_account'].includes(method.type))fail('PAYMENT_METHOD_UNVERIFIED','Stripe did not verify a saved card or US bank account for this constituent.',409)
 if(method.type==='us_bank_account')fail('PAYMENT_METHOD_UNAVAILABLE','Staff recurring creation from a saved US bank account is not available yet. This entry requires a saved card.',409)
 if(method.type==='card'){
  const year=Number(method.card?.exp_year),month=Number(method.card?.exp_month),now=new Date(c.now)
  if(!Number.isSafeInteger(year)||!Number.isSafeInteger(month)||month<1||month>12||year*12+month<now.getUTCFullYear()*12+now.getUTCMonth()+1)fail('PAYMENT_METHOD_EXPIRED','The saved card needs replacement before starting a plan.',409)
 }
 return {paymentMethodId,paymentMethodType:method.type as string}
}
const versionOf=(donor:Row,customerId:string,method:Row)=>sha256(JSON.stringify({donorId:donor.id,donorVersion:donor.version,customerId,...method}))
export async function staffPlanCreateState(c:Context,donorId:string){
 const {donor,customerId}=await donorAccount(c,donorId),method=await savedMethod(c,customerId)
 const cardConsent=await savedCardConsent(c,donor.id,customerId,method.paymentMethodId)
 const [campaigns,sources]=await Promise.all([
  all(c,'SELECT id,name,fund,closes_on FROM cf_campaigns WHERE active=1 ORDER BY name,id'),
  all(c,`SELECT 'interaction:'||id AS reference,'Phone call · '||occurred_on AS label FROM cf_interactions WHERE donor_id=? AND kind='call' UNION ALL SELECT 'document:'||id,title FROM cf_record_documents WHERE donor_id=?`,donor.id,donor.id),
 ])
 const pending=await one(c,"SELECT id,created_at FROM cf_portal_changes WHERE donor_id=? AND action='staff.create' AND state IN ('pending','uncertain') LIMIT 1",donor.id)
 await commit(c,[])
 return {donor,customerId,...method,cardConsent,membershipLevels:await all(c,'SELECT * FROM cf_membership_levels WHERE active=1 ORDER BY name,id'),version:await versionOf(donor,customerId,{...method,consentId:cardConsent?.status==='granted'?cardConsent.id:null}),campaigns,sources,pending}
}
async function authorization(c:Context,donorId:string,reference:string,channel:string):Promise<{snapshot:string;guard:Stmt}>{
 const [kind,id,...rest]=reference.split(':')
 if(rest.length||!id||!['interaction','document'].includes(kind))fail('INPUT','Choose a recorded phone call or attached authorization document.',400)
 if(channel==='mail'&&kind!=='document')fail('AUTHORIZATION_REQUIRED','A mailed authorization requires an attached document.',400)
 const row=kind==='interaction'?await one(c,"SELECT id,donor_id,kind,occurred_on,notes,recorded_at,recorded_by FROM cf_interactions WHERE id=? AND donor_id=? AND kind='call'",id,donorId):await one(c,'SELECT id,donor_id,title,object_key,byte_length,created_at,created_by FROM cf_record_documents WHERE id=? AND donor_id=?',id,donorId)
 if(!row)fail('AUTHORIZATION_REQUIRED','Choose authorization evidence on this constituent.',409)
 const columns=Object.keys(row),table=kind==='interaction'?'cf_interactions':'cf_record_documents'
 return {snapshot:await sha256(JSON.stringify(row)),guard:guard(`EXISTS(SELECT 1 FROM ${table} WHERE ${columns.map(key=>key+' IS ?').join(' AND ')})`,'EVIDENCE_CHANGED','Authorization evidence changed. Review it before charging.',...columns.map(key=>row[key]))}
}

/** A durable staff claim precedes every provider write; unknown results never
 * release that claim or repeat a charge through a fresh request. */
export async function createStaffPlan(c:Context,input:Row){
 const membership=input.membershipLevelId?await selectedMembership(c,input):null
 if(membership)input={...input,campaignId:membership.campaign_id,amount:(membership.price_cents/100).toFixed(2),frequency:membership.term_months===12?'annually':membership.term_months===3?'quarterly':'monthly'}
 const donorId=text(input.donorId,'Constituent',100),{donor,customerId}=await donorAccount(c,donorId)
 if(input.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm authorization and the immediate first installment.',400)
 const requestId=text(input.requestId,'Request ID',64),campaignId=text(input.campaignId,'Campaign',100),frequency=choice(input.frequency,['monthly','quarterly','annually'] as const,'billing frequency'),cents=amount(input,'amount','Installment amount')
 if(!/^[a-f0-9-]{36}$/.test(requestId))fail('INPUT','Reload the new plan form.',400)
 if(cents<100||cents>10000000)fail('INPUT','Enter an installment between $1 and $100,000.',400)
 const channel=choice(input.givingChannel,['phone','mail'] as const,'authorization channel'),sourceRef=text(input.sourceRef,'Authorization evidence',220),version=text(input.version,'Saved payment version',64),paymentMethodId=text(input.paymentMethodId,'Saved payment method',100)
 if(input.customerId!==customerId)fail('CUSTOMER_CHANGED','The saved Stripe customer changed. Reload before confirming.',409)
 const payload=JSON.stringify({actorId:c.actor.id,donorId,customerId,paymentMethodId,version,campaignId,frequency,amountCents:cents,sourceRef,channel,membership:membership?{id:membership.id,version:membership.version}:null})
 const previous=await one(c,'SELECT * FROM cf_portal_changes WHERE id=?',requestId)
 if(previous){
  if(previous.action!=='staff.create'||previous.donor_id!==donorId||JSON.parse(previous.request).input!==payload)fail('REQUEST_CHANGED','This request ID belongs to a different plan instruction.',409)
  if(previous.state==='complete'){await commit(c,[]);return {id:previous.subscription_id,requestId,state:'complete'}}
  fail('CREATE_PENDING','A previous creation request needs a Stripe result check before another charge.',409)
 }
 const campaign=await one(c,'SELECT id,name,fund,active,closes_on FROM cf_campaigns WHERE id=? AND active=1',campaignId)
 if(!campaign)fail('CAMPAIGN_UNAVAILABLE','Choose an active campaign.',409)
 if(campaign.closes_on&&today((await settings(c)).timezone,new Date(c.now))>campaign.closes_on)fail('CAMPAIGN_CLOSED','Choose a campaign that is still accepting gifts.',409)
 const evidence=await authorization(c,donorId,sourceRef,channel),method=await savedMethod(c,customerId)
 const cardConsent=await requireSavedCardConsent(c,donorId,customerId,method.paymentMethodId)
 if(method.paymentMethodId!==paymentMethodId||version!==await versionOf(donor,customerId,{...method,consentId:cardConsent.id}))fail('PAYMENT_METHOD_CHANGED','The saved payment method or constituent changed. Reload before confirming.',409)
 const custody=()=>guard(`EXISTS(SELECT 1 FROM cf_donors d JOIN cf_giving_customers gc ON gc.donor_id=d.id WHERE d.id=? AND d.version=? AND gc.customer_id=? AND ${live}) AND (SELECT count(*) FROM cf_giving_customers WHERE donor_id=?)=1 AND NOT EXISTS(SELECT 1 FROM cf_subscriptions WHERE customer_id=? AND donor_id<>?)`,'CUSTOMER_CHANGED','The constituent or saved Stripe customer changed. Review the pending request.',donorId,donor.version,customerId,donorId,customerId,donorId)
 await commit(c,[custody(),evidence.guard,cardConsent.guard,guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND active=1 AND name=? AND fund=? AND closes_on IS ?)','CAMPAIGN_CHANGED','The campaign changed. Review it before charging.',campaignId,campaign.name,campaign.fund,campaign.closes_on),guard("NOT EXISTS(SELECT 1 FROM cf_portal_changes WHERE donor_id=? AND action='staff.create' AND state IN ('pending','uncertain'))",'CREATE_PENDING','A previous creation request needs a Stripe result check.',donorId),guard('NOT EXISTS(SELECT 1 FROM cf_giving_intents WHERE id=?)','REQUEST_CHANGED','This request ID is already in use.',requestId),sql("INSERT INTO cf_giving_intents(id,campaign_id,name,email,amount_cents,frequency,customer_id,donor_id,created_at,email_consent,requested_amount_cents,fee_cover_cents,giving_channel,billing_frequency,staff_actor_id,staff_actor_name,staff_channel) VALUES(?,?,?,?,?,'monthly',?,?,?,0,?,0,'form',?,?,?,?)",requestId,campaignId,donor.name,donor.email??'',cents,customerId,donorId,c.now,cents,frequency,c.actor.id,c.actor.name,channel),...(membership?[...await membershipCapture(c.db,requestId,membership),guard('EXISTS(SELECT 1 FROM cf_membership_levels WHERE id=? AND version=? AND active=1)','LEVEL_CHANGED','Membership level changed before charging.',membership.id,membership.version)]:[]),sql("INSERT INTO cf_portal_changes(id,donor_id,subscription_id,action,state,request,created_at) VALUES(?,?,NULL,'staff.create','pending',?,?)",requestId,donorId,JSON.stringify({input:payload,authorizationSnapshot:evidence.snapshot,paymentMethodType:method.paymentMethodType,savedCardConsentId:cardConsent.id}),c.now),event(c,'staffPlan.creationRequested','givingIntent',requestId,donorId,{requestId,campaignId,frequency,amountCents:cents,sourceRef,channel,authorizationSnapshot:evidence.snapshot,savedCardConsentId:cardConsent.id})])
 const env=c.env as GivingEnv,product=await stripe(env,'products',{name:membership?.name??campaign.name,'metadata[coffer_intent]':requestId},'coffer-staff-product-'+requestId)
 if(typeof product.id!=='string'||!product.id)fail('STRIPE_UNCONFIRMED','Stripe did not confirm the billing product. The creation request needs review.',502)
 const chargingMethod=await savedMethod(c,customerId)
 if(chargingMethod.paymentMethodId!==paymentMethodId||version!==await versionOf(donor,customerId,{...chargingMethod,consentId:cardConsent.id}))fail('PAYMENT_METHOD_CHANGED','The saved Stripe payment method changed before charging. Review the pending creation request.',409)
 await commit(c,[custody(),evidence.guard,cardConsent.guard])
 const interval=frequency==='annually'?'year':'month',count=membership&&interval==='month'?membership.term_months:frequency==='quarterly'?3:1
 const sub=await stripe(env,'subscriptions',{customer:customerId,default_payment_method:paymentMethodId,collection_method:'charge_automatically',payment_behavior:'error_if_incomplete','payment_settings[save_default_payment_method]':'on_subscription','payment_settings[payment_method_types][0]':method.paymentMethodType,'items[0][price_data][currency]':'usd','items[0][price_data][product]':product.id,'items[0][price_data][unit_amount]':cents,'items[0][price_data][recurring][interval]':interval,'items[0][price_data][recurring][interval_count]':count,'items[0][quantity]':1,'metadata[coffer_intent]':requestId},'coffer-staff-subscription-'+requestId)
 const facts=planFacts(sub)
 if(typeof sub.id!=='string'||!sub.id||stripeId(sub.customer)!==customerId||sub.metadata?.coffer_intent!==requestId||sub.status!=='active'||facts.amountCents!==cents||facts.interval!==interval||facts.intervalCount!==count||facts.product!==product.id||facts.paused||sub.cancel_at_period_end)fail('STRIPE_UNCONFIRMED','Stripe did not confirm the requested active plan. Review the pending request before another charge.',502)
 await commit(c,[custody(),evidence.guard,cardConsent.guard])
 const synced=await syncSubscription(env,sub.id,false)
 if(!synced||synced.intent.id!==requestId||synced.intent.donor_id!==donorId)fail('STRIPE_UNCONFIRMED','The created plan could not be linked safely. Review the pending request.',502)
 const verified=planFacts(synced.sub)
 if(synced.sub.status!=='active'||verified.amountCents!==cents||verified.interval!==interval||verified.intervalCount!==count||verified.product!==product.id||verified.paused||synced.sub.cancel_at_period_end)fail('STRIPE_UNCONFIRMED','The created plan changed during provider verification. Review its pending request.',502)
 const completed=new Date().toISOString()
 await commit(c,[custody(),evidence.guard,cardConsent.guard,sql("UPDATE cf_portal_changes SET subscription_id=?,state='complete',completed_at=? WHERE id=? AND state='pending'",sub.id,completed,requestId),event({...c,now:completed},'staffPlan.create','subscription',sub.id,donorId,{requestId,campaignId,frequency,amountCents:cents,sourceRef,channel,authorizationSnapshot:evidence.snapshot,savedCardConsentId:cardConsent.id})])
 if(stripeId(sub.latest_invoice))await invoice(env,stripeId(sub.latest_invoice))
 return {id:sub.id,requestId,state:'complete'}
}
