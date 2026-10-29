import { canonicalDonor } from '../donor-merge'
import { audience } from '../appeals'
import { givebutterInput } from './givebutter'
import { Buffer } from 'node:buffer'
import { customFields } from '../custom-fields'
import { manager } from '../auth'
import { all, fail, today, type Context } from '../db'
import { spreadsheetStart, spreadsheetColumns } from '../ui/spreadsheet-move-in'
import { translationLines } from './spreadsheet-mapping'
import { emptyTotals } from './source-totals'
import { readExports } from './parse-input'
import { settings } from '../settings'
import { page } from '../ui/common'
import { csv } from '../csv'
import { crmMoveInPage, crmReviewPage, crmJournalPage, reasonName } from '../ui/crm-move-in'
import { allIssues, issues, reviewed, type IssueQuery } from './review'
import * as service from './service'
import type { ParseInput, SpreadsheetMapping } from './types'

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
  if(action==='spreadsheet'&&!api)return page('Spreadsheet move-in',spreadsheetStart(await service.spreadsheetMappings(c)),c.actor,200,'/app/more')
  if(action==='source-history'&&api) {
   const donorId=await canonicalDonor(c,url.searchParams.get('donorId')||'')
   const channels=await Promise.all(['email','mail'].map(channel=>audience(c,channel as 'email'|'mail',{givenSince:null,minTotalCents:0,donorIds:[donorId]})))
   return json({inactiveContacts:await all(c,"SELECT * FROM cf_contact_points WHERE donor_id=? AND active=0 ORDER BY kind,id",donorId),outreach:{email:channels[0],mail:channels[1]},plans:await all(c,"SELECT * FROM cf_recurring_source_references WHERE donor_id=?",donorId),gifts:await all(c,"SELECT p.*,g.amount_cents,g.received_on FROM cf_platform_gifts p JOIN cf_gifts g ON g.id=p.gift_id WHERE g.donor_id=?",donorId)})
  }
  if(action==='spreadsheet-mappings'&&api)return json(await service.spreadsheetMappings(c))
  if(!action && !api)return page('Move in from your CRM',crmMoveInPage(await service.jobs(c),(await settings(c)).timezone,await customFields(c)),c.actor,200,'/app/more')
  const q:IssueQuery={severity:url.searchParams.get('show')||url.searchParams.get('severity')||undefined,code:url.searchParams.get('code')||undefined,file:url.searchParams.get('file')||undefined,page:Number(url.searchParams.get('page'))||1}
  if(action==='review' && !api) {
   const job=await reviewed(c,url.searchParams.get('id')||''), list=await issues(c,job.id,{...q,severity:q.severity??(job.report.canApply?undefined:'error')})
   return page('Review CRM move-in',crmReviewPage(job,{...list,query:{...list.query,show:q.severity??(job.report.canApply?'all':'error')}},today((await settings(c)).timezone,new Date(c.now))),c.actor,200,'/app/more')
  }
  if(action==='issues')return json(await issues(c,(await reviewed(c,url.searchParams.get('id')||'')).id,q))
  if(action==='issues.csv') {
   const job=await reviewed(c,url.searchParams.get('id')||''), rows=await allIssues(c,job.id,q)
   return new Response(csv(['File','Sheet','Row','Column','Must fix or check','Reason','What to do'],rows.map(d=>[d.file,d.sheet==='CSV'?'':d.sheet,d.row,d.column,d.severity==='error'?'Must fix':'Check',reasonName(d.code),d.message])),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="move-in-${q.severity==='error'?'rows-to-fix':'rows'}-${job.id.slice(0,8)}.csv"`}})
  }
  if(action==='journal') {const result=await service.journal(c,url.searchParams.get('id')||'');return api?json(result):page('CRM import journal',crmJournalPage(result,(await settings(c)).timezone),c.actor,200,'/app/more')}
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
  let files:ParseInput['files']=[]
  let total=0
  for(const f of (data as FormData).getAll('exports'))if(typeof f!=='string'&&f.size) {
   total+=f.size
   if(total>16*1024*1024)fail('MOVE_IN_LIMIT','All files together must be 16 MB or less. Split the gift export by year and upload constituents.csv again with each year’s file.',413)
   files.push({name:f.name,base64:Buffer.from(await f.arrayBuffer()).toString('base64')})
  }
  if(get('spreadsheetFiles')){try{files=JSON.parse(String(get('spreadsheetFiles')))}catch{fail('SPREADSHEET_MAPPING','Choose your spreadsheet again.',400)}}
  if(action==='spreadsheet/columns') {
   const parsed={files:[],diagnostics:[] as import('./types').Diagnostic[],sourceTotals:emptyTotals()},tables=await readExports(files,parsed)
   const fileError=parsed.diagnostics.find(d=>['FILE_READ','FILES'].includes(d.code))
   if(fileError)fail('SPREADSHEET_FILE',fileError.message,400)
   const saved=(await service.spreadsheetMappings(c)).find(m=>m.id===get('savedMapping'))
   const donors=await all(c,'SELECT id,name,version FROM cf_donors d WHERE erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) ORDER BY name,id')
   return page('Map spreadsheet columns',spreadsheetColumns(files,tables,donors,saved,await customFields(c)),c.actor,200,'/app/more')
  }
  const form=data as FormData,parts=(key:string)=>form.getAll(key).map(String)
  const columns=parts('customColumn'),sources=parts('customSource'),sheets=parts('customSheet'),existing=parts('customExisting'),keys=parts('customKey'),labels=parts('customLabel'),kinds=parts('customKind'),types=parts('customType'),entries=parts('customEntry'),choices=parts('customChoices')
  const mappings=columns.flatMap((column,index)=>{
   if(!existing[index]&&!keys[index])return []
   let definition:Record<string,any>
   if(existing[index]){try{definition=JSON.parse(existing[index])}catch{fail('CUSTOM_MAPPING','Choose a current custom field.',400)}}
   else definition={key:keys[index],label:labels[index],kind:kinds[index],type:types[index],entry:entries[index],choices:(choices[index]??'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean),version:0}
   return [{...definition,source:sources[index]||get('source'),column,sheet:sheets[index]||undefined}]
  })
  let spreadsheet:SpreadsheetMapping|undefined
  if(get('source')==='spreadsheet') {
   const targets=parts('mapField'),sheets=parts('mapSheet'),selected=parts('matchTarget'),donorMatches:NonNullable<SpreadsheetMapping['donorMatches']>={}
   try {
    parts('matchSource').forEach((source,i)=>{if(source&&selected[i]){if(Object.hasOwn(donorMatches,source))throw Error('Choose each source donor once.');donorMatches[source]=JSON.parse(selected[i])}})
    spreadsheet={name:String(get('mappingName')||''),recordType:get('recordType'),columns:parts('mapColumn').flatMap((column,i)=>targets[i]?[{column,field:targets[i],sheet:sheets[i]||undefined}]:[]),translations:{fund:translationLines(String(get('fundTranslations')||'')),method:translationLines(String(get('methodTranslations')||''))},donorMatches}
   }catch(error){fail('SPREADSHEET_MAPPING',error instanceof Error?error.message:'Review the spreadsheet mapping.',400)}
  }
  input={source:get('source'),...(get('sky')==='yes'?{blackbaud:{accessToken:String(get('skyAccessToken')||''),subscriptionKey:String(get('skySubscriptionKey')||'')}}:{}),...(get('source')==='neon'?{neon:{organizationId:String(get('organizationId')||''),apiKey:String(get('apiKey')||''),currency:get('neonUsd')==='USD'?'USD':undefined}}:{}),files,spreadsheet,givebutterKey:get('givebutterKey')||undefined,givebutterAmountUnit:get('givebutterAmountUnit')||undefined,noGoodsOrServices:get('noGoodsOrServices')==='yes',solicitCodes:solicitCodeLines(String(get('solicitCodes')||'')),customFields:mappings as ParseInput['customFields']}
 }
 if(action==='preview') {const result=await service.preview(c,input.source==='givebutter'&&input.givebutterKey?await givebutterInput(input):input);return api?json(result):new Response(null,{status:303,headers:{...headers,location:`/app/move-in/crm/review?id=${encodeURIComponent(result.id)}`}})}
 return fail('not_found','That move-in action does not exist.',404)
}

function solicitCodeLines(value:string):ParseInput['solicitCodes'] {
 if(!value.trim())return undefined
 const rules:NonNullable<ParseInput['solicitCodes']>={}
 for(const line of value.split(/\r?\n/).filter(s=>s.trim())) {
  const split=line.indexOf('=');if(split<1)fail('SOLICITATION_MAPPING','Write each code as code = stop, ignore, no email/mail/phone/sms, or limit 1.',400)
  const code=line.slice(0,split).trim(),answer=line.slice(split+1).trim().toLowerCase()
  if(Object.hasOwn(rules,code))fail('SOLICITATION_MAPPING','Each code must appear once.',400)
  if(answer==='stop'||answer==='ignore')rules[code]={type:answer}
  else if(/^limit [1-9]\d*$/.test(answer))rules[code]={type:'limit',maxAsks:Number(answer.slice(6))}
  else if(/^no (email|mail|phone|sms)( (email|mail|phone|sms))*$/.test(answer))rules[code]={type:'channels',channels:answer.slice(3).split(' ') as ('email'|'mail'|'phone'|'sms')[]}
  else fail('SOLICITATION_MAPPING','Use stop, ignore, no email/mail/phone/sms, or limit followed by the annual number.',400)
 }
 return rules
}
