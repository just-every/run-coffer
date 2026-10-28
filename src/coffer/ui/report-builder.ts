import { manager } from '../auth'
import { all, choice, type Context, type Row } from '../db'
import { BUILDER_TYPES, builderFields, type Definition, type BuilderField } from '../report-builder/definition'
import { readBuilderReport } from '../report-builder/read'
import { savedReport, savedReports } from '../report-builder/store'
import { EXPORT_TYPES } from '../exports-records'
import { SOLICITATION_FILTERS } from '../solicitation-filter'
import { acknowledgmentFilterFields } from './acknowledgment-filters'
import { area, box, e, field, form, select } from './common'

const label=(key:string)=>key.replace(/_/g,' ')
function choices(title:string,name:string,fields:BuilderField[],selected:string[]) {
 return `<fieldset><legend>${e(title)}</legend><div class="fields">${fields.map(f=>`<label><input type="checkbox" name="${e(name)}" value="${e(f.key)}"${selected.includes(f.key)?' checked':''}> ${e(f.label)}</label>`).join('')}</div></fieldset>`
}
function editor(d:Definition,fields:BuilderField[],name:string,id='',version=0) {
 const filterRows=[...d.filters,{field:'',operator:'eq',value:''},{field:'',operator:'eq',value:''}]
 const ack=new URL('https://coffer.invalid');ack.search=new URLSearchParams(d.acknowledgment).toString()
 return form('report.save',`${field('Report name','name','text',name,'required maxlength="120"')}
 <div class="fields">${field('From','from','date',d.from)}${field('Through','through','date',d.through)}${select('Solicitation restriction','solicitation',SOLICITATION_FILTERS,d.solicitation)}</div>
 <details open><summary>Columns</summary>${choices('Included columns','columns',fields,d.columns)}</details>
 <details><summary>Grouping and totals</summary>${choices('Group by','groupBy',fields,d.groupBy)}${choices('Total numeric fields','totals',fields.filter(f=>f.numeric),d.totals)}</details>
 <details><summary>Record filters</summary><p>All filters must match. Money comparisons use exact cents. Custom values use their recorded types.</p>${filterRows.map((f,i)=>`<div class="fields">${select('Filter '+(i+1)+' field','filterField',[['','No filter'],...fields.map(f=>[f.key,f.label] as [string,string])],f.field)}${select('Filter '+(i+1)+' comparison','filterOperator',[['eq','Equals'],['neq','Does not equal'],['contains','Contains'],['gt','Greater than'],['gte','At least'],['lt','Less than'],['lte','At most'],['empty','Not set'],['notEmpty','Is set']],f.operator)}${field('Filter '+(i+1)+' value','filterValue','text',f.value)}</div>`).join('')}</details>
 ${d.recordType==='gifts'?`<details><summary>Gift thank-you filters</summary><div class="fields">${acknowledgmentFilterFields(ack)}</div></details>`:''}
 <p>Changing the definition clears member sharing and pauses its schedules. Review each disclosure again.</p>`,id?'Save definition':'Create report',{reportId:id,version,recordType:d.recordType})
}
function table(columns:string[],rows:Row[]) {
 if(!rows.length)return '<p>No matching records.</p>'
 return `<div class="scroll"><table class="stack"><thead><tr>${columns.map(k=>`<th>${e(label(k))}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(k=>`<td data-label="${e(label(k))}">${e(typeof row[k]==='object'&&row[k]!==null?JSON.stringify(row[k]):row[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}
export async function builderPage(c:Context,url:URL) {
 const boss=manager(c.actor),reports=await savedReports(c),id=url.searchParams.get('id')||'',r=id?await savedReport(c,id):null
 const type=r?.definition.recordType??choice(url.searchParams.get('recordType')||'gifts',BUILDER_TYPES,'record type'),fields=await builderFields(c,type)
 const list=box('Saved reports',reports.length?`<ul class="list">${reports.map(r=>`<li><a href="/app/reports/builder?id=${e(r.id)}">${e(r.name)}</a> · ${e(r.definition.recordType)}</li>`).join('')}</ul>`:'<p>No saved reports have been shared with you yet.</p>')
 if(!r){
  const d:Definition={schemaVersion:1,recordType:type,columns:type==='gifts'?['id','received_on','fund','amount_cents']:['id',fields.some(f=>f.key==='name')?'name':'donor_id'],groupBy:type==='gifts'?['fund','month']:[],totals:type==='gifts'?['amount_cents']:[],filters:[],from:'',through:'',acknowledgment:{},solicitation:''}
  return `${list}${boss?box('Build a report',`<form method="get" action="/app/reports/builder"><div class="fields">${select('Record type','recordType',BUILDER_TYPES.map(t=>[t,label(t)] as [string,string]),type)}</div><button>Choose record type</button></form>${editor(d,fields,'')}`)+box('Import a definition',`<form method="post" action="/app/actions" enctype="multipart/form-data"><input type="hidden" name="command" value="report.import">${field('Imported report name','name','text','','required maxlength="120"')}<label>Report JSON file<input type="file" name="definitionFile" accept="application/json,.json" required></label><button>Import report</button></form>`):''}`
 }
 const data=await readBuilderReport(c,url),query=new URLSearchParams({report:'builder',id:r.id})
 const results=box(r.name,`<p>${data.count} ${e(type)} · As of ${e(data.asOf)} · ${e(data.timezone)}.</p><p>${e(data.withheld.statement)}.</p>${type==='gifts'?'<p>Signed contribution cents follow ledger entry dates. Grouped funds use each allocation; each original gift appears once in the record table. Property stated value is separate from money.</p>':''}<p>${Object.entries(data.totals).map(([k,v])=>`${e(label(k))}: <strong>${e(v)}</strong>`).join(' · ')}</p>${data.definition.groupBy.length?table([...data.definition.groupBy,'count',...data.definition.totals],data.groups):''}${table(data.definition.columns,data.rows)}`)
 if(!boss)return list+results
 const shares=await all(c,'SELECT s.*,o.display_name FROM cf_report_shares s LEFT JOIN oa_operators o ON o.id=s.operator_id WHERE report_id=?',r.id),members=await all(c,"SELECT id,display_name FROM oa_operators WHERE status='active' AND role IN ('owner','admin','member') ORDER BY display_name")
 const downloads=box('Download report records',`<p><a href="/app/report-exports">Export records from other reports</a></p><p><a href="?id=${e(r.id)}&download=csv">Download CSV</a> · <a href="?id=${e(r.id)}&download=xlsx">Download Excel</a> · <a href="?id=${e(r.id)}&download=json">Export JSON definition</a></p><p>Download another record type: ${EXPORT_TYPES.map(t=>`<a href="/api/coffer/exports/${t}.csv?${e(query.toString())}">${e(t)} CSV</a>`).join(' · ')}.</p><p>Other record types include lifetime history for the report’s constituents. Downloads exclude confidential notes, credentials and payment details.</p>`)
 const settings=box('Report settings',form('report.share',select('Member','operatorId',members.map(o=>[o.id,o.display_name] as [string,string]),'','aria-label="Member"')+'<label><input type="checkbox" name="reviewed" value="yes" required> I approve disclosure of this definition and its current report to this member.</label>','Share report',{reportId:r.id,version:r.version})+shares.map(s=>`<p>Shared with ${e(s.display_name??'Former member')}.</p>${form('report.revoke','','Revoke sharing',{reportId:r.id,version:r.version,operatorId:s.operator_id})}`).join('')+`<p><a href="/app/report-schedules?reportPath=${encodeURIComponent('/app/reports/builder?id='+r.id)}">Schedule this report</a></p>`,'report-settings')
 return `${list}${results}${downloads}${box('Edit definition',editor(r.definition,fields,r.name,r.id,r.version))}${settings}`
}
