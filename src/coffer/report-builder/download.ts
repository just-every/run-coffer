import { requireRole } from '../auth'
import { csv } from '../csv'
import { commit, event, fail, type Context } from '../db'
import { readBuilderReport } from './read'
import { savedReport } from './store'
import { workbook } from './workbook'

const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}
export async function builderDownload(c:Context,url:URL):Promise<Response|null> {
 const format=url.searchParams.get('download');if(!format)return null
 requireRole(c.actor,['owner','admin'],'export saved reports')
 const saved=await savedReport(c,url.searchParams.get('id')||'')
 if(format==='json'){
  await commit(c,[event(c,'report.definitionExport','saved_report',saved.id,null,{version:saved.version})])
  return new Response(JSON.stringify({format:'coffer-report',name:saved.name,definition:saved.definition},null,2),{headers:{...headers,'content-type':'application/json','content-disposition':'attachment; filename="coffer-report-definition.json"'}})
 }
 if(!['csv','xlsx'].includes(format))fail('INPUT','Choose CSV, Excel or JSON.',400)
 const data=await readBuilderReport(c,url),columns=data.definition.columns,rows=data.rows.map(r=>columns.map(k=>{
  const v=r[k];return v&&typeof v==='object'?JSON.stringify(v):v
 }))
 const body=format==='csv'?csv(columns,rows):workbook(columns,rows)
 if((typeof body==='string'?new TextEncoder().encode(body).length:body.length)>4*1024*1024)fail('EXPORT_TOO_LARGE','This report is too large for one download. Narrow its filters.',413)
 await commit(c,[event(c,'export.'+format,'saved_report',data.id,null,{source:'report',recordType:data.definition.recordType,selection:{report:'builder',parameters:{id:data.id,version:data.version,from:data.definition.from,through:data.definition.through}},rowCount:data.count,asOf:data.asOf,...data.withheld})])
 const name=`coffer-report-builder-${data.id}-v${data.version}-${data.definition.from||'all'}-${data.definition.through||'all'}-report-records-${data.asOf.replace(/[:.]/g,'-')}.${format}`
 return new Response(body as BodyInit,{headers:{...headers,'content-type':format==='csv'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="${name}"`,'x-coffer-row-count':String(data.count),'x-coffer-withheld':data.withheld.statement}})
}
