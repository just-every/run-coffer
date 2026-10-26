import { requireRole } from '../auth'
import { all, date, fail, today, type Context, type Row } from '../db'
import { settings } from '../settings'
import { fiscalPeriod } from '../giving-summary'
import { dashboardReport } from '../dashboard'
import { dashboardLedger } from '../dashboard-ledger'
import { retention } from '../retention'
import { recurringHealth } from '../recurring-health'
import { opportunityPipeline } from '../major-gifts'

export type ReportMetric = { label: string; value: number | null; format: 'money' | 'number' | 'percent' | 'days'; source: { href: string; api: string; pointer: string } }
export type ReportSection = { key: string; title: string; explanation: string; metrics: ReportMetric[] }
export const reportStaff = (c: Context) => requireRole(c.actor,['owner','admin'],'manage development reports')

export async function developmentMonth(c: Context, month: unknown) {
 reportStaff(c)
 const s=await settings(c),asOf=today(s.timezone,new Date(c.now))
 if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month))fail('INPUT','Choose a report month like 2026-09.',400)
 const from=date(month+'-01','Report month')
 if(month>asOf.slice(0,7))fail('INPUT','Choose this month or an earlier month.',400)
 const next=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),1)).toISOString().slice(0,10)
 const end=new Date(Date.parse(next+'T00:00:00Z')-86400000).toISOString().slice(0,10)
 return {month,from,through:end>asOf?asOf:end,asOf,timezone:s.timezone,year:Number(fiscalPeriod(from,s.fiscal_year_start).start.slice(0,4))}
}

/** Read-only report projection: discovery and delivery agents are never run here.
 * Follow-up balances and pipeline remain current; their historical state is not inferred. */
export async function developmentReportFacts(c: Context, month: unknown) {
 const period=await developmentMonth(c,month)
 const [ledger,overdue]=await Promise.all([
  dashboardLedger(c,period.from,period.through),
  all(c,`SELECT s.kind,s.source_id,s.donor_id,d.name AS donor_name,s.title,s.due_on,s.amount_cents,s.hold,s.source_token
   FROM cf_development_sources s JOIN cf_donors d ON d.id=s.donor_id
   WHERE s.outstanding=1 AND s.active=1 AND s.due_on<=? AND s.due_on<? ORDER BY s.due_on,s.kind,s.source_id`,period.through,period.asOf),
 ])
 const gifts=new Map<string,Row>()
 for(const entry of ledger){
  const key=String(entry.gift_id),gift=gifts.get(key)??{giftId:key,donorId:entry.donor_name?entry.donor_id:null,donorName:entry.donor_name??'Anonymous constituent',amountCents:0}
  gift.amountCents+=Number(entry.amount_cents);gifts.set(key,gift)
 }
 const notable=[...gifts.values()].filter(g=>g.amountCents>0).sort((a,b)=>b.amountCents-a.amountCents||a.giftId.localeCompare(b.giftId)).slice(0,5)
 return {...period,notable,overdue:{count:overdue.length,remainingCents:overdue.reduce((n,r)=>n+Number(r.amount_cents),0),rows:overdue}}
}

/** Each displayed number is an exact projection of a public report response. */
export async function developmentReportSources(c: Context, month: unknown) {
 const facts=await developmentReportFacts(c,month),{year}=facts
 const root=c.env!.AUTH_ORIGIN,query='?year='+year
 const dashboardApi='/api/coffer/reports/dashboard'+query,dashboardHref='/app/reports/dashboard'+query
 const retentionQuery='?basis=fiscal&year='+year,healthQuery='?from='+facts.month+'&through='+facts.month
 const projectionApi='/api/coffer/reports/development-sources?month='+facts.month,projectionHref='/app/agent/reports?month='+facts.month+'&sources=1'
 const [dashboard,cohorts,health,pipeline]=await Promise.all([
  dashboardReport(c,new URL(dashboardApi,root)),retention(c,new URL('/api/coffer/retention'+retentionQuery,root)),
  recurringHealth(c,new URL('/api/coffer/reports/recurring'+healthQuery,root)),opportunityPipeline(c,new URL('/api/coffer/pipeline',root)),
 ])
 const monthIndex=dashboard.dimensions.month.findIndex(r=>r.key===facts.month.slice(5))
 const raised=dashboard.dimensions.month[monthIndex],recurring=health.rows[0]
 const metric=(label:string,value:number|null,format:ReportMetric['format'],api:string,href:string,pointer:string):ReportMetric=>({label,value,format,source:{api,href,pointer}})
 const sections:ReportSection[]=[
  {key:'raised',title:'Raised against goal',explanation:'Signed received money in the selected month. Monthly goals are explicitly recorded; no goal is inferred.',metrics:[
   metric('Raised',raised.currentCents,'money',dashboardApi,dashboardHref+'&view=entries&dimension=month&key='+facts.month.slice(5),`/dimensions/month/${monthIndex}/currentCents`),
   metric('Recorded monthly goal',raised.goal?.amount_cents??null,'money',dashboardApi,dashboardHref+'#goals',`/dimensions/month/${monthIndex}/goal${raised.goal?'/amount_cents':''}`),
  ]},
  {key:'retention',title:'Annual donor retention',explanation:`Fiscal year ${year}, ${cohorts.current.from} through ${cohorts.current.through}; compared with the complete prior fiscal year. This is the annual report available when this draft was prepared, not a monthly retention rate.`,metrics:[
   metric('Annual retention rate',cohorts.totals.retentionRate,'percent','/api/coffer/retention'+retentionQuery,'/app/retention'+retentionQuery,'/totals/retentionRate'),
   metric('Retained donors',cohorts.groups.retained.count,'number','/api/coffer/retention'+retentionQuery,'/app/retention'+retentionQuery+'#retained','/groups/retained/count'),
   metric('Lapsed donors',cohorts.groups.lapsed.count,'number','/api/coffer/retention'+retentionQuery,'/app/retention'+retentionQuery+'#lapsed','/groups/lapsed/count'),
  ]},
  {key:'recurring',title:'Recurring giving health',explanation:'Recorded month-end commitments, or month to date for the current month. Commitments are separate from received gifts; unknown legacy history remains disclosed in the source report.',metrics:[
   ...([['Active recurring donors','activeDonors','number'],['Monthly recurring revenue','mrrCents','money'],['New plans','newPlans','number'],['Canceled plans','canceledPlans','number'],['Failed payments','failedPayments','number'],['Recovered payments','recoveredPayments','number'],['Average plan length','averagePlanDays','days'],['Plans with unknown starts','unknownStartPlans','number'],['Plans with unknown state','unknownStatePlans','number']] as const).map(([label,key,format])=>metric(label,recurring[key],format,'/api/coffer/reports/recurring'+healthQuery,'/app/giving/health'+healthQuery,'/rows/0/'+key)),
  ]},
  {key:'pipeline',title:'Current pipeline',explanation:'Current open opportunities at preparation, independently of the selected report month. These commitments are not received money.',metrics:[
   ...([['Open opportunities','open','number'],['Expected commitments','expectedCents','money'],['Probability-weighted commitments','forecastCents','money']] as const).map(([label,key,format])=>metric(label,pipeline.totals[key],format,'/api/coffer/pipeline','/app/pipeline','/totals/'+key)),
  ]},
  {key:'notable',title:'Notable received gifts',explanation:'The largest positive net gift contributions within the selected month, after combining their fund allocations. Signed adjustments count on their own ledger dates; this is not a claim about a donor’s current lifetime balance.',metrics:facts.notable.map((gift,i)=>metric(gift.donorName,gift.amountCents,'money',projectionApi,projectionHref+'#notable','/notable/'+i+'/amountCents'))},
  {key:'overdue',title:'Current overdue follow-up',explanation:'Current active outstanding installments, grant reports and employer matches due by the selected month end and already overdue today. These are current source balances, not reconstructed historical balances.',metrics:[
   metric('Overdue commitments and reports',facts.overdue.count,'number',projectionApi,projectionHref+'#overdue','/overdue/count'),
   metric('Remaining pledge and match amounts',facts.overdue.remainingCents,'money',projectionApi,projectionHref+'#overdue','/overdue/remainingCents'),
  ]},
 ]
 return {month:facts.month,period:{from:facts.from,through:facts.through,asOf:facts.asOf,timezone:facts.timezone},sections,
  donorIds:[...new Set([...facts.notable.map(g=>g.donorId),...facts.overdue.rows.map(r=>r.donor_id)].filter(Boolean))] as string[]}
}
