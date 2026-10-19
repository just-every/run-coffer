import { all, date, daysBetween, fail, today, type Context, type Row } from './db'
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
export async function recurringHealth(c: Context, url: URL) {
 const timezone = (await settings(c)).timezone, now = today(timezone,new Date(c.now))
 const through = month(url.searchParams.get('through'),'Through',now.slice(0,7))
 const from = month(url.searchParams.get('from'),'From',through.slice(0,4)+'-01')
 if (from > through || through > now.slice(0,7)) fail('INPUT','Choose an ordered period ending no later than this month.',400)
 const months: string[] = []
 for(let m=from;m<=through;m=nextMonth(m)){months.push(m);if(months.length>120)fail('INPUT','Choose at most 120 months.',400)}
 const [plans, history, payments] = await Promise.all([
  all(c,'SELECT l.*,s.donor_id FROM cf_subscription_lifetimes l JOIN cf_subscriptions s ON s.id=l.subscription_id'),
  all(c,'SELECT * FROM cf_subscription_history ORDER BY observed_at,sequence'),
  all(c,'SELECT * FROM cf_recurring_payment_health'),
 ])
 const day = (at: string) => today(timezone,new Date(at))
 const histories = new Map<string,Row[]>()
 for(const h of history){h.day=day(h.observed_at);const list=histories.get(h.subscription_id)??[];list.push(h);histories.set(h.subscription_id,list)}
 const rows=months.map(m=>{
  const end = m===now.slice(0,7) ? now : new Date(Date.parse(nextMonth(m)+'-01T00:00:00Z')-86400000).toISOString().slice(0,10)
  const donors=new Set<string>()
  let mrrCents=0,newPlans=0,canceledPlans=0,duration=0,lengthPlans=0,unknownStartPlans=0,unknownStatePlans=0
  for(const plan of plans){
   const start=day(plan.started_at), snapshots=histories.get(plan.subscription_id)??[], seen=snapshots.filter(h=>h.day<=end)
   const state=seen.at(-1), ended=seen.find(h=>ENDED.has(h.status)), endDay=ended?.day
   if(start>end)continue
   if(plan.start_known && start.slice(0,7)===m)newPlans++
   if(endDay?.slice(0,7)===m)canceledPlans++
   if(!state){unknownStatePlans++;continue}
   if(ACTIVE.has(state.status)){donors.add(plan.donor_id);mrrCents+=state.amount_cents}
   if(!endDay || endDay>=m+'-01'){
    if(plan.start_known){duration+=Math.max(0,daysBetween(start,endDay??end));lengthPlans++}
    else unknownStartPlans++
   }
  }
  return {month:m,through:end,activeDonors:donors.size,mrrCents,newPlans,canceledPlans,
   failedPayments:payments.filter(p=>day(p.failed_at).slice(0,7)===m).length,
   recoveredPayments:payments.filter(p=>p.recovered_at&&day(p.recovered_at).slice(0,7)===m).length,
   averagePlanDays:lengthPlans ? Math.round(duration/lengthPlans*100)/100 : null,lengthPlans,unknownStartPlans,unknownStatePlans}
 })
 return {from,through,timezone,rows,historySince:history.length ? history[0].observed_at : null}
}
