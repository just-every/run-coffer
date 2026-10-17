import { Buffer } from 'node:buffer'
import { manager } from '../auth'
import { fail, type Context } from '../db'
import { page } from '../ui/common'
import { crmMoveInPage, crmPreviewPage, crmJournalPage } from '../ui/crm-move-in'
import * as service from './service'
import type { ParseInput } from './types'

type Readers={jsonBody:(request:Request,limit:number)=>Promise<any>;formBody:(request:Request,limit:number)=>Promise<FormData>}
const headers={'cache-control':'no-store','x-content-type-options':'nosniff'}
const json=(body:unknown)=>Response.json(body,{headers})
const redirect=(id:string)=>new Response(null,{status:303,headers:{...headers,location:`/app/move-in/crm/journal?id=${encodeURIComponent(id)}`}})
export async function crmMoveInResponse(request:Request,c:Context,readers:Readers):Promise<Response|null> {
 const url=new URL(request.url),api=url.pathname.startsWith('/api/coffer/move-in/'),base=api?'/api/coffer/move-in':'/app/move-in/crm'
 if(!api && url.pathname!==base && !url.pathname.startsWith(base+'/'))return null
 if(!manager(c.actor))fail('manager_required','Only the owner or an admin moves records in.',403)
 const action=url.pathname.slice(base.length+1)
 if(request.method==='GET') {
  if(!action && !api)return page('Move in from your CRM',crmMoveInPage(await service.jobs(c)),c.actor,200,'/app/more')
  if(action==='journal') {const result=await service.journal(c,url.searchParams.get('id')||'');return api?json(result):page('CRM import journal',crmJournalPage(result),c.actor,200,'/app/more')}
 }
 if(request.method!=='POST')fail('post_required','Use the move-in forms.',405)
 const data=api?await readers.jsonBody(request,24*1024*1024):await readers.formBody(request,24*1024*1024)
 const get=(key:string)=>api?data[key]:data.get(key), id=String(get('id')||'')
 if(action==='undo') {const result=await service.undo(c,id);return api?json(result):redirect(result.id)}
 if(action==='continue') {const result=await service.continueApply(c,id);return api?json(result):redirect(result.id)}
 if(action==='check') {const result=await service.recheck(c,id);return api?json(result):redirect(result.id)}
 if(action==='apply') {
  if(!api && get('confirm')!=='yes')fail('confirmation_required','Tick the box to approve the reviewed move-in first.',400)
  const result=await service.apply(c,{id,fingerprint:String(get('fingerprint')||''),acceptedReason:get('acceptedReason')||undefined,acknowledged:get('acknowledged')||undefined,acknowledgedBefore:get('acknowledgedBefore')||undefined})
  return api?json(result):redirect(result.id)
 }
 let input:ParseInput
 if(api)input=data
 else {
  const files=[]
  let total=0
  for(const f of (data as FormData).getAll('exports'))if(typeof f!=='string'&&f.size) {
   total+=f.size
   if(total>16*1024*1024)fail('MOVE_IN_LIMIT','All files together must be 16 MB or less. Split the gift export by year and upload constituents.csv again with each year’s file.',413)
   files.push({name:f.name,base64:Buffer.from(await f.arrayBuffer()).toString('base64')})
  }
  input={source:get('source'),files,noGoodsOrServices:get('noGoodsOrServices')==='yes'}
 }
 if(action==='preview') {const result=await service.preview(c,input);return api?json(result):page('Review CRM move-in',crmPreviewPage(result,c.now.slice(0,10)),c.actor,200,'/app/more')}
 return fail('not_found','That move-in action does not exist.',404)
}
