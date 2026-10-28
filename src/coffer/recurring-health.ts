import { date, daysBetween, fail, one, today, type Context, type Row } from './db'
import { settings } from './settings'

const ACTIVE = new Set(['active','trialing','past_due'])
const ENDED = new Set(['canceled','incomplete_expired'])
function month(value: string | null, label: string, fallback: string) {
 if (value === null) return fallback
 if (!/^\d{4}-\d{2}$/.test(value)) fail('INPUT', `${label} must be a month like 2026-01.`,400)
 date(value+'-01',label)
 return value
}
const nextMonth = (value: string) => new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5)),1)).toISOString().slice(0,7)

/** Month-end snapshots use the organization's calendar. A plan remains active
 * through scheduled cancellation; failed payments count invoices, not retries. */
export async function recurringHealthSelection(c: Context, url: URL) {
 const timezone = (await settings(c)).timezone, now = today(timezone,new Date(c.now))
 const through = month(url.searchParams.get('through'),'Through',now.slice(0,7))
 const from = month(url.searchParams.get('from'),'From',through.slice(0,4)+'-01')
 if (from > through || through > now.slice(0,7)) fail('INPUT','Choose an ordered period ending no later than this month.',400)
 const months: string[] = []
 for(let m=from;m<=through;m=nextMonth(m)){months.push(m);if(months.length>120)fail('INPUT','Choose at most 120 months.',400)}
 const sourceSql=`SELECT json_object('plans',json((SELECT json_group_array(json_object('subscription_id',s.id,'donor_id',s.donor_id,'campaign_id',s.campaign_id,
  'started_at',l.started_at,'start_known',l.start_known,'failed_attempts',s.failed_attempts,'recovered',s.recovered,'updated_at',s.updated_at))
  FROM (SELECT * FROM cf_subscriptions ORDER BY id) s JOIN cf_subscription_lifetimes l ON l.subscription_id=s.id)),
  'history',json((SELECT json_group_array(json_object('subscription_id',subscription_id,'observed_at',observed_at,'sequence',sequence,'status',status,
   'amount_cents',amount_cents,'cancel_at_period_end',cancel_at_period_end,'billing_interval',billing_interval,'interval_count',interval_count,'collection_paused',collection_paused))
   FROM (SELECT * FROM cf_subscription_history ORDER BY observed_at,sequence))),
  'payments',json((SELECT json_group_array(json_object('invoice_id',invoice_id,'subscription_id',subscription_id,'failed_at',failed_at,'recovered_at',recovered_at))
   FROM (SELECT * FROM cf_recurring_payment_health ORDER BY invoice_id)))) AS snapshot`
 const source=String((await one(c,sourceSql))!.snapshot)
 const {plans,history,payments}=JSON.parse(source) as {plans:Row[];history:Row[];payments:Row[]}
 const day = (at: string) => today(timezone,new Date(at))
 const histories = new Map<string,Row[]>()
 for(const h of history){h.day=day(h.observed_at);const list=histories.get(h.subscription_id)??[];list.push(h);histories.set(h.subscription_id,list)}
 const snapshots:Array<{month:string;records:Row[];totals:Row}>=[]
 const rows=months.map(m=>{
  const end = m===now.slice(0,7) ? now : new Date(Date.parse(nextMonth(m)+'-01T00:00:00Z')-86400000).toISOString().slice(0,10)
  const donors=new Set<string>()
  let mrrCents=0,newPlans=0,canceledPlans=0,duration=0,lengthPlans=0,unknownStartPlans=0,unknownStatePlans=0
  const records:Row[]=[]
  for(const plan of plans){
   const start=day(plan.started_at), snapshots=histories.get(plan.subscription_id)??[], seen=snapshots.filter(h=>h.day<=end)
   const state=seen.at(-1), ended=seen.find(h=>ENDED.has(h.status)), endDay=ended?.day
   if(start>end)continue
   const active=Boolean(state&&ACTIVE.has(state.status)&&!state.collection_paused)
   const monthlyCents=active&&state?Math.round(state.amount_cents*(state.billing_interval==='week'?52/12:state.billing_interval==='day'?365/12:1)/(state.billing_interval==='year'?12*state.interval_count:state.interval_count)):0
   records.push({id:plan.subscription_id,donor_id:plan.donor_id,campaign_id:plan.campaign_id,amount_cents:state?.amount_cents??null,
    status:state?.status??'unknown',billing_interval:state?.billing_interval??null,interval_count:state?.interval_count??null,collection_paused:state?.collection_paused??null,
    cancel_at_period_end:state?.cancel_at_period_end??null,updated_at:state?.observed_at??null,
    failed_attempts:null,recovered:null,mrr_cents:monthlyCents,active,new_plan:Boolean(plan.start_known&&start.slice(0,7)===m),
    canceled:endDay?.slice(0,7)===m,length_plan:Boolean(state&&plan.start_known&&(!endDay||endDay>=m+'-01')),
    unknown_start:Boolean(state&&!plan.start_known&&(!endDay||endDay>=m+'-01')),unknown_state:!state,
    failed:payments.filter(p=>p.subscription_id===plan.subscription_id&&day(p.failed_at).slice(0,7)===m).length,
    recovered_payments:payments.filter(p=>p.subscription_id===plan.subscription_id&&p.recovered_at&&day(p.recovered_at).slice(0,7)===m).length})
   if(plan.start_known && start.slice(0,7)===m)newPlans++
   if(endDay?.slice(0,7)===m)canceledPlans++
   if(!state){unknownStatePlans++;continue}
   if(ACTIVE.has(state.status)&&!state.collection_paused){donors.add(plan.donor_id);mrrCents+=Math.round(state.amount_cents*(state.billing_interval==='week'?52/12:state.billing_interval==='day'?365/12:1)/(state.billing_interval==='year'?12*state.interval_count:state.interval_count))}
   if(!endDay || endDay>=m+'-01'){
    if(plan.start_known){duration+=Math.max(0,daysBetween(start,endDay??end));lengthPlans++}
    else unknownStartPlans++
   }
  }
  const totals={month:m,through:end,activeDonors:donors.size,mrrCents,newPlans,canceledPlans,
   failedPayments:payments.filter(p=>day(p.failed_at).slice(0,7)===m).length,
   recoveredPayments:payments.filter(p=>p.recovered_at&&day(p.recovered_at).slice(0,7)===m).length,
   averagePlanDays:lengthPlans ? Math.round(duration/lengthPlans*100)/100 : null,lengthPlans,unknownStartPlans,unknownStatePlans}
  snapshots.push({month:m,records,totals})
  return totals
 })
 return {report:{from,through,timezone,rows,historySince:history.length ? history[0].observed_at : null},snapshots,sourceSql,source}
}

export async function recurringHealth(c:Context,url:URL) {
 return (await recurringHealthSelection(c,url)).report
}
