import { requireRole } from '../auth'
import { definedAppeal } from '../attribution'
import { all, commit, event, fail, guard, one, sha256, sql, today, type Context, type Row, type Stmt } from '../db'
import { amount } from '../money'
import { settings } from '../settings'
import { syncEntry } from '../payments/entries'
import { identify, recordGift, stripeId } from './recording'
import { requireSavedCardConsent, savedCardConsent } from './saved-card-consent'
import { authorization, donorAccount, savedMethod, staffChargingPending } from './staff-plan-create'
import { stripe, type GivingEnv } from './stripe'

const staff=(c:Context)=>requireRole(c.actor,['owner','admin'],'charge an authorized saved card')
const live=`d.erased_at IS NULL AND d.constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`

export async function staffPaymentState(c:Context,donorId:string){
 staff(c)
 const {donor,customerId}=await donorAccount(c,donorId),method=await savedMethod(c,customerId)
 const cardConsent=await savedCardConsent(c,donorId,customerId,method.paymentMethodId,'once')
 const [campaigns,appeals,sources,pending]=await Promise.all([
  all(c,'SELECT id,name,fund,closes_on FROM cf_campaigns WHERE active=1 ORDER BY name,id'),
  all(c,'SELECT code,name FROM cf_appeal_codes ORDER BY name,code'),
  all(c,`SELECT 'interaction:'||id AS reference,'Phone call · '||occurred_on AS label FROM cf_interactions WHERE donor_id=? AND kind='call' UNION ALL SELECT 'document:'||id,title FROM cf_record_documents WHERE donor_id=?`,donorId,donorId),
  one(c,staffChargingPending+' LIMIT 1',donorId),
 ])
 const evidence:Row[]=await Promise.all(sources.map(async s=>({...s,snapshot:(await authorization(c,donorId,s.reference,'phone')).snapshot})))
 const version=await sha256(JSON.stringify({donor,customerId,...method,consentId:cardConsent?.id??0,evidence}))
 await commit(c,[])
 return {donor,customerId,...method,cardConsent,campaigns,appeals,sources:evidence,pending,version}
}

/** Review binds the exact immediate charge and current evidence. It submits no payment. */
export async function reviewStaffPayment(c:Context,input:Row){
 const s=await staffPaymentState(c,String(input.donorId??''))
 if(s.pending)fail('PAYMENT_PENDING','A previous staff charge needs a provider result check before another payment.',409)
 if(input.version!==s.version||input.customerId!==s.customerId||input.paymentMethodId!==s.paymentMethodId)fail('PAYMENT_CHANGED','The constituent, card, permission or authorization evidence changed. Reload the payment entry.',409)
 const consent=await requireSavedCardConsent(c,s.donor.id,s.customerId,s.paymentMethodId,'once')
 const cents=amount({amount:input.amount},'amount','Immediate gift amount')
 if(cents<100||cents>10000000)fail('INPUT','Enter a gift between $1 and $100,000.',400)
 if(!['phone','mail'].includes(input.givingChannel))fail('INPUT','Choose phone or mailed authorization.',400)
 const campaign=s.campaigns.find(row=>row.id===input.campaignId)
 if(!campaign)fail('CAMPAIGN_UNAVAILABLE','Choose an active campaign.',409)
 if(campaign.closes_on&&today((await settings(c)).timezone,new Date(c.now))>campaign.closes_on)fail('CAMPAIGN_CLOSED','Choose a campaign that is still accepting gifts.',409)
 const appeal=await definedAppeal(c,input.appeal)
 if(!appeal)fail('APPEAL_REQUIRED','Choose a defined appeal for this staff payment.',400)
 const evidence=await authorization(c,s.donor.id,String(input.sourceRef??''),input.givingChannel)
 const facts={actorId:c.actor.id,actorRole:c.actor.role,donorId:s.donor.id,donorVersion:s.donor.version,customerId:s.customerId,paymentMethodId:s.paymentMethodId,consentId:consent.id,amountCents:cents,campaign,appeal,sourceRef:input.sourceRef,authorizationSnapshot:evidence.snapshot,channel:input.givingChannel}
 const reviewVersion=await sha256(JSON.stringify(facts))
 await commit(c,[evidence.guard,consent.guard])
 return {...s,campaign,appeal,amountCents:cents,sourceRef:input.sourceRef,givingChannel:input.givingChannel,reviewVersion,facts}
}

/** A durable claim is never released by transport failure or a new request ID. */
export async function createStaffPayment(c:Context,input:Row){
 staff(c)
 if(typeof input.requestId!=='string'||! /^[a-f0-9-]{36}$/.test(input.requestId))fail('INPUT','Reload the payment form.',400)
 if(input.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm the exact immediate charge and recorded donor authorization.',400)
 const previous=await one(c,'SELECT * FROM cf_portal_changes WHERE id=?',input.requestId)
 const payload=JSON.stringify({actorId:c.actor.id,donorId:input.donorId,customerId:input.customerId,paymentMethodId:input.paymentMethodId,version:input.version,campaignId:input.campaignId,appeal:input.appeal,amount:input.amount,sourceRef:input.sourceRef,givingChannel:input.givingChannel,reviewVersion:input.reviewVersion})
 if(previous){
  if(previous.action!=='staff.payment'||JSON.parse(previous.request).input!==payload)fail('REQUEST_CHANGED','This request ID belongs to a different payment instruction.',409)
  await donorAccount(c,String(input.donorId))
  await commit(c,[])
  if(previous.state!=='complete')fail('PAYMENT_PENDING','This payment needs a provider result check. It will not be charged again.',409)
  return {id:previous.id,state:'complete'}
 }
 const reviewed=await reviewStaffPayment(c,input),f=reviewed.facts
 if(input.reviewVersion!==reviewed.reviewVersion)fail('REVIEW_CHANGED','Review the exact amount, designation and authorization before charging.',409)
 const evidence=await authorization(c,f.donorId,f.sourceRef,f.channel),consent=await requireSavedCardConsent(c,f.donorId,f.customerId,f.paymentMethodId,'once')
 const custody=()=>guard(`EXISTS(SELECT 1 FROM cf_donors d JOIN cf_giving_customers gc ON gc.donor_id=d.id WHERE d.id=? AND d.version=? AND gc.customer_id=? AND ${live}) AND (SELECT count(*) FROM cf_giving_customers WHERE donor_id=?)=1 AND NOT EXISTS(SELECT 1 FROM cf_subscriptions WHERE customer_id=? AND donor_id<>?)`,'CUSTOMER_CHANGED','The constituent or saved customer changed. Review this payment.',f.donorId,f.donorVersion,f.customerId,f.donorId,f.customerId,f.donorId)
 const campaignGuard=guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND active=1 AND name=? AND fund=? AND closes_on IS ?)','CAMPAIGN_CHANGED','The campaign changed. Review it before charging.',f.campaign.id,f.campaign.name,f.campaign.fund,f.campaign.closes_on)
 const guards=()=>[custody(),evidence.guard,consent.guard,campaignGuard]
 const id=input.requestId
 await commit(c,[...guards(),guard('NOT EXISTS(SELECT 1 FROM cf_giving_intents WHERE id=?)','REQUEST_CHANGED','This request identity is already in use.',id),guard('NOT EXISTS('+staffChargingPending+')','PAYMENT_PENDING','A previous staff charge needs a provider result check.',f.donorId),
  sql(`INSERT INTO cf_giving_intents(id,campaign_id,name,email,amount_cents,frequency,customer_id,donor_id,created_at,email_consent,requested_amount_cents,fee_cover_cents,staff_actor_id,staff_actor_name,staff_channel,appeal) VALUES(?,?,?,?,?,'once',?,?,?,0,?,0,?,?,?,?)`,id,f.campaign.id,reviewed.donor.name,reviewed.donor.email??'',f.amountCents,f.customerId,f.donorId,c.now,f.amountCents,c.actor.id,c.actor.name,f.channel,f.appeal),
  sql("INSERT INTO cf_portal_changes(id,donor_id,action,state,request,created_at) VALUES(?,?,'staff.payment','pending',?,?)",id,f.donorId,JSON.stringify({input:payload,...f}),c.now),
  event(c,'staffPayment.requested','givingIntent',id,f.donorId,{...f,donorVersion:undefined,campaign:undefined,campaignId:f.campaign.id}),
 ])
 // Provider reads can take time. Recheck the card and every local guard immediately before the charge.
 const charging=await savedMethod(c,f.customerId)
 if(charging.paymentMethodId!==f.paymentMethodId)fail('PAYMENT_METHOD_CHANGED','The saved card changed. This request is held for review.',409)
 await commit(c,guards())
 const payment=await stripe(c.env as GivingEnv,'payment_intents',{amount:f.amountCents,currency:'usd',customer:f.customerId,payment_method:f.paymentMethodId,'payment_method_types[0]':'card',confirm:true,off_session:true,'metadata[coffer_intent]':id},'coffer-staff-payment-'+id)
 if(typeof payment.id!=='string'||!payment.id)fail('PAYMENT_UNCONFIRMED','Stripe did not confirm this charge. The request is held; do not submit another payment.',502)
 await observeStaffPayment(c.env as GivingEnv,payment.id,c)
 const result=await one(c,"SELECT state FROM cf_portal_changes WHERE id=? AND action='staff.payment'",id)
 if(result?.state!=='complete')fail('PAYMENT_UNCONFIRMED','Payment is awaiting a verified result. No automatic retry will occur.',502)
 return {id,state:'complete'}
}

/** Webhook and synchronous completion read current provider facts; neither submits a charge. */
export async function observeStaffPayment(env:GivingEnv,paymentId:string,authority?:Context){
 const p=await stripe(env,'payment_intents/'+encodeURIComponent(paymentId))
 const request=await one({db:env.DB},"SELECT * FROM cf_portal_changes WHERE id=? AND action='staff.payment'",p.metadata?.coffer_intent??'')
 if(!request)return false
 const f=JSON.parse(request.request),intent=await one({db:env.DB},'SELECT i.*,c.fund FROM cf_giving_intents i JOIN cf_campaigns c ON c.id=i.campaign_id WHERE i.id=?',request.id)
 if(!intent||p.id!==paymentId||stripeId(p.customer)!==f.customerId||stripeId(p.payment_method)!==f.paymentMethodId||p.currency!=='usd'||p.amount!==f.amountCents)fail('PAYMENT_MISMATCH','The provider payment does not match the authorized staff instruction.',409)
 if(p.status!=='succeeded'||p.amount_received!==f.amountCents)return true
 const chargeId=stripeId(p.latest_charge)
 if(!chargeId)fail('PAYMENT_UNCONFIRMED','The successful payment needs its charge and actual fee result.',502)
 const charge=await stripe(env,'charges/'+encodeURIComponent(chargeId))
 if(charge.id!==chargeId||stripeId(charge.payment_intent)!==paymentId||stripeId(charge.customer)!==f.customerId||charge.amount!==f.amountCents||charge.currency!=='usd'||!charge.paid||charge.status!=='succeeded'||charge.payment_method_details?.type!=='card')fail('PAYMENT_MISMATCH','Stripe did not verify the authorized card charge.',409)
 const identified=await identify(env,request.id,f.customerId,false,authority)
 if(!identified)return true // An erased identity cannot be revived by a delayed result.
 await recordGift(env,{...identified,fund:f.campaign.fund},paymentId,p.amount_received,charge.created,undefined,authority)
 if(!stripeId(charge.balance_transaction))return true
 await syncEntry(env,stripeId(charge.balance_transaction),authority)
 const statements:Stmt[]=[sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) SELECT ?,? ,?,?,'staffPayment.recorded','givingIntent',?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_events WHERE action='staffPayment.recorded' AND subject_id=?)`,new Date().toISOString(),f.actorId,intent.staff_actor_name,f.actorRole,request.id,identified.donor_id,JSON.stringify({paymentId,amountCents:f.amountCents}),request.id),sql("UPDATE cf_portal_changes SET state='complete',completed_at=? WHERE id=? AND state<>'complete'",new Date().toISOString(),request.id)]
 if(authority)await commit(authority,statements)
 else await env.DB.batch(statements.map(s=>env.DB.prepare(s.sql).bind(...s.params)))
 return true
}

export async function staffPaymentResult(c:Context,id:string):Promise<Row>{
 staff(c)
 const request=await one(c,"SELECT p.id,i.donor_id,p.state,p.created_at,i.amount_cents,i.campaign_id,i.appeal,i.staff_channel,i.staff_actor_name,json_extract(p.request,'$.campaign.name') AS campaign,json_extract(p.request,'$.campaign.fund') AS fund FROM cf_portal_changes p JOIN cf_giving_intents i ON i.id=p.id JOIN cf_campaigns c ON c.id=i.campaign_id JOIN cf_donors d ON d.id=i.donor_id WHERE p.id=? AND p.action='staff.payment' AND d.erased_at IS NULL",id)
 if(!request)fail('NOT_FOUND','That staff payment is not available.',404)
 const gift=await one(c,"SELECT g.* FROM cf_gifts g JOIN cf_giving_intents i ON i.id=? WHERE g.source='stripe' AND g.kind='gift' AND g.reference IN (SELECT json_extract(detail,'$.paymentId') FROM cf_events WHERE action='staffPayment.recorded' AND subject_id=?)",id,id)
 await commit(c,[])
 return {...request,gift}
}
