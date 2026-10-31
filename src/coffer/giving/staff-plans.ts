import { holdMembershipPrice } from '../memberships/service'
import { requireRole } from '../auth'
import { all, choice, commit, date, event, fail, guard, one, sql, text, type Context, type Row } from '../db'
import { amount } from '../money'
import { planFacts, planQuery, planVersion, validatePlan } from './portal-plans'
import { stripe, type GivingEnv, type StripeParams } from './stripe'

const staff=(c:Context)=>requireRole(c.actor,['owner','admin'],'manage recurring plans')
const live=`d.erased_at IS NULL AND d.constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`
const sourceCondition=`EXISTS(SELECT 1 FROM cf_interactions WHERE id=? AND donor_id=?) OR EXISTS(SELECT 1 FROM cf_record_documents WHERE id=? AND donor_id=?)`
const providerFacts=(s:Row)=>({...planFacts(s),nextBillingAt:(s.status==='trialing'?s.trial_end:null)??s.items.data[0].current_period_end??s.current_period_end??null,billingAnchor:s.billing_cycle_anchor??null,cancelAt:s.cancel_at??null,pauseBehavior:s.pause_collection?.behavior??null,pauseResumesAt:s.pause_collection?.resumes_at??null})

export async function staffPlans(c:Context){
 staff(c)
 const rows=await all(c,`${planQuery} JOIN cf_donors d ON d.id=s.donor_id WHERE ${live} AND NOT EXISTS(SELECT 1 FROM cf_native_plans n WHERE n.id=s.id) ORDER BY s.updated_at DESC,s.id`)
 await commit(c,[])
 return rows
}
async function adoptedPlan(c:Context,id:string){
 staff(c)
 const own=await one(c,`${planQuery} JOIN cf_donors d ON d.id=s.donor_id WHERE s.id=? AND ${live} AND NOT EXISTS(SELECT 1 FROM cf_native_plans n WHERE n.id=s.id)`,id)
 if(!own)fail('NOT_FOUND','Choose an adopted Stripe plan on a current constituent.',404)
 if(await one(c,'SELECT 1 FROM cf_subscriptions WHERE customer_id=? AND donor_id<>? UNION ALL SELECT 1 FROM cf_giving_customers WHERE customer_id=? AND donor_id<>?',own.customer_id,own.donor_id,own.customer_id,own.donor_id))fail('CUSTOMER_AMBIGUOUS','Separate the shared Stripe customer before changing this plan.',409)
 return own
}
export async function staffPlanState(c:Context,id:string){
 const own=await adoptedPlan(c,id),current=await stripe(c.env as GivingEnv,'subscriptions/'+encodeURIComponent(own.id))
 validatePlan(current,own)
 const facts=providerFacts(current)
 const [sources,history,gifts]=await Promise.all([
  all(c,`SELECT 'interaction:'||id AS reference,kind||' · '||occurred_on AS label FROM cf_interactions WHERE donor_id=? UNION ALL SELECT 'document:'||id,title FROM cf_record_documents WHERE donor_id=?`,own.donor_id,own.donor_id),
  all(c,`SELECT at,actor_name,actor_role,action,detail FROM cf_events WHERE subject_kind='subscription' AND subject_id=? AND donor_id=? ORDER BY at DESC,id DESC LIMIT 100`,own.id,own.donor_id),
  all(c,'SELECT g.id,g.received_on,g.amount_cents FROM cf_subscription_gifts l JOIN cf_gifts g ON g.id=l.gift_id WHERE l.subscription_id=? AND g.donor_id=? ORDER BY g.received_on DESC,g.id LIMIT 100',own.id,own.donor_id),
 ])
 const pending=await one(c,"SELECT id,state,created_at FROM cf_portal_changes WHERE subscription_id=? AND state IN ('pending','uncertain') ORDER BY created_at LIMIT 1",own.id)
 await commit(c,[])
 return {plan:own,facts,version:await planVersion(facts),sources,history,gifts,pending}
}

/** Staff and portal changes share the subscription's durable financial claim.
 * Provider uncertainty keeps that claim closed until its result is reviewed. */
export async function changeStaffPlan(c:Context,id:string,input:Row){
 const own=await adoptedPlan(c,id),action=choice(input.action,['amount','date','pause','resume','cancel'] as const,'plan change')
 if(input.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm this specific plan change and its authorization evidence.',400)
 const requestId=text(input.requestId,'Request ID',64)
 if(!/^[a-f0-9-]{36,64}$/.test(requestId))fail('INPUT','Reload the recurring plan form.',400)
 const reference=text(input.sourceRef,'Authorization evidence',220),[sourceType,sourceId,...extra]=reference.split(':')
 if(extra.length||!sourceId||!['interaction','document'].includes(sourceType))fail('INPUT','Choose recorded authorization evidence on this constituent.',400)
 const reason=text(input.reason,'Reason for this change',1000)
 const evidenceParams=[sourceType==='interaction'?sourceId:'',own.donor_id,sourceType==='document'?sourceId:'',own.donor_id]
 if(!await one(c,`SELECT 1 WHERE ${sourceCondition}`,...evidenceParams))fail('EVIDENCE_CHANGED','Choose authorization evidence on this constituent.',409)
 if(action==='amount')await holdMembershipPrice(c,id)
 const desired:Row=action==='amount'?{amountCents:amount(input,'amount','Plan amount')}:action==='date'?{nextBillingOn:date(input.nextBillingOn,'Next billing date')}:{},version=text(input.version,'Plan version',64)
 const payload=JSON.stringify({actorId:c.actor.id,action,sourceRef:reference,reason,version,...desired})
 const previous=await one(c,'SELECT * FROM cf_portal_changes WHERE id=?',requestId)
 if(previous){
  if(previous.donor_id!==own.donor_id||previous.subscription_id!==own.id||previous.request!==payload)fail('REQUEST_CHANGED','This request ID belongs to a different plan change.',409)
  if(previous.state==='complete'){await commit(c,[]);return {id:own.id,requestId,state:'complete'}}
  fail('CHANGE_PENDING','This request needs a Stripe result check before another change.',409)
 }
 const current=await stripe(c.env as GivingEnv,'subscriptions/'+encodeURIComponent(own.id));validatePlan(current,own)
 const before=providerFacts(current)
 if(version!==await planVersion(before))fail('PLAN_CHANGED','The Stripe plan changed. Reload before confirming.',409)
 if(['canceled','incomplete_expired','paused'].includes(current.status)||current.cancel_at_period_end||current.cancel_at)fail('PLAN_ENDING','This plan has ended, is ending, or needs Stripe review.',409)
 if(current.collection_method!=='charge_automatically')fail('PLAN_REVIEW','This plan is not collected automatically. Review it at Stripe.',409)
 if(action==='pause'&&before.paused||action==='resume'&&!before.paused)fail('PLAN_CHANGED','Collection status changed. Reload before confirming.',409)
 if(action==='resume'&&before.pauseBehavior!=='void')fail('PLAN_REVIEW','Review invoices held by this pause at Stripe before resuming.',409)
 const params:Record<string,string|number|boolean>={proration_behavior:'none',payment_behavior:'error_if_incomplete'}
 if(action==='cancel')params.cancel_at_period_end=true
 else if(action==='pause')params['pause_collection[behavior]']='void'
 else if(action==='resume')params.pause_collection=''
 else if(action==='amount')Object.assign(params,{'items[0][id]':before.itemId,'items[0][quantity]':1,'items[0][price_data][currency]':'usd','items[0][price_data][product]':before.product,'items[0][price_data][unit_amount]':desired.amountCents,'items[0][price_data][recurring][interval]':before.interval,'items[0][price_data][recurring][interval_count]':before.intervalCount})
 else{
  const seconds=Date.parse(desired.nextBillingOn+'T00:00:00Z')/1000,now=Date.parse(c.now)/1000
  if(seconds<=now||seconds>now+730*86400)fail('INPUT','Choose a future UTC billing date within two years.',400)
  if(before.nextBillingAt&&seconds<before.nextBillingAt)fail('INPUT','Choose the current billing boundary or a later date; bringing a paid cycle forward needs separate review.',400)
  if(!['active','trialing'].includes(current.status)||before.paused||current.billing_mode?.type==='flexible')fail('PLAN_REVIEW','Date changes require an active, unpaused plan with a classic billing cycle.',409)
  // Stripe documents adding a trial to move an existing billing cycle, with
  // no prorations: https://docs.stripe.com/billing/subscriptions/billing-cycle
  params.trial_end=seconds
 }
 const custody=guard(`EXISTS(SELECT 1 FROM cf_subscriptions s JOIN cf_donors d ON d.id=s.donor_id LEFT JOIN cf_portal_subscription_settings p ON p.subscription_id=s.id WHERE s.id=? AND s.donor_id=? AND s.customer_id=? AND s.updated_at=? AND s.amount_cents=? AND s.cancel_at_period_end=? AND p.observed_at IS ? AND ${live})`,'PLAN_CHANGED','This plan changed. Reload before confirming.',own.id,own.donor_id,own.customer_id,own.updated_at,own.amount_cents,own.cancel_at_period_end,own.schedule_observed_at??null)
 await commit(c,[custody,guard(`(${sourceCondition})`,'EVIDENCE_CHANGED','Authorization evidence changed.',...evidenceParams),guard("NOT EXISTS(SELECT 1 FROM cf_portal_changes WHERE subscription_id=? AND state IN ('pending','uncertain'))",'CHANGE_PENDING','A previous change needs a Stripe result check.',own.id),sql("INSERT INTO cf_portal_changes(id,donor_id,subscription_id,action,state,request,created_at) VALUES(?,?,?,?,'pending',?,?)",requestId,own.donor_id,own.id,'staff.'+action,payload,c.now),event(c,'staffPlan.changeRequested','subscription',own.id,own.donor_id,{requestId,action,sourceRef:reference,before,...desired})])
 const changed=await stripe(c.env as GivingEnv,'subscriptions/'+encodeURIComponent(own.id),params as StripeParams,'coffer-staff-plan-'+requestId);validatePlan(changed,own)
 const after=providerFacts(changed)
 if(action==='cancel'&&!changed.cancel_at_period_end||action==='pause'&&!after.paused||action==='resume'&&after.paused||action==='amount'&&after.amountCents!==desired.amountCents||action==='date'&&(changed.trial_end!==params.trial_end||changed.billing_cycle_anchor!==params.trial_end))fail('STRIPE_UNCONFIRMED','Stripe did not confirm the requested change. Review the pending request before another change.',502)
 if(after.interval!==before.interval||after.intervalCount!==before.intervalCount||after.product!==before.product)fail('STRIPE_UNCONFIRMED','Stripe returned a changed billing schedule. Review the pending request.',502)
 const completed=new Date().toISOString()
 await commit(c,[guard(`EXISTS(SELECT 1 FROM cf_subscriptions s JOIN cf_donors d ON d.id=s.donor_id WHERE s.id=? AND s.donor_id=? AND s.customer_id=? AND ${live})`,'PLAN_CHANGED','Stripe changed the plan; constituent custody now needs review.',own.id,own.donor_id,own.customer_id),sql('UPDATE cf_subscriptions SET status=?,cancel_at_period_end=?,amount_cents=?,updated_at=? WHERE id=? AND donor_id=?',changed.status,Number(changed.cancel_at_period_end),after.amountCents,completed,own.id,own.donor_id),sql('INSERT INTO cf_portal_subscription_settings(subscription_id,interval,interval_count,collection_paused,observed_at) VALUES(?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET interval=excluded.interval,interval_count=excluded.interval_count,collection_paused=excluded.collection_paused,observed_at=excluded.observed_at',own.id,after.interval,after.intervalCount,Number(after.paused),completed),sql("UPDATE cf_portal_changes SET state='complete',completed_at=? WHERE id=? AND state='pending'",completed,requestId),event({...c,now:completed},'staffPlan.'+action,'subscription',own.id,own.donor_id,{requestId,sourceRef:reference,before,after,...desired})])
 return {id:own.id,requestId,state:'complete'}
}
