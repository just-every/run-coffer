import { choice, fail, type Context } from './db'
import { recurringHealthSelection } from './recurring-health'
import { exportRecords } from './exports-records'
import { selectedReport } from './exports-report-records'

export async function recurringExportSelection(c:Context,url:URL,report='recurring') {
 const s=await recurringHealthSelection(c,url)
 const month=url.searchParams.get('month')||s.report.through
 const metric=choice(url.searchParams.get('metric')||'all',['all','active','new','canceled','length','unknown-start','unknown-state','failed','recovered'] as const,'recurring metric')
 const selected=s.snapshots.find(r=>r.month===month)
 if(!selected)fail('INPUT','Choose a month in the report period.',400)
 const key={all:'',active:'active',new:'new_plan',canceled:'canceled',length:'length_plan','unknown-start':'unknown_start','unknown-state':'unknown_state',failed:'failed',recovered:'recovered_payments'}[metric]
 const records=selected.records.filter(r=>key?r[key]:['active','new_plan','canceled','length_plan','unknown_start','unknown_state','failed','recovered_payments'].some(k=>r[k]))
 return selectedReport(c,report,'plans',{
  query:`SELECT ${exportRecords.plans.columns.map(k=>`json_extract(value,'$.${k}') AS ${k}`).join(',')} FROM json_each((SELECT data FROM report_input),'$.records')`,
  params:[],data:{snapshot:s.source,records,totals:selected.totals},timezone:s.report.timezone,
  current:`(${s.sourceSql})=json_extract((SELECT data FROM report_input),'$.snapshot')`,
  recordQuery:`SELECT ${exportRecords.plans.columns.map(k=>'r.'+k).join(',')} FROM report_entries r JOIN members m ON m.id=r.donor_id`,
  totals:`json_extract((SELECT data FROM report_input),'$.totals')`,
  parameters:{from:s.report.from,through:s.report.through,month,metric},
 })
}
