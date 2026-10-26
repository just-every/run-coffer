import { acknowledgmentFilters, acknowledgmentPredicate } from './acknowledgment-filters'
import { all, choice, fail, integer, type Context, type Row } from './db'
import { retentionScope } from './retention-scope'
import { DASHBOARD_DIMENSIONS, type DashboardDimension } from './dashboard-goals'
import { CHANNEL_LABELS } from './attribution'

export const dashboardScope = (c: Context, url: URL) => {
 const q = new URL(url); q.searchParams.set('basis','fiscal')
 // The dashboard compares all received money; donor segmentation has its own report.
 for (const k of ['list','q','relationship','relatedTo','volunteer','fund','campaignId']) q.searchParams.delete(k)
 return retentionScope(c,q)
}

export function dashboardLedgerSelection(from: string, through: string, url?:URL) {
 const acknowledgment=url?acknowledgmentPredicate(url,'l.gift_id'):{sql:'1',params:[],filters:{}}
 return {query:`SELECT l.*,CASE WHEN d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id) THEN d.name ELSE NULL END AS donor_name,
  cm.name AS campaign_name,ga.appeal,a.name AS appeal_name,ch.channel,f.form_id,fc.name AS form_name
  FROM cf_fund_ledger l JOIN cf_donors d ON d.id=l.donor_id
  LEFT JOIN cf_campaigns cm ON cm.id=l.campaign_id
  LEFT JOIN cf_gift_appeals ga ON ga.gift_id=l.gift_id LEFT JOIN cf_appeal_codes a ON a.code=ga.appeal
  LEFT JOIN cf_gift_channels ch ON ch.gift_id=l.gift_id
  LEFT JOIN cf_dashboard_gift_forms f ON f.gift_id=l.gift_id LEFT JOIN cf_campaigns fc ON fc.id=f.form_id
  WHERE l.received_on>=? AND l.received_on<=? AND ${acknowledgment.sql} ORDER BY l.received_on DESC,l.id,l.position`,params:[from,through,...acknowledgment.params],parameters:acknowledgment.filters}
}

export async function dashboardLedger(c: Context, from: string, through: string, url?:URL) {
 const selection=dashboardLedgerSelection(from,through,url)
 return all(c,selection.query,...selection.params)
}

export async function dashboardMoneySelection(c:Context,url:URL) {
 const scope=await dashboardScope(c,url)
 const period=choice(url.searchParams.get('period')||'current',['current','prior'] as const,'period')
 const dimension=choice(url.searchParams.get('dimension')||'organization',DASHBOARD_DIMENSIONS,'dimension')
 const key=url.searchParams.get('key')??''
 // Cohort exports need the cohort's own consistent membership before they ship.
 if(url.searchParams.get('cohort'))fail('INPUT','Dashboard cohort export is not implemented.',400)
 const selection=dashboardLedgerSelection(period==='prior'?scope.priorStart:scope.start,period==='prior'?scope.priorEnd:scope.end,url)
 const column={organization:"''",fund:'r.fund',campaign:"COALESCE(r.campaign_id,'')",appeal:"COALESCE(r.appeal,'')",channel:"COALESCE(r.channel,'')",form:"COALESCE(r.form_id,'')",month:'substr(r.received_on,6,2)'}[dimension]
 return {query:`SELECT * FROM (${selection.query}) r WHERE ${column}=?`,params:[...selection.params,key],
  parameters:{year:scope.year,period,dimension,key,...selection.parameters},scope}
}

export function dashboardGroup(row: Row, dimension: DashboardDimension): [string,string] {
 switch (dimension) {
  case 'organization': return ['', 'Organization']
  case 'fund': return [row.fund, row.fund]
  case 'campaign': return [row.campaign_id ?? '', row.campaign_name ?? 'No campaign']
  case 'appeal': return [row.appeal ?? '', row.appeal_name ?? 'No appeal']
  case 'channel': return [row.channel ?? '', CHANNEL_LABELS[row.channel] ?? 'Channel not recorded']
  case 'form': return [row.form_id ?? '', row.form_name ?? 'No recorded giving form']
  case 'month': return [row.received_on.slice(5,7), new Intl.DateTimeFormat('en-US',{month:'long',timeZone:'UTC'}).format(new Date(`2000-${row.received_on.slice(5,7)}-01T00:00:00Z`))]
 }
}

/** Same entries and predicate supply both every amount and its public drilldown. */
export async function dashboardEntries(c: Context, url: URL) {
 const scope = await dashboardScope(c,url)
 const period = choice(url.searchParams.get('period') || 'current', ['current','prior'] as const, 'period')
 const dimension = choice(url.searchParams.get('dimension') || 'organization', DASHBOARD_DIMENSIONS, 'dimension')
 const key = url.searchParams.get('key') ?? '', page = integer(Number(url.searchParams.get('page') ?? 0),'Page',0,100000)
 let entries = (await dashboardLedger(c,period==='prior'?scope.priorStart:scope.start,period==='prior'?scope.priorEnd:scope.end,url))
  .filter(r => dashboardGroup(r,dimension)[0] === key)
 const cohort = url.searchParams.get('cohort')
 if(cohort) {
  const { retention } = await import('./retention')
  const q = new URL(url);q.search='';q.searchParams.set('basis','fiscal');q.searchParams.set('year',String(scope.year))
  const r = await retention(c,q), kind = choice(cohort,['new','retained','lapsed','recaptured'] as const,'cohort')
  const ids = new Set(r.groups[kind].rows.map(d=>d.donorId));entries=entries.filter(e=>ids.has(e.donor_id)&&e.donor_name!==null)
 }
 const totalCents = entries.reduce((n,r)=>n+Number(r.amount_cents),0)
 // Anonymous ledger facts reconcile without leaking their donor identity or reference.
 const safe = entries.map(r => r.donor_name === null ? {...r,donor_id:null,reference:null} : r)
 return {filters:acknowledgmentFilters(Object.fromEntries(url.searchParams)),year:scope.year,period,dimension,key,cohort:cohort??null,totalCents,count:entries.length,page,more:entries.length>(page+1)*50,entries:safe.slice(page*50,(page+1)*50)}
}
