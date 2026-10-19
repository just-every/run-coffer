import { all, type Context, type Row } from './db'
import { dashboardGoals, DASHBOARD_DIMENSIONS, type DashboardDimension } from './dashboard-goals'
import { dashboardGroup, dashboardLedger, dashboardScope } from './dashboard-ledger'
import { retention } from './retention'
import { recurringHealth } from './recurring-health'
import { today } from './db'
import { opportunityPipeline } from './major-gifts'

export { dashboardCommand } from './dashboard-goals'
export { dashboardEntries } from './dashboard-ledger'
export const dashboardHref = (year: number, params: Record<string,string> = {}) => '/app/reports/dashboard?' + new URLSearchParams({year:String(year),...params})
export const dashboardEntryHref = (year: number, dimension: string, key: string, period='current', cohort='') => dashboardHref(year,{view:'entries',dimension,key,period,...(cohort?{cohort}:{})})

export async function dashboardReport(c: Context, url: URL) {
 const scope = await dashboardScope(c,url), q = new URL(url);q.search='';q.searchParams.set('basis','fiscal');q.searchParams.set('year',String(scope.year))
 const healthUrl = new URL(url);healthUrl.search='';healthUrl.searchParams.set('from',scope.start.slice(0,7));healthUrl.searchParams.set('through',scope.end.slice(0,7))
 const [current,prior,goals,cohorts,recurring,pipeline,campaigns,funds,appeals,planSources] = await Promise.all([
  dashboardLedger(c,scope.start,scope.end),dashboardLedger(c,scope.priorStart,scope.priorEnd),dashboardGoals(c,scope.year,scope.monthDay),retention(c,q),
  recurringHealth(c,healthUrl),opportunityPipeline(c,new URL(url.origin+'/api/coffer/pipeline')),
  all(c,'SELECT id,name FROM cf_campaigns ORDER BY lower(name)'),all(c,'SELECT name FROM cf_funds UNION SELECT fund AS name FROM cf_fund_ledger ORDER BY name'),all(c,'SELECT code,name FROM cf_appeal_codes ORDER BY lower(name)'),
  all(c,`SELECT h.*,s.donor_id,CASE WHEN d.erased_at IS NULL THEN d.name ELSE NULL END AS donor_name FROM cf_subscription_history h JOIN cf_subscriptions s ON s.id=h.subscription_id JOIN cf_donors d ON d.id=s.donor_id ORDER BY h.observed_at,h.sequence`),
 ])
 const dimensions = Object.fromEntries(DASHBOARD_DIMENSIONS.map(dimension=>{
  const rows = new Map<string,{key:string;label:string;currentCents:number;priorCents:number;goal:Row|null;href:string;priorHref:string}>()
  const add = (key:string,label:string) => {
   let row=rows.get(key)
   if(!row){row={key,label,currentCents:0,priorCents:0,goal:goals.find(g=>g.dimension===dimension&&g.dimension_key===key)??null,
    href:dashboardEntryHref(scope.year,dimension,key),priorHref:dashboardEntryHref(scope.year,dimension,key,'prior')};rows.set(key,row)}
   return row
  }
  if(dimension==='organization')add('','Organization')
  if(dimension==='month')for(let offset=0;offset<12;offset++){
   const month=String((Number(scope.monthDay.slice(0,2))-1+offset)%12+1).padStart(2,'0')
   add(month,dashboardGroup({received_on:`2000-${month}-01`},'month')[1])
  }
  const labelFor=(key:string)=> dimension==='campaign'||dimension==='form'?campaigns.find(r=>r.id===key)?.name??key:dimension==='appeal'?appeals.find(r=>r.code===key)?.name??key:key
  for(const g of goals.filter(g=>g.dimension===dimension))add(g.dimension_key,labelFor(g.dimension_key))
  for(const [entries,field] of [[current,'currentCents'],[prior,'priorCents']] as const)for(const e of entries){const [key,label]=dashboardGroup(e,dimension);add(key,label)[field]+=Number(e.amount_cents)}
  const values=[...rows.values()];if(dimension!=='month')values.sort((a,b)=>a.label.localeCompare(b.label))
  return [dimension,values]
 })) as Record<DashboardDimension,Array<{key:string;label:string;currentCents:number;priorCents:number;goal:Row|null;href:string;priorHref:string}>>
 const summary=dimensions.organization[0]
 return {year:scope.year,priorYear:scope.priorYear,timezone:scope.timezone,asOf:scope.asOf,fiscalStart:scope.monthDay,
  current:{from:scope.start,through:scope.end,provisional:scope.year===scope.currentYear},prior:{from:scope.priorStart,through:scope.priorEnd,label:'Full prior fiscal year'},
  summary,dimensions,goals,cohorts,recurring,pipeline,recurringSources:recurring.rows.map(month=>{
   const seen=new Map<string,Row>()
   for(const row of planSources)if(today(scope.timezone,new Date(row.observed_at))<=month.through)seen.set(row.subscription_id,row)
   return {month:month.month,plans:[...seen.values()].filter(row=>['active','trialing','past_due'].includes(row.status)).map((row):Row=>({...row,donor_id:row.donor_name?row.donor_id:null}))}
  }),options:{campaigns,funds,appeals}}
}
