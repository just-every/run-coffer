import { retentionExportSelection } from './exports-report-retention'
import { taxExportSelection } from './exports-report-tax'
import { restrictionExportSelection } from './exports-report-restrictions'
import { recurringExportSelection } from './exports-report-recurring'
import { dashboardExportSelection } from './exports-report-dashboard'
import { savedBuilderRecordSelection } from './report-builder-selection'
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
 if(report==='builder')return savedBuilderRecordSelection(c,url)
 if(report==='retention')return retentionExportSelection(c,url)
 if(report==='tax')return taxExportSelection(c,url)
 if(report==='restrictions')return restrictionExportSelection(c,url)
 if(report==='recurring')return recurringExportSelection(c,url)
 if(report==='dashboard')return dashboardExportSelection(c,url)
 if(report==='funds'||report==='states'||report==='attribution'||report==='custom-fields'||report==='honor-roll'||report==='dashboard-money'){
  const state=report==='states'?await stateRecordSelection(c,url):null
  const other=report==='dashboard-money'?await dashboardMoneySelection(c,url):report==='honor-roll'?await honorRollRecordSelection(c,url):report==='attribution'?await attributionRecordSelection(c,url):report==='custom-fields'?await customRecordSelection(c,url):null
  const s=other?{query:other.query,params:other.params,filters:other.parameters}:state?{query:state.query,params:state.params,filters:state.parameters}:fundRecordSelection(url)
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
