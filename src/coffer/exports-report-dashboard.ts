import { choice, type Context } from './db'
import { dashboardScope, dashboardLedgerSelection, dashboardMoneySelection } from './dashboard-ledger'
import { retentionRecordSelection } from './retention'
import { prospectRecordSelection } from './major-gifts'
import { retentionExportSelection } from './exports-report-retention'
import { recurringExportSelection } from './exports-report-recurring'
import { selectedReport } from './exports-report-records'

export async function dashboardExportSelection(c:Context,url:URL) {
 const metric=choice(url.searchParams.get('metric')||'money',['money','cohorts','new-donor-money','recurring','pipeline'] as const,'dashboard metric')
 const scope=await dashboardScope(c,url),query=new URL(url)
 query.search='';query.searchParams.set('year',String(scope.year));query.searchParams.set('basis','fiscal')
 const current=`fiscal_year_start='${scope.monthDay}'`
 if(metric==='cohorts'){
  query.searchParams.set('cohort',url.searchParams.get('cohort')||'all')
  const s=await retentionExportSelection(c,query)
  s.selection={source:'report',report:'dashboard',parameters:{year:scope.year,metric,cohort:query.searchParams.get('cohort')}}
  return s
 }
 if(metric==='recurring'){
  query.searchParams.set('from',scope.start.slice(0,7));query.searchParams.set('through',scope.end.slice(0,7))
  for(const key of ['month','metric'])query.searchParams.delete(key)
  if(url.searchParams.has('month'))query.searchParams.set('month',url.searchParams.get('month')!)
  query.searchParams.set('metric',url.searchParams.get('recurringMetric')||'all')
  const s=await recurringExportSelection(c,query,'dashboard')
  s.ctes=s.ctes.replace(' AS selection_current',` AND ${current} AS selection_current`)
  s.selection.parameters={...s.selection.parameters,year:scope.year,metric,recurringMetric:query.searchParams.get('metric')}
  return s
 }
 if(metric==='pipeline'){
  const source=prospectRecordSelection()
  return selectedReport(c,'dashboard','opportunities',{
   ...source,timezone:scope.timezone,current,parameters:{year:scope.year,metric},
   totals:`(SELECT json_object('opportunities',COUNT(*),'open',COALESCE(SUM(closed_on IS NULL),0),
    'askCents',COALESCE(SUM(CASE WHEN closed_on IS NULL THEN ask_amount_cents ELSE 0 END),0),
    'expectedCents',COALESCE(SUM(CASE WHEN closed_on IS NULL THEN expected_amount_cents ELSE 0 END),0),
    'forecastCents',COALESCE(SUM(CASE WHEN closed_on IS NULL THEN (expected_amount_cents*probability_percent+50)/100 ELSE 0 END),0)) FROM report_entries)`,
  })
 }
 if(metric==='money'){
  const source=await dashboardMoneySelection(c,url)
  return selectedReport(c,'dashboard','gifts',{...source,timezone:scope.timezone,current,parameters:{...source.parameters,metric}})
 }
 const cohort=await retentionRecordSelection(c,query),ledger=dashboardLedgerSelection(scope.start,scope.end,url)
 return selectedReport(c,'dashboard','gifts',{
  query:`WITH cohorts AS MATERIALIZED (${cohort.query}) SELECT l.* FROM (${ledger.query}) l
   WHERE l.donor_name IS NOT NULL AND l.donor_id IN(SELECT donorId FROM cohorts WHERE currentCents>0 AND priorCents<=0 AND earlierCents<=0)`,
  params:[...cohort.params,...ledger.params],timezone:scope.timezone,current,
  parameters:{year:scope.year,metric,...ledger.parameters},
 })
}
