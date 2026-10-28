import { retentionRecordSelection, retentionMetricSelection } from './retention'
import { retentionScope } from './retention-scope'
import { choice, type Context } from './db'
import type { ExportSelection } from './exports-selection'
import { selectedReport } from './exports-report-records'

export async function retentionExportSelection(c:Context,url:URL):Promise<ExportSelection> {
 const metric=choice(url.searchParams.get('metric')||'cohorts',['cohorts','recognition','excluded','ledger'] as const,'retention metric')
 if(metric!=='cohorts'){
  const scope=await retentionScope(c,url),source=retentionMetricSelection(scope,metric)
  const recognition=metric==='recognition'
  return selectedReport(c,'retention',recognition?'constituents':'gifts',{
   query:recognition?`SELECT donorId AS donor_id,r.* FROM (${source.query}) r`:source.query,
   params:source.params,timezone:scope.timezone,current:`(${scope.scoreCurrentSql})${scope.basis==='fiscal'?" AND fiscal_year_start='"+scope.monthDay+"'":''}`,
   parameters:{year:scope.year,basis:scope.basis,metric,fund:scope.fund,campaignId:scope.campaignId,list:scope.savedId?'saved:'+scope.savedId:scope.list,q:scope.q,relationship:scope.relationship,relatedTo:scope.relatedTo,volunteer:scope.volunteer},
   totals:recognition?"(SELECT json_object('count',count(*),'priorCents',COALESCE(SUM(priorCents),0),'currentCents',COALESCE(SUM(currentCents),0),'creditCount',COALESCE(SUM(creditCount),0)) FROM report_entries)":
    `(SELECT json_object('priorCents',COALESCE(SUM(CASE WHEN received_on<'${scope.start}' THEN amount_cents ELSE 0 END),0),'currentCents',COALESCE(SUM(CASE WHEN received_on>='${scope.start}' THEN amount_cents ELSE 0 END),0)) FROM report_entries)`,
  })
 }
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
   selection:{source:'report',report:'retention',parameters:{year:scope.year,basis:scope.basis,cohort,fund:scope.fund,campaignId:scope.campaignId,list:scope.savedId?'saved:'+scope.savedId:scope.list,q:scope.q,relationship:scope.relationship,relatedTo:scope.relatedTo,volunteer:scope.volunteer}}}
}
