import { all, choice, commit, event, fail, guard, one, sha256, sql, today, type Row } from '../db'
import { amount } from '../money'
import { settings } from '../settings'
import { box, e, field, hidden, money, select } from '../ui/common'
import { portalContext, type PortalDonor } from './portal-identity'
import { portalPage } from './portal-ui'
import { stripe, type GivingEnv, type StripeParams } from './stripe'

export const planQuery=`SELECT s.*,c.name AS campaign_name,p.interval,p.interval_count,p.collection_paused,p.observed_at AS schedule_observed_at FROM cf_subscriptions s JOIN cf_campaigns c ON c.id=s.campaign_id LEFT JOIN cf_portal_subscription_settings p ON p.subscription_id=s.id`
export async function ownPlan(env:GivingEnv,donor:PortalDonor,id:string){
 const c=await portalContext(env,donor),own=await one(c,planQuery+' WHERE s.id=? AND s.donor_id=?',id,donor.id)
 if(!own)fail('not_found','That recurring gift is not on your account.',404)
 if(await one(c,'SELECT 1 FROM cf_subscriptions WHERE customer_id=? AND donor_id<>? UNION ALL SELECT 1 FROM cf_giving_customers WHERE customer_id=? AND donor_id<>?',own.customer_id,donor.id,own.customer_id,donor.id))fail('portal_customer_ambiguous','The organization needs to separate this payment account before you can update it.',403)
 return {c,own}
}
export function validatePlan(value:Row,own:Row){
 const customer=typeof value.customer==='string'?value.customer:value.customer?.id
 if(value.id!==own.id||customer!==own.customer_id)fail('subscription_changed','This recurring gift could not be verified. Contact the organization.',409)
 if(!['active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'].includes(value.status)||typeof value.cancel_at_period_end!=='boolean')fail('stripe_error','Stripe returned an unreadable subscription.',502)
}
function planFacts(value:Row){
 const items=value.items?.data
 if(!Array.isArray(items)||items.length!==1||!items[0].id||items[0].quantity!==1)fail('plan_review','This plan needs the organization’s review before changing its schedule.',409)
 const item=items[0],price=item.price,product=typeof price?.product==='string'?price.product:price?.product?.id
 if(price?.currency!=='usd'||!Number.isSafeInteger(price.unit_amount)||price.unit_amount<=0||!product||!['week','month','year'].includes(price.recurring?.interval)||!Number.isSafeInteger(price.recurring?.interval_count)||price.recurring.interval_count<=0)fail('plan_review','This plan needs the organization’s review before changing its schedule.',409)
 if(value.schedule||value.pending_update||value.discount||(value.discounts!=null&&(!Array.isArray(value.discounts)||value.discounts.length>0))||value.automatic_tax?.enabled||value.default_tax_rates?.length||item.discounts?.length||item.tax_rates?.length||price.recurring.usage_type==='metered'||price.billing_scheme==='tiered')fail('plan_review','This plan has additional billing rules. Contact the organization before changing it.',409)
 return {itemId:item.id,product,amountCents:price.unit_amount,interval:price.recurring.interval,intervalCount:price.recurring.interval_count,paused:!!value.pause_collection,status:value.status,cancelled:value.cancel_at_period_end}
}
const frequencies=[['weekly','Weekly'],['monthly','Monthly'],['quarterly','Every three months'],['annually','Annually']] as [string,string][]
const schedule=(frequency:string)=>({weekly:['week',1],monthly:['month',1],quarterly:['month',3],annually:['year',1]}[frequency]!)
const frequency=(f:Row)=>f.interval==='week'&&f.intervalCount===1?'weekly':f.interval==='month'&&f.intervalCount===1?'monthly':f.interval==='month'&&f.intervalCount===3?'quarterly':f.interval==='year'&&f.intervalCount===1?'annually':''
const token=(f:Row)=>sha256(JSON.stringify(f))
const redirect=(location:string)=>new Response(null,{status:303,headers:{location,'cache-control':'no-store','referrer-policy':'no-referrer'}})

export async function managePlanPage(env:GivingEnv,donor:PortalDonor,id:string,saved=false){
 const {c,own}=await ownPlan(env,donor,id),current=await stripe(env,'subscriptions/'+encodeURIComponent(own.id))
 validatePlan(current,own)
 if(current.status==='paused')fail('plan_review','This Stripe-paused plan needs the organization’s review before restarting billing.',409)
 const f=planFacts(current),version=await token(f),ended=['canceled','incomplete_expired'].includes(current.status)
 const controls=ended?'<p>This recurring gift has ended.</p>':`${box('Amount and frequency',`<p>Amount changes apply to future billing without a prorated adjustment. Changing frequency starts a new billing period today and may collect the new installment immediately. Stripe may require you to confirm payment separately.</p><form method="post" action="/giving/portal/plan">${hidden('subscription',own.id)}${hidden('requestId',crypto.randomUUID())}${hidden('version',version)}${hidden('action','change')}${field('Amount (USD)','amount','text',(f.amountCents/100).toFixed(2),'required inputmode="decimal"')}${select('Frequency','frequency',[...(!frequency(f)?[['','Choose the new frequency'] as [string,string]]:[]),...frequencies],frequency(f),'required')}<label><input type="checkbox" name="confirm" value="yes" required> I confirm this amount and billing frequency.</label><button>Save recurring gift</button></form>`)}${box(f.paused?'Resume collections':'Pause collections',`<p>${f.paused?'Resume collection on the existing billing schedule. Paused installments were voided and will not be caught up.':'Pause collection of future installments until you resume. Invoices during the pause are voided; previous gifts are unchanged.'}</p><form method="post" action="/giving/portal/plan">${hidden('subscription',own.id)}${hidden('requestId',crypto.randomUUID())}${hidden('version',version)}${hidden('action',f.paused?'resume':'pause')}${hidden('confirm','yes')}<button>${f.paused?'Resume recurring gift':'Pause recurring gift'}</button></form>`)}<p><a href="/giving/portal/cancel?subscription=${encodeURIComponent(own.id)}">Cancel recurring gift</a></p>`
 await commit(c,[])
 return portalPage('Manage recurring giving',`<p>${e(own.campaign_name)} · ${money(f.amountCents)} ${e(f.intervalCount===1?`per ${f.interval}`:`every ${f.intervalCount} ${f.interval}s`)}${f.paused?' · collections paused':''}</p>${saved?'<p class="notice" role="status">Your recurring gift change is saved.</p>':''}${controls}<p><a href="/giving/portal">Back to your giving account</a></p>`)
}
export async function changePlan(env:GivingEnv,donor:PortalDonor,data:URLSearchParams,cancel=false){
 const {c,own}=await ownPlan(env,donor,data.get('subscription')??''),action=cancel?'cancel':choice(data.get('action'),['change','pause','resume'] as const,'recurring gift change')
 if(data.get('confirm')!=='yes')fail('confirmation_required','Confirm this recurring gift change.',400)
 if(data.has('donorId')&&data.get('donorId')!==donor.id)fail('FORBIDDEN','Only your own recurring gift can be changed.',403)
 const id=data.get('requestId')??crypto.randomUUID()
 if(!/^[a-f0-9-]{36,64}$/.test(id))fail('input','Use the recurring gift form.',400)
 const desired=action==='change'?{amountCents:amount({amount:data.get('amount')},'amount','Amount'),frequency:choice(data.get('frequency'),frequencies.map(([v])=>v),'frequency')}:{},payload=JSON.stringify({action,...desired})
 const previous=await one(c,'SELECT * FROM cf_portal_changes WHERE id=?',id)
 if(previous){
  if(previous.donor_id!==donor.id||previous.subscription_id!==own.id||previous.request!==payload)fail('request_changed','This change does not match your previous request.',409)
  if(previous.state==='complete')return redirect('/giving/portal?changed=1')
  fail('change_pending','The result of this request needs a provider check. Contact the organization before submitting another change.',409)
 }
 const current=await stripe(env,'subscriptions/'+encodeURIComponent(own.id));validatePlan(current,own)
 if(cancel&&current.cancel_at_period_end&&await one(c,"SELECT 1 FROM cf_portal_changes WHERE subscription_id=? AND action='cancel' AND state='complete'",own.id))return redirect('/giving/portal?cancelled=1')
 if(['canceled','incomplete_expired'].includes(current.status))fail('plan_ended','This recurring gift has ended.',409)
 const f=cancel?null:planFacts(current)
 if(f&&data.get('version')!==await token(f))fail('plan_changed','The plan changed at Stripe. Reload before confirming.',409)
 if(!cancel&&(current.cancel_at_period_end||current.cancel_at||current.status==='paused'))fail('plan_ending','This plan is scheduled to end. Contact the organization before changing it.',409)
 const params:Record<string,string|number|boolean>={}
 if(action==='cancel')params.cancel_at_period_end=true
 else if(action==='pause')params['pause_collection[behavior]']='void'
 else if(action==='resume')params.pause_collection=''
 else{
  const [interval,count]=schedule((desired as {frequency:string}).frequency)
  Object.assign(params,{'items[0][id]':f!.itemId,'items[0][quantity]':1,'items[0][price_data][currency]':'usd','items[0][price_data][product]':f!.product,'items[0][price_data][unit_amount]':(desired as {amountCents:number}).amountCents,'items[0][price_data][recurring][interval]':interval,'items[0][price_data][recurring][interval_count]':count,proration_behavior:'none',payment_behavior:'error_if_incomplete'})
 }
 await commit(c,[guard("NOT EXISTS(SELECT 1 FROM cf_portal_changes WHERE subscription_id=? AND state='pending')",'change_pending','A previous change still needs a provider check. Contact the organization.',own.id),guard(`EXISTS(SELECT 1 FROM cf_subscriptions s LEFT JOIN cf_portal_subscription_settings p ON p.subscription_id=s.id WHERE s.id=? AND s.donor_id=? AND s.customer_id=? AND s.updated_at=? AND s.amount_cents=? AND s.cancel_at_period_end=? AND p.observed_at IS ? AND p.collection_paused IS ? AND p.interval IS ? AND p.interval_count IS ?)`, 'subscription_changed','This recurring gift changed. Reload before confirming.',own.id,donor.id,own.customer_id,own.updated_at,own.amount_cents,own.cancel_at_period_end,own.schedule_observed_at??null,own.collection_paused??null,own.interval??null,own.interval_count??null),sql("INSERT INTO cf_portal_changes(id,donor_id,subscription_id,action,state,request,created_at) VALUES(?,?,?,?,'pending',?,?)",id,donor.id,own.id,action,payload,c.now),event(c,'portal.changeRequested','subscription',own.id,donor.id,{requestId:id,action,...desired})])
 // A network error holds the durable claim. Never silently repeat an uncertain
 // financial change or release the plan for a conflicting subsequent mutation.
 const changed=await stripe(env,'subscriptions/'+encodeURIComponent(own.id),params as StripeParams,'coffer-portal-'+id)
 validatePlan(changed,own)
 const after=cancel?null:planFacts(changed)
 if(action==='cancel'&&!changed.cancel_at_period_end)fail('stripe_error','Stripe did not confirm cancellation.',502)
 if(action==='pause'&&!after?.paused||action==='resume'&&after?.paused)fail('stripe_error','Stripe did not confirm the collection change.',502)
 if(action==='change'){
  const [interval,count]=schedule((desired as {frequency:string}).frequency)
  if(after?.amountCents!==(desired as {amountCents:number}).amountCents||after.interval!==interval||after.intervalCount!==count)fail('stripe_error','Stripe did not confirm the requested amount and frequency.',502)
 }
 const completed=new Date().toISOString(),statements=[sql('UPDATE cf_subscriptions SET status=?,cancel_at_period_end=?,amount_cents=?,updated_at=? WHERE id=? AND donor_id=?',changed.status,Number(changed.cancel_at_period_end),after?.amountCents??own.amount_cents,completed,own.id,donor.id),sql("UPDATE cf_portal_changes SET state='complete',completed_at=? WHERE id=? AND state='pending'",completed,id),event({...c,now:completed},'portal.'+action,'subscription',own.id,donor.id,{requestId:id,...desired,...(after?{interval:after.interval,intervalCount:after.intervalCount,collectionsPaused:after.paused}:{cancelAtPeriodEnd:true})})]
 if(after)statements.push(sql('INSERT INTO cf_portal_subscription_settings(subscription_id,interval,interval_count,collection_paused,observed_at) VALUES(?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET interval=excluded.interval,interval_count=excluded.interval_count,collection_paused=excluded.collection_paused,observed_at=excluded.observed_at',own.id,after.interval,after.intervalCount,Number(after.paused),completed))
 if(action==='cancel'){
  const owner=`COALESCE((SELECT o.id FROM cf_portfolio_members m JOIN cf_portfolios p ON p.id=m.portfolio_id JOIN oa_operators o ON o.id=p.manager_id WHERE m.donor_id=? AND o.status='active' AND o.role IN ('owner','admin','member') ORDER BY p.id LIMIT 1),(SELECT id FROM oa_operators WHERE role='owner' AND status='active' ORDER BY id LIMIT 1))`,taskId=crypto.randomUUID(),day=today((await settings(c)).timezone,new Date(completed))
  statements.push(guard(`${owner} IS NOT NULL`,'OWNER_CHANGED','The cancellation is confirmed at Stripe; staff task assignment needs review.',donor.id),sql(`INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask) VALUES(?,?,?,'recovery','Donor cancelled recurring giving in the portal. Review the requested cancellation; do not restart collections without the donor’s permission.',?,${owner},?,?,0)`,taskId,donor.id,'portal-cancel:'+id,own.amount_cents,donor.id,day,completed),event(c,'portal.cancellationTask','task',taskId,donor.id,{subscriptionId:own.id,requestId:id}))
 }
 await commit(c,statements)
 return redirect(cancel?'/giving/portal?cancelled=1':'/giving/portal?changed=1')
}
