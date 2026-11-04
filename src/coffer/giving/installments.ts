import { requireRole } from '../auth'
import { all, choice, commit, event, fail, guard, one, sha256, sql, text, type Context, type Row, type Stmt } from '../db'
import { amount } from '../money'
import { donorAccount, savedMethod, authorization, staffPlanCreateState } from './staff-plan-create'
import { requireSavedCardConsent } from './saved-card-consent'
import { recordGift, stripeId } from './recording'
import { stripe, available, type GivingEnv } from './stripe'
import { observeRecovery } from '../agent/recovery'
import { checkCardExpiry } from '../agent/card-expiry'
import { syncEntry } from '../payments/entries'

const staff=(c:Context)=>requireRole(c.actor,['owner','admin'],'manage native recurring plans')
const day=(at:string)=>at.slice(0,10)
const system=(env:GivingEnv,now=new Date().toISOString()):Context=>({db:env.DB,env,now,actor:{id:'native-installments',name:'Coffer installments',role:'agent'},authority:{sql:'1',params:[]}})
/** Preserve the original day across short months; resumption always skips debt. */
function futureDue(after:string,anchor:number) {
 const at=new Date(after+'T00:00:00Z')
 for(let offset=0;offset<2;offset++){
  const month=at.getUTCMonth()+offset,year=at.getUTCFullYear(),last=new Date(Date.UTC(year,month+1,0)).getUTCDate()
  const candidate=new Date(Date.UTC(year,month,Math.min(anchor,last))).toISOString().slice(0,10)
  if(candidate>after)return candidate
 }
 throw Error('No future monthly boundary')
}
export async function nativePlans(c:Context){
 staff(c)
 return all(c,`SELECT n.*,s.status,s.amount_cents,d.name AS donor_name,a.approved_at FROM cf_native_plans n JOIN cf_subscriptions s ON s.id=n.id JOIN cf_donors d ON d.id=n.donor_id LEFT JOIN cf_native_plan_approvals a ON a.plan_id=n.id AND a.plan_version=n.version WHERE d.erased_at IS NULL ORDER BY n.created_at DESC,n.id`)
}
export async function nativePlan(c:Context,id:string){
 staff(c)
 const plan=await one(c,`SELECT n.*,s.status,s.amount_cents,d.name AS donor_name FROM cf_native_plans n JOIN cf_subscriptions s ON s.id=n.id JOIN cf_donors d ON d.id=n.donor_id WHERE n.id=? AND d.erased_at IS NULL`,id)
 if(!plan)fail('NOT_FOUND','That native plan is unavailable.',404)
 const [installments,history,approval]=await Promise.all([all(c,'SELECT * FROM cf_native_installments WHERE plan_id=? ORDER BY due_on,id',id),all(c,"SELECT * FROM cf_events WHERE subject_id=? AND action LIKE 'installmentPlan.%' ORDER BY id",id),one(c,'SELECT * FROM cf_native_plan_approvals WHERE plan_id=? AND plan_version=?',id,plan.version)])
 await commit(c,[])
 return {plan,installments,history,approval}
}
export const nativeCreateState=staffPlanCreateState

export async function createNativePlan(c:Context,p:Row){
 staff(c)
 if(p.confirm!=='yes'||p.frequency!=='monthly')fail('CONFIRMATION_REQUIRED','Confirm a fixed USD monthly schedule and immediate first charge.',400)
 const donorId=text(p.donorId,'Constituent',100),{donor,customerId}=await donorAccount(c,donorId),method=await savedMethod(c,customerId)
 const consent=await requireSavedCardConsent(c,donorId,customerId,method.paymentMethodId)
 const reviewed=await staffPlanCreateState(c,donorId)
 if(p.version!==reviewed.version||p.customerId!==customerId||p.paymentMethodId!==method.paymentMethodId)fail('PAYMENT_METHOD_CHANGED','Review the current donor and saved card.',409)
 const channel=choice(p.givingChannel,['phone','mail'] as const,'authorization channel'),sourceRef=text(p.sourceRef,'Recorded authorization',220),evidence=await authorization(c,donorId,sourceRef,channel)
 const cents=amount(p,'amount','Monthly amount'),requestId=text(p.requestId,'Request identity',64)
 if(!/^[a-f0-9-]{36}$/.test(requestId)||cents<100||cents>10000000)fail('INPUT','Reload the form and enter an amount between $1 and $100,000.',400)
 const campaign=await one(c,'SELECT * FROM cf_campaigns WHERE id=? AND active=1',p.campaignId)
 if(!campaign)fail('CAMPAIGN_UNAVAILABLE','Choose an active campaign.',409)
 const id='native-'+requestId,payload=await sha256(JSON.stringify({donorId,customerId,...method,consent:consent.id,sourceRef,sourceHash:evidence.snapshot,channel,cents,campaignId:campaign.id}))
 const prior=await one(c,'SELECT detail FROM cf_events WHERE subject_id=? AND action=?',id,'installmentPlan.create')
 if(prior){if(JSON.parse(prior.detail).payload!==payload)fail('REQUEST_CHANGED','That request names a different schedule.',409);await commit(c,[]);return {id}}
 await commit(c,[evidence.guard,consent.guard,
  guard("EXISTS(SELECT 1 FROM cf_donors d JOIN cf_giving_customers g ON g.donor_id=d.id WHERE d.id=? AND d.version=? AND d.erased_at IS NULL AND d.constituent_status='active' AND g.customer_id=? AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))",'DONOR_CHANGED','Review the current constituent.',donorId,donor.version,customerId),
  sql(`INSERT INTO cf_giving_intents(id,campaign_id,name,email,amount_cents,frequency,customer_id,donor_id,created_at,email_consent,requested_amount_cents,fee_cover_cents,billing_frequency,staff_actor_id,staff_actor_name,staff_channel,native_plan_id) VALUES(?,?,?,?,?,'monthly',?,?,?,0,?,0,'monthly',?,?,?,?)`,requestId,campaign.id,donor.name,donor.email??'',cents,customerId,donorId,c.now,cents,c.actor.id,c.actor.name,channel,id),
  sql("INSERT INTO cf_subscriptions(id,donor_id,campaign_id,customer_id,amount_cents,status,updated_at) VALUES(?,?,?,?,?,'paused',?)",id,donorId,campaign.id,customerId,cents,c.now),
  sql('INSERT INTO cf_native_plans VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?)',id,requestId,donorId,donor.version,customerId,method.paymentMethodId,consent.id,sourceRef,evidence.snapshot,Number(day(c.now).slice(8)),day(c.now),c.now),
  sql("INSERT INTO cf_portal_subscription_settings VALUES(?,'month',1,1,?)",id,c.now),
  sql('UPDATE cf_subscription_lifetimes SET start_known=1 WHERE subscription_id=?',id),
  event(c,'installmentPlan.create','subscription',id,donorId,{payload,amountCents:cents,sourceRef,channel})])
 return {id}
}
/** The approval is version-bound and never restored with portable history. */
async function chargingChecks(c:Context,p:Row,claimId=''):Promise<Stmt[]>{
 const method=await savedMethod(c,p.customer_id),consent=await requireSavedCardConsent(c,p.donor_id,p.customer_id,p.payment_method_id)
 const intent=await one(c,'SELECT staff_channel FROM cf_giving_intents WHERE id=?',p.intent_id)
 const evidence=await authorization(c,p.donor_id,p.source_ref,intent!.staff_channel)
 if(method.paymentMethodId!==p.payment_method_id||consent.id!==p.consent_id||evidence.snapshot!==p.source_hash)fail('AUTHORIZATION_CHANGED','The current card, permission or recorded authorization changed. No payment submitted.',409)
 return [consent.guard,evidence.guard,
  guard("NOT EXISTS(SELECT 1 FROM cf_native_installments i JOIN cf_subscriptions s ON s.id=i.plan_id WHERE s.donor_id=? AND i.state<>'paid' AND i.id<>?) AND NOT EXISTS(SELECT 1 FROM cf_portal_changes WHERE donor_id=? AND action='staff.create' AND state IN ('pending','uncertain'))",'PAYMENT_HELD','A prior submission for this donor needs investigation before any further debit.',p.donor_id,claimId,p.donor_id),
  guard(`EXISTS(SELECT 1 FROM cf_native_plans n JOIN cf_subscriptions s ON s.id=n.id JOIN cf_donors d ON d.id=n.donor_id JOIN cf_giving_customers g ON g.donor_id=d.id WHERE n.id=? AND n.version=? AND s.donor_id=n.donor_id AND s.customer_id=n.customer_id AND d.version=n.donor_version AND d.erased_at IS NULL AND d.constituent_status='active' AND g.customer_id=n.customer_id AND NOT EXISTS(SELECT 1 FROM cf_subscriptions other WHERE other.customer_id=n.customer_id AND other.donor_id<>n.donor_id) AND (SELECT count(*) FROM cf_giving_customers WHERE donor_id=d.id)=1 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`,'DONOR_CHANGED','The approved donor or saved customer changed.',p.id,p.version)]
}
const approvalSql=`EXISTS(SELECT 1 FROM cf_native_plan_approvals a JOIN cf_native_plans n ON n.id=a.plan_id JOIN oa_operators o ON o.id=a.approved_by WHERE n.id=? AND n.version=a.plan_version AND o.version=a.approver_version AND o.status='active' AND o.role IN ('owner','admin') AND COALESCE((SELECT read_only FROM cf_team_access WHERE operator_id=o.id),0)=0)`
export async function changeNativePlan(c:Context,id:string,input:Row){
 staff(c)
 const {plan:p}=await nativePlan(c,id),action=choice(input.action,['approve','pause','resume','cancel','reconcile'] as const,'plan action')
 if(action==='reconcile')return reconcileNativePlan(c,id,input.paymentIntentId)
 if(input.confirm!=='yes'||Number(input.version)!==p.version)fail('VERSION','Confirm the current plan version.',409)
 if(p.status==='canceled')fail('PLAN_STOPPED','Canceled plans cannot resume.',409)
 const unresolved=await one(c,"SELECT i.id FROM cf_native_installments i JOIN cf_subscriptions s ON s.id=i.plan_id WHERE s.donor_id=? AND i.state<>'paid'",p.donor_id)
 if(['approve','resume'].includes(action)&&unresolved)fail('PAYMENT_HELD','Reconcile this held installment. No new debit or automatic retry is permitted.',409)
 const checks=['approve','resume'].includes(action)?await chargingChecks(c,p):[]
 if(action==='approve'&&await one(c,'SELECT plan_id FROM cf_native_plan_approvals WHERE plan_id=?',id))fail('APPROVED','This plan is already approved.',409)
 if(action==='resume'&&p.status!=='paused')fail('PLAN_STATE','Only a paused plan can resume.',409)
 const version=p.version+1,active=action==='approve'||action==='resume'
 const owner=await one(c,"SELECT version FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')",c.actor.id)
 const due=action==='resume'?futureDue(day(c.now),p.anchor_day):action==='approve'?day(c.now):p.next_due_on
 // The confirmed immediate first charge starts the monthly schedule.
 const anchor=action==='approve'?Number(due.slice(8)):p.anchor_day
 await commit(c,[...(active?checks:[]),guard('EXISTS(SELECT 1 FROM cf_native_plans WHERE id=? AND version=?)','VERSION','The plan changed.',id,p.version),
  sql('UPDATE cf_native_plans SET version=?,next_due_on=?,anchor_day=? WHERE id=?',version,due,anchor,id),
  sql('DELETE FROM cf_native_plan_approvals WHERE plan_id=?',id),
  ...(active?[sql('INSERT INTO cf_native_plan_approvals VALUES(?,?,?,?,?)',id,version,c.actor.id,owner!.version,c.now)]:[]),
  sql("UPDATE cf_portal_subscription_settings SET collection_paused=?,observed_at=? WHERE subscription_id=?",active?0:1,c.now,id),
  sql('UPDATE cf_subscriptions SET status=?,updated_at=? WHERE id=?',active?'active':action==='cancel'?'canceled':'paused',c.now,id),
  event(c,'installmentPlan.'+action,'subscription',id,p.donor_id,{version,nextDueOn:due,sourceRef:p.source_ref})])
 if(action==='approve')await runNativeInstallments(c.env as GivingEnv,new Date(c.now),id)
 return {id}
}
async function hold(env:GivingEnv,p:Row,claim:Row,state:string,now:string){
 await env.DB.batch([
  env.DB.prepare("UPDATE cf_native_installments SET state=?,checked_at=? WHERE id=? AND state<>'paid'").bind(state,now,claim.id),
  env.DB.prepare("INSERT OR IGNORE INTO cf_recurring_payment_health(invoice_id,subscription_id,failed_at) SELECT ?,?,? WHERE ?<>'blocked'").bind(claim.id,p.id,now,state),
  env.DB.prepare("UPDATE cf_subscriptions SET status=CASE WHEN status IN ('paused','canceled') THEN status ELSE 'past_due' END,failed_attempts=MAX(failed_attempts,1),updated_at=? WHERE id=?").bind(now,p.id)])
 const c=system(env,now)
 // One owned, non-ask follow-up; the scheduler never retries the debit.
 const owner=`COALESCE((SELECT o.id FROM cf_portfolio_members m JOIN cf_portfolios f ON f.id=m.portfolio_id JOIN oa_operators o ON o.id=f.manager_id WHERE m.donor_id=? AND o.status='active'),(SELECT id FROM oa_operators WHERE role='owner' AND status='active' ORDER BY id LIMIT 1))`
 await commit(c,[sql(`INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask) SELECT ?,?,?,'recovery','Native installment held; investigate without another debit.',?,${owner},?,?,0 WHERE EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`, 'native-task-'+claim.id,p.donor_id,'recovery:'+claim.id,p.amount_cents,p.donor_id,day(now),now,p.donor_id)])
 if(state!=='blocked')await observeRecovery(env,{id:claim.id,status:'open',amount_paid:0,attempt_count:1,next_payment_attempt:null},{id:p.id,status:'past_due'},{donor_id:p.donor_id,amount_cents:p.amount_cents},undefined,now)
}
export async function runNativeInstallments(env:GivingEnv,at=new Date(),only?:string){
 if(!available(env))return
 const now=at.toISOString(),c=system(env,now),plans=await all(c,`SELECT n.*,s.amount_cents FROM cf_native_plans n JOIN cf_subscriptions s ON s.id=n.id JOIN cf_native_plan_approvals a ON a.plan_id=n.id AND a.plan_version=n.version WHERE s.status='active' AND n.next_due_on<=? ${only?'AND n.id=?':''}`,day(now),...(only?[only]:[]))
 for(const p of plans){
  const claimId=p.id+':'+p.next_due_on
  let claimed=false,submitted=false
  try{
   const checks=await chargingChecks(c,p)
   await commit(c,[...checks,guard(approvalSql,'APPROVAL_CHANGED','Current owner or admin approval is required.',p.id),
    sql(`INSERT OR IGNORE INTO cf_native_installments(id,plan_id,plan_version,due_on,state,created_at,checked_at) SELECT ?,?,?,?,'claimed',?,? WHERE EXISTS(SELECT 1 FROM cf_subscriptions WHERE id=? AND status='active') AND EXISTS(SELECT 1 FROM cf_native_plans WHERE id=? AND version=? AND next_due_on=?) AND NOT EXISTS(SELECT 1 FROM cf_native_installments WHERE plan_id=? AND state<>'paid')`,claimId,p.id,p.version,p.next_due_on,now,now,p.id,p.id,p.version,p.next_due_on,p.id)])
   // Exactly one Worker may move the claim across the submission boundary.
   const moved=await env.DB.prepare("UPDATE cf_native_installments SET state='submitting' WHERE id=? AND state='claimed' RETURNING id").bind(claimId).all()
   if(!moved.results.length)continue
   claimed=true
   const finalChecks=await chargingChecks(c,p,claimId)
   await commit(c,[...finalChecks,guard(approvalSql,'APPROVAL_CHANGED','Approver authority changed before submission.',p.id),guard("EXISTS(SELECT 1 FROM cf_subscriptions s JOIN cf_native_plans n ON n.id=s.id WHERE s.id=? AND s.status='active' AND n.version=?)",'PLAN_CHANGED','Plan stopped before submission.',p.id,p.version)])
   submitted=true
   const payment=await stripe(env,'payment_intents',{amount:p.amount_cents,currency:'usd',customer:p.customer_id,payment_method:p.payment_method_id,'payment_method_types[0]':'card',off_session:true,confirm:true,'metadata[coffer_installment]':claimId,'metadata[coffer_intent]':p.intent_id},'coffer-installment-'+claimId)
   if(typeof payment.id!=='string'||!payment.id)fail('PAYMENT_UNCERTAIN','Stripe did not identify this payment.',502)
   await env.DB.prepare('UPDATE cf_native_installments SET payment_intent_id=? WHERE id=? AND payment_intent_id IS NULL').bind(payment.id,claimId).run()
   await reconcileNativePayment(env,payment.id,undefined,now)
  }catch{
   if(claimed)await hold(env,p,{id:claimId},submitted?'uncertain':'blocked',now)
   else{
    await env.DB.prepare("INSERT OR IGNORE INTO cf_native_installments(id,plan_id,plan_version,due_on,state,created_at,checked_at) SELECT ?,?,?,?,'blocked',?,? WHERE EXISTS(SELECT 1 FROM cf_subscriptions s JOIN cf_native_plans n ON n.id=s.id WHERE s.id=? AND s.status='active' AND n.version=? AND n.next_due_on=?)").bind(claimId,p.id,p.version,p.next_due_on,now,now,p.id,p.version,p.next_due_on).run()
    if(await one(c,"SELECT id FROM cf_native_installments WHERE id=? AND state='blocked'",claimId))await hold(env,p,{id:claimId},'blocked',now)
   }
  }
 }
}
/** Read-only reconciliation. Event order cannot authorize a second submission. */
export async function reconcileNativePayment(env:GivingEnv,paymentId:string,suppliedCharge?:Row,at?:string):Promise<Row|null>{
 const payment=await stripe(env,'payment_intents/'+encodeURIComponent(paymentId)),id=payment.metadata?.coffer_installment
 if(typeof id!=='string')return null
 const c=system(env,at),claim=await one(c,'SELECT * FROM cf_native_installments WHERE id=?',id)
 if(!claim)fail('PAYMENT_MISMATCH','No durable installment claim matches this payment.',409)
 const p=await one(c,'SELECT n.*,s.amount_cents FROM cf_native_plans n JOIN cf_subscriptions s ON s.id=n.id WHERE n.id=?',claim.plan_id)
 if(p&&(!p.customer_id||!p.payment_method_id||!await one(c,"SELECT id FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)",p.donor_id)))return {state:'identity-held'}
 if(!p||payment.id!==paymentId||payment.metadata?.coffer_intent!==p.intent_id||stripeId(payment.customer)!==p.customer_id||stripeId(payment.payment_method)!==p.payment_method_id||payment.currency!=='usd'||payment.amount!==p.amount_cents||claim.payment_intent_id&&claim.payment_intent_id!==paymentId)fail('PAYMENT_MISMATCH','The provider payment differs from this installment.',409)
 await env.DB.prepare('UPDATE cf_native_installments SET payment_intent_id=COALESCE(payment_intent_id,?),checked_at=? WHERE id=?').bind(paymentId,c.now,id).run()
 if(payment.status!=='succeeded'){
  await hold(env,p,claim,['requires_payment_method','canceled'].includes(payment.status)?'failed':'uncertain',c.now)
  return {state:payment.status}
 }
 const chargeId=stripeId(payment.latest_charge),charge:Row=suppliedCharge??await stripe<Row>(env,'charges/'+encodeURIComponent(chargeId))
 if(payment.amount_received!==p.amount_cents||charge.id!==chargeId||stripeId(charge.payment_intent)!==paymentId||stripeId(charge.customer)!==p.customer_id||stripeId(charge.payment_method)!==p.payment_method_id||charge.status!=='succeeded'||!charge.paid||charge.amount!==p.amount_cents||charge.currency!=='usd'||!charge.balance_transaction)fail('PAYMENT_MISMATCH','The installment has no independently verified successful charge.',409)
 const txn=await stripe(env,'balance_transactions/'+encodeURIComponent(stripeId(charge.balance_transaction)))
 if(txn.id!==stripeId(charge.balance_transaction)||stripeId(txn.source)!==charge.id||txn.currency!=='usd'||txn.type!=='charge'||txn.amount!==p.amount_cents||!Number.isSafeInteger(txn.fee)||txn.fee<0||txn.net!==txn.amount-txn.fee)fail('PAYMENT_MISMATCH','Actual fees and paid funds do not reconcile.',409)
 // Never follow a merge into a new billing identity or revive erased personal data.
 const donor=await one(c,"SELECT id FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)",p.donor_id)
 if(!donor)return {state:'identity-held'}
 const intent=await one(c,'SELECT i.*,c.fund FROM cf_giving_intents i JOIN cf_campaigns c ON c.id=i.campaign_id WHERE i.id=?',p.intent_id)
 const giftId=await recordGift(env,intent!,paymentId,p.amount_cents,charge.created,p.id)
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO cf_stripe_charges VALUES(?,?,0,?)').bind(charge.id,giftId,c.now),
  env.DB.prepare("UPDATE cf_native_installments SET state='paid',gift_id=?,checked_at=? WHERE id=?").bind(giftId,c.now,id),
  env.DB.prepare('UPDATE cf_native_plans SET next_due_on=? WHERE id=? AND next_due_on=?').bind(futureDue(day(c.now),p.anchor_day),p.id,claim.due_on),
  env.DB.prepare("UPDATE cf_subscriptions SET status=CASE WHEN status='past_due' AND NOT EXISTS(SELECT 1 FROM cf_native_installments WHERE plan_id=? AND state<>'paid') THEN 'active' ELSE status END,recovered=CASE WHEN EXISTS(SELECT 1 FROM cf_recurring_payment_health WHERE invoice_id=?) THEN 1 ELSE recovered END,updated_at=? WHERE id=?").bind(p.id,claim.id,c.now,p.id)])
 await env.DB.prepare('UPDATE cf_recurring_payment_health SET recovered_at=COALESCE(recovered_at,?) WHERE invoice_id=?').bind(new Date(charge.created*1000).toISOString(),claim.id).run()
 await syncEntry(env,txn)
 await observeRecovery(env,{id:claim.id,status:'paid',amount_paid:p.amount_cents,attempt_count:1,status_transitions:{paid_at:charge.created}},{id:p.id,status:'active'},{donor_id:p.donor_id,amount_cents:p.amount_cents},undefined,c.now)
 return {state:'paid',giftId}
}
export async function reconcileNativePlan(c:Context,id:string,paymentId?:unknown){
 staff(c)
 const {installments}=await nativePlan(c,id)
 if(paymentId){
  const payment=await stripe(c.env as GivingEnv,'payment_intents/'+encodeURIComponent(text(paymentId,'Payment identity',100)))
  if(!installments.some(i=>i.id===payment.metadata?.coffer_installment))fail('PAYMENT_MISMATCH','That payment belongs to another plan.',409)
  await commit(c,[])
  await reconcileNativePayment(c.env as GivingEnv,String(paymentId))
 }else for(const claim of installments)if(claim.payment_intent_id){await commit(c,[]);await reconcileNativePayment(c.env as GivingEnv,claim.payment_intent_id)}
 return {id}
}
export async function reconcileNativeRecovery(c:Context,env:GivingEnv,id:string){
 const p=await one(c,'SELECT s.*,n.payment_method_id FROM cf_subscriptions s JOIN cf_native_plans n ON n.id=s.id WHERE s.id=?',id)
 if(!p)return false
 for(const claim of await all(c,'SELECT payment_intent_id FROM cf_native_installments WHERE plan_id=? AND payment_intent_id IS NOT NULL',id)){
  await commit(c,[]);await reconcileNativePayment(env,claim.payment_intent_id,undefined,c.now)
 }
 await checkCardExpiry(c,env,{id,customer:p.customer_id,status:p.status,default_payment_method:null})
 return true
}
