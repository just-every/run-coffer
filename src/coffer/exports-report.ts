import { retentionRecordSelection } from './retention'
import { choice } from './db'
import { dashboardMoneySelection } from './dashboard-ledger'
import { honorRollRecordSelection } from './recognition'
import { attributionRecordSelection } from './attribution'
import { customRecordSelection } from './custom-report'
import { stateRecordSelection } from './state-report'
import { fundRecordSelection } from './fund-report'
import { fail, one, type Context } from './db'
import type { ExportSelection } from './exports-selection'
import { exportRecords } from './exports-records'

export async function reportSelection(c:Context,url:URL):Promise<ExportSelection> {
 const report=url.searchParams.get('report')
 if(report==='retention'){
  const selected=await retentionRecordSelection(c,url),scope=selected.scope
  const cohort=choice(url.searchParams.get('cohort')||'all',['all','retained','new','lapsed','recaptured','upgraded','downgraded','unchanged','adjustments'] as const,'cohort')
  const kind=`CASE WHEN currentCents>0 THEN CASE WHEN priorCents>0 THEN 'retained' WHEN earlierCents>0 THEN 'recaptured' ELSE 'new' END WHEN priorCents>0 THEN 'lapsed' ELSE 'adjustments' END`
  const predicate=cohort==='all'?'1':cohort==='upgraded'||cohort==='downgraded'||cohort==='unchanged'?`kind='retained' AND currentCents${cohort==='upgraded'?'>':cohort==='downgraded'?'<':'='}priorCents`:`kind='${cohort}'`
  return {source:'report',savedId:null,timezone:scope.timezone,year:scope.year,through:scope.end,scoreCurrentSql:scope.scoreCurrentSql,reportType:'constituents',
   ctes:`config AS (SELECT timezone,name_defaults,(${scope.scoreCurrentSql})${scope.basis==='fiscal'?" AND fiscal_year_start='"+scope.monthDay+"'":''} AS selection_current FROM cf_settings WHERE id=1),
    selected_list AS (SELECT NULL AS version,NULL AS name),filters AS (SELECT '{}' AS definition),
    source_records AS MATERIALIZED (${selected.query}),
    classified AS MATERIALIZED (SELECT r.*,donorId AS donor_id,${kind} AS kind FROM source_records r),
    report_entries AS MATERIALIZED (SELECT * FROM classified WHERE ${predicate}),
    members AS MATERIALIZED (SELECT donor_id AS id FROM report_entries)`,
   params:selected.params,reportTotalsSql:"(SELECT json_object('count',count(*),'priorCents',COALESCE(SUM(priorCents),0),'currentCents',COALESCE(SUM(currentCents),0)) FROM report_entries)",
   selection:{source:'report',report,parameters:{year:scope.year,basis:scope.basis,cohort,fund:scope.fund,campaignId:scope.campaignId,list:scope.savedId?'saved:'+scope.savedId:scope.list,q:scope.q,relationship:scope.relationship,relatedTo:scope.relatedTo,volunteer:scope.volunteer}}}
 }
 if(report==='funds'||report==='states'||report==='attribution'||report==='custom-fields'||report==='honor-roll'||report==='dashboard-money'){
  const state=report==='states'?await stateRecordSelection(c,url):null
  const other=report==='dashboard-money'?await dashboardMoneySelection(c,url):report==='honor-roll'?await honorRollRecordSelection(c,url):report==='attribution'?await attributionRecordSelection(c,url):report==='custom-fields'?await customRecordSelection(c,url):null
  const s=other?{query:other.query,params:other.params,filters:other.parameters}:state?{query:state.query,params:state.params,filters:{basis:state.basis,year:state.year,fund:state.fund,campaignId:state.campaignId,formId:state.formId,channel:state.channel,solicitation:state.solicitation}}:fundRecordSelection(url)
  const dashboard=other&&'scope' in other?other:null
  const timezone=dashboard?dashboard.scope.timezone:state?state.s.timezone:String((await one(c,'SELECT timezone FROM cf_settings WHERE id=1'))!.timezone)
  const calendarCurrent=dashboard?`fiscal_year_start='${dashboard.scope.monthDay}'`:state?`fiscal_year_start='${state.s.fiscal_year_start}'`:'1'
  return {source:'report',savedId:null,timezone,year:0,through:'',scoreCurrentSql:'1',
   ctes:`config AS (SELECT timezone,name_defaults,${calendarCurrent} AS selection_current FROM cf_settings WHERE id=1),
    selected_list AS (SELECT NULL AS version,NULL AS name),filters AS (SELECT '{}' AS definition),
    report_entries AS MATERIALIZED (${s.query}),
    report_allocations AS MATERIALIZED (${report==='custom-fields'?'SELECT f.* FROM cf_fund_ledger f WHERE f.id IN(SELECT id FROM report_entries)':'SELECT * FROM report_entries'}),
    members AS MATERIALIZED (SELECT DISTINCT d.id FROM report_entries r JOIN cf_donors d ON d.id=r.donor_id
     WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`,
   params:s.params,selection:{source:'report',report,parameters:s.filters},reportType:'gifts' as const}
 }
 fail('INPUT','Choose a supported report export.',400)
}

/** Amounts follow selected movements; the original gift appears once even when
 * its payment has several allocations, reversals or provider adjustments. */
export function reportGiftRecords(query:string,currentAllocations=false) {
 const overrides:Record<string,string>={
  amount_cents:'(SELECT SUM(amount_cents) FROM report_entries e WHERE e.gift_id=r.id)',
  adjustment_cents:'(SELECT SUM(amount_cents) FROM report_entries e WHERE e.gift_id=r.id)-r.gross_cents',
  allocations:`(SELECT json_group_array(json_object('fund',a.fund,'campaign_id',a.campaign_id,'amount_cents',a.cents,'net_cents',a.cents))
   FROM (SELECT fund,campaign_id,SUM(amount_cents) AS cents FROM report_allocations WHERE gift_id=r.id GROUP BY fund,campaign_id) a)`,
 }
 if(currentAllocations)delete overrides.allocations
 return `SELECT ${exportRecords.gifts.columns.map(k=>overrides[k]?`${overrides[k]} AS ${k}`:`r.${k}`).join(',')}
  FROM (${query}) r WHERE r.id IN(SELECT gift_id FROM report_entries)`
}
