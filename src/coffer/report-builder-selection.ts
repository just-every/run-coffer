import { constituentReportNames } from './report-builder/constituent-names'
import { acknowledgmentPredicate } from './acknowledgment-filters'
import { one, today, type Context } from './db'
import { exportRecords } from './exports-records'
import type { ExportSelection } from './exports-selection'
import { solicitationFilterSql } from './solicitation-filter'
import { dateField, fieldSql } from './report-builder/definition'
import { savedReport } from './report-builder/store'

export async function savedBuilderRecordSelection(c:Context,url:URL):Promise<ExportSelection> {
 const report=await savedReport(c,url.searchParams.get('id')||''),d=report.definition
 const timezone=String((await one(c,'SELECT timezone FROM cf_settings WHERE id=1'))!.timezone),day=today(timezone,new Date(c.now))
 const names=d.recordType==='constituents'?await constituentReportNames(c):null
 const params:unknown[]=[report.id,report.version,...(names?.params??[])],clauses:string[]=[],periodClauses:string[]=[],periodParams:unknown[]=[],recordParams:unknown[]=[]
 const gift=d.recordType==='gifts',donor=d.recordType==='constituents'?'r.id':'r.donor_id'
 // Money predicates use the same selected ledger movements as displayed rows,
 // including fund selection and reversals inside (but never after) the period.
 const periodAmount='(SELECT SUM(amount_cents) FROM builder_period_entries e WHERE e.gift_id=r.id)'
 const expr=(key:string)=>gift&&['fund','received_on','month'].includes(key)?`l.${key}`:gift&&key==='amount_cents'?periodAmount:gift&&key==='adjustment_cents'?`(${periodAmount}-r.gross_cents)`:fieldSql(key)
 const dated=gift?'l.received_on':`substr(r.${dateField[d.recordType]},1,10)`
 const dateClauses=gift?periodClauses:clauses,dateParams=gift?periodParams:recordParams
 if(d.from){dateClauses.push(dated+'>=?');dateParams.push(d.from)}
 if(d.through){dateClauses.push(dated+'<=?');dateParams.push(d.through)}
 const operators:Record<string,string>={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}
 for(const f of d.filters){
  const column=expr(f.field)
  const movement=gift&&['fund','received_on','month'].includes(f.field),target=movement?periodClauses:clauses,values=movement?periodParams:recordParams
  if(f.operator==='empty'||f.operator==='notEmpty')target.push(`COALESCE(${column},'')${f.operator==='empty'?'=':'<>'}''`)
  else if(f.operator==='contains'){target.push(`instr(lower(CAST(${column} AS TEXT)),lower(?))>0`);values.push(f.value)}
  else{target.push(`${typeof f.value==='number'?`CAST(${column} AS NUMERIC)`:column}${operators[f.operator]}?`);values.push(f.value)}
 }
 if(d.solicitation)clauses.push(solicitationFilterSql(donor,`'${d.solicitation}'`,`'${day}'`))
 if(gift){const u=new URL(url);u.search=new URLSearchParams(d.acknowledgment).toString();const ack=acknowledgmentPredicate(u,'l.gift_id');clauses.push(ack.sql);recordParams.push(...ack.params)}
 params.push(...periodParams,...recordParams)
 const spec=exportRecords[d.recordType],query=spec.query.replaceAll('JOIN members m','JOIN builder_population m'),base=names?names.project(query):query
 const records=`SELECT base.*,substr(base.${dateField[d.recordType]},1,7) AS month${d.recordType==='constituents'?',base.id AS donor_id':''} FROM (${base}) base`
 const periodEntries=`SELECT l.* FROM (SELECT f.id,f.gift_id,f.donor_id,f.received_on,f.fund,f.campaign_id,f.amount_cents,substr(f.received_on,1,7) AS month FROM cf_fund_ledger f UNION ALL SELECT id,id,donor_id,received_on,fund,NULL,0,substr(received_on,1,7) FROM cf_in_kind_current) l WHERE ${periodClauses.join(' AND ')||'1'}`
 const entries=gift?`SELECT l.* FROM builder_period_entries l JOIN builder_records r ON r.id=l.gift_id WHERE ${clauses.join(' AND ')||'1'}`:`SELECT r.* FROM builder_records r WHERE ${clauses.join(' AND ')||'1'}`
 return {source:'report',savedId:null,timezone,year:0,through:d.through,scoreCurrentSql:'1',reportType:d.recordType,
  ctes:`config AS (SELECT timezone,name_defaults,EXISTS(SELECT 1 FROM cf_saved_reports WHERE id=? AND version=?)${names?' AND '+names.guard:''} AS selection_current FROM cf_settings WHERE id=1),
   ${names?.ctes??''}
   selected_list AS (SELECT NULL AS name,NULL AS version),filters AS (SELECT '{}' AS definition),
   builder_population AS MATERIALIZED (SELECT id FROM cf_donors d WHERE erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)),
   builder_records AS MATERIALIZED (${records}),${gift?`builder_period_entries AS MATERIALIZED (${periodEntries}),`:''}report_entries AS MATERIALIZED (${entries}),
   ${gift?'report_allocations AS MATERIALIZED (SELECT * FROM report_entries),':''}
   members AS MATERIALIZED (SELECT DISTINCT donor_id AS id FROM report_entries)`,params,
  selection:{source:'report',report:'builder',parameters:{id:report.id,version:report.version,recordType:d.recordType,from:d.from,through:d.through}},
  reportTotalsSql:gift?"(SELECT json_object('amount_cents',COALESCE(SUM(amount_cents),0),'count',COUNT(DISTINCT gift_id)) FROM report_entries)":undefined}
}
