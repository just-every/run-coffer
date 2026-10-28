import { all, fail, integer, type Context, type Row } from '../db'
import { exportRecords, recordJson } from '../exports-records'
import { reportGiftRecords } from '../exports-report'
import { personNames } from '../person-names'
import { savedBuilderRecordSelection } from '../report-builder-selection'
import { dateField, fieldSql, valueOf } from './definition'
import { savedReport } from './store'

export async function readBuilderReport(c:Context,url:URL) {
 const saved=await savedReport(c,url.searchParams.get('id')||''),d=saved.definition,s=await savedBuilderRecordSelection(c,url),spec=exportRecords[d.recordType]
 const raw=d.recordType==='gifts'?reportGiftRecords(spec.query):`SELECT * FROM (${spec.query}) WHERE id IN(SELECT id FROM report_entries)`
 const base=`WITH ${s.ctes},records AS MATERIALIZED (SELECT base.*,substr(base.${dateField[d.recordType]},1,7) AS month FROM (${raw}) base)`
 const groupKeys=d.groupBy.map((key,i)=>`${d.recordType==='gifts'&&['fund','month','received_on'].includes(key)?'entry.'+key:fieldSql(key)} AS g${i}`)
 const perRecord=d.totals.map((key,i)=>`${d.recordType==='gifts'&&key==='amount_cents'?'SUM(entry.amount_cents)':`MAX(CAST(${fieldSql(key)} AS NUMERIC))`} AS v${i}`)
 const keys=d.groupBy.map((_,i)=>'g'+i)
 const groupQuery=`SELECT ${[...keys,...d.totals.map((_,i)=>`SUM(v${i}) AS t${i}`),'COUNT(*) AS record_count'].join(',')} FROM (
  SELECT r.id,${[...groupKeys,...perRecord,'1 AS included'].join(',')} FROM records r ${d.recordType==='gifts'?'JOIN report_entries entry ON entry.gift_id=r.id':'JOIN report_entries entry ON entry.id=r.id'} GROUP BY r.id${keys.length?','+keys.join(','):''}) ${keys.length?'GROUP BY '+keys.join(','):''}`
 const data=await all(c,`${base} SELECT 'record' AS row_kind,${recordJson(d.recordType)} AS data,(SELECT name_defaults FROM config) AS name_defaults FROM records r
  UNION ALL SELECT 'group',json_object(${[...d.groupBy.flatMap((key,i)=>["'"+key+"'",'g'+i]),...d.totals.flatMap((key,i)=>["'"+key+"'",'t'+i]),"'count'",'record_count'].join(',')}),NULL FROM (${groupQuery})
  UNION ALL SELECT 'meta',json_object('current',selection_current,'withheld',(SELECT COUNT(*) FROM cf_donor_notes n JOIN members m ON m.id=n.donor_id WHERE n.confidential=1)),NULL FROM config`,...s.params)
 if(!JSON.parse(data.find(r=>r.row_kind==='meta')?.data||'{}').current)fail('REPORT_CHANGED','The saved definition changed. Refresh the report.',409)
 const records:Row[]=data.filter(r=>r.row_kind==='record').map(r=>{
  const row=JSON.parse(r.data);row.month=String(row[({constituents:'created_at',gifts:'received_on',pledges:'pledged_on',opportunities:'expected_close_on',interactions:'occurred_on'} as const)[d.recordType]]??'').slice(0,7)
  if(d.recordType==='constituents'){const n=personNames({...row,name_defaults:r.name_defaults});row.computed_informal_salutation=n.informal;row.computed_formal_salutation=n.formal;row.computed_envelope_name=n.envelope}
  return row
 })
 if(records.length>10000)fail('EXPORT_TOO_LARGE',`This report contains ${records.length} records. Narrow its filters.`,413)
 const groups:Row[]=data.filter(r=>r.row_kind==='group').map(r=>JSON.parse(r.data))
 const totals:Row=Object.fromEntries(d.totals.map(key=>[key,sum(records.map(r=>valueOf(r,key)))]))
 // Every result, grouped figure and selected export comes from the same unpaged statement.
 const current=await savedReport(c,saved.id)
 if(current.version!==saved.version)fail('REPORT_CHANGED','This report changed. Refresh before reading it.',409)
 const withheld=Number(JSON.parse(data.find(r=>r.row_kind==='meta')!.data).withheld)
 return {id:saved.id,name:saved.name,version:saved.version,definition:d,asOf:c.now,timezone:s.timezone,count:records.length,withheld:{confidentialStaffNotes:withheld,statement:`${withheld} confidential staff notes withheld`},totals,groups,rows:records.map(r=>Object.fromEntries(d.columns.map(key=>[key,valueOf(r,key)])))}
}
function sum(values:unknown[]) {
 if(values.some(v=>v!==null&&v!==''&&!Number.isFinite(Number(v))))fail('REPORT_AMOUNT','A total contains a nonnumeric value.',400)
 const whole=values.every(v=>v===null||Number.isSafeInteger(Number(v)))
 if(whole){const n=values.reduce<bigint>((total,v)=>total+BigInt(String(v??0)),0n);return integer(Number(n),'Report total',-Number.MAX_SAFE_INTEGER)}
 const n=values.reduce<number>((total,v)=>total+Number(v??0),0);if(!Number.isFinite(n))fail('REPORT_AMOUNT','The total is outside the numeric range.',400);return n
}
