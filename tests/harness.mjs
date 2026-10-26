import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import {unstable_splitSqlQuery} from 'wrangler'
import {build} from 'esbuild'
import {randomBytes,randomUUID} from 'node:crypto'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import assert from 'node:assert/strict'
import {verifiedMailBindings,verifiedMailOutbound} from './verified-mail-edge.mjs'
const bundles=new Map()
// `outbound` handles additional network edges; Resend remains captured in messages.
// `verifiedMail` adds only Smarty/Melissa network fakes; journeys explicitly prepare their real postal pass.
// `entry` swaps the Worker under test (tests/demo-worker.ts wraps it in withDemo); `bindings` adds or overrides vars.
export async function installation({entry='tests/worker.ts',bindings={},outbound,triggerHandlers=false,verifiedMail=false,givingProtection=Boolean(bindings.STRIPE_SECRET_KEY&&outbound)}={}) {
 // Giving fixtures connect the same required protection as a real installation.
 // Only the Turnstile network boundary is faked; requests still need its token.
 const givingToken='synthetic-coffer-security-token'
 let origin='https://127.0.0.1'
 if(givingProtection){
  const edge=outbound
  outbound=async request=>{
   if(new URL(request.url).hostname!=='challenges.cloudflare.com')return edge(request)
   const p=new URLSearchParams(await request.text())
   return Response.json({success:p.get('secret')===givingToken&&p.get('response')===givingToken,hostname:new URL(origin).hostname,action:'giving'})
  }
 }
 if(verifiedMail){bindings={...verifiedMailBindings,...bindings};outbound=verifiedMailOutbound(outbound);triggerHandlers=true}
 if(!bundles.has(entry))bundles.set(entry,build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['node:*','cloudflare:*']}))
 const bundle=await bundles.get(entry)
 const directory=await mkdtemp(join(tmpdir(),'coffer-api-')),setup=randomBytes(32).toString('hex'),messages=[]
 const secret=randomBytes(32).toString('hex')
 const options=()=>({...convertV4MiniflareOptions({unsafeTriggerHandlers:triggerHandlers,host:'127.0.0.1',port:Number(new URL(origin).port),modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['FILES'],bindings:{AUTH_ORIGIN:origin,OWNER_EMAIL:'owner@example.test',SESSION_SECRET:secret,SETUP_TOKEN:setup,MAIL_PROVIDER:'resend',MAIL_API_KEY:'test-mail-edge',MAIL_FROM:'auth@example.test',...bindings},outboundService:async request=>{if(outbound&&new URL(request.url).hostname!=='api.resend.com')return outbound(request);assert.equal(new URL(request.url).hostname,'api.resend.com');messages.push(await request.json());return Response.json({id:randomUUID()})}}),resourcePersistencePath:directory})
 const mf=new Miniflare(options())
 try {
  origin='https://'+(await mf.ready).host
  await mf.setOptions(options())
  await mf.ready
 }catch(error){await mf.dispose();await rm(directory,{recursive:true,force:true});throw error}
 try {
  const db=await mf.getD1Database('DB')
  for(const file of (await readdir('migrations/core')).filter(f=>f.endsWith('.sql')).sort())await db.batch(unstable_splitSqlQuery(await readFile(join('migrations/core',file),'utf8')).map(sql=>db.prepare(sql)))
  let owner=''
  const request=(path,{method='GET',body,raw,as=owner,headers={}}={})=>mf.dispatchFetch(origin+path,{method,redirect:'manual',headers:{origin,host:new URL(origin).host,'content-type':'application/json',...(as?{cookie:as}:{}),...headers},...(raw!==undefined?{body:raw}:body===undefined?{}:{body:JSON.stringify(body)})})
  const boot=await request('/auth/bootstrap',{method:'POST',body:{token:setup,displayName:'Morgan Lee'}});assert.equal(boot.status,303,await boot.text())
  owner=boot.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
  // Finish Base's first-run review so the owner's /app pages open.
  const firstRun=await request('/setup',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:'confirm=yes'});assert.equal(firstRun.status,303)
  const api=async(path,body,{status=200,...options}={})=>{const response=await request(path,{...(body===undefined?{}:{method:'POST',body}),...options});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value}
  const command=(command,input={},options={})=>api('/api/coffer/commands',{command,input},options)
  const get=(path,options={})=>api(path,undefined,options)
  if(givingProtection)await command('giving.protection',{siteKey:givingToken,secret:givingToken})
  const person=async(email,role='member')=>{
   // The Data & access invite form, which sends Base's invitation.
   const invited=await request('/app/people/invite',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({email,role,displayName:email.split('@')[0]}).toString()});assert.equal(invited.status,303,await invited.text())
   const message=messages.findLast(m=>JSON.stringify(m.to).includes(email));assert.ok(message,'Invitation reached mail edge')
   const match=message.text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/);assert.ok(match)
   const token=new URL(match[0]).searchParams.get('token'),confirmed=await request('/auth/confirm',{method:'POST',as:'',body:{token}});assert.equal(confirmed.status,303)
   const cookie=confirmed.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),session=await api('/auth/session',undefined,{as:cookie})
   return {cookie,id:session.operator.id,session}
  }
  return {mf,origin,owner,messages,request,api,command,get,person,verifiedMail,async replaceBindings(next){Object.assign(bindings,next);await mf.setOptions(options());await mf.ready},async close(){await mf.dispose();await rm(directory,{recursive:true,force:true})}}
 }catch(error){await mf.dispose();await rm(directory,{recursive:true,force:true});throw error}
}
export async function run(fn,options){const h=await installation(options);try{return await fn(h)}finally{await h.close()}}
export async function archive(h) {
 const {id}=await h.api('/api/portability/exports',{},{status:201})
 let state;do{state=await h.api(`/api/portability/exports/${id}/advance`,{})}while(state.phase!=='complete')
 const response=await h.request(`/api/portability/exports/${id}/download`);assert.equal(response.status,200)
 return (await response.text()).trim().split('\n').map(x=>JSON.parse(x))
}
export async function restore(h,lines,{status=200,laterJournal}={}) {
 const {id}=await h.api('/api/portability/imports',{manifest:lines[0],confirmed:true},{status:201})
 for(const part of lines.filter(x=>x.kind==='part'))await h.api(`/api/portability/imports/${id}/parts/${part.index}`,part,{method:'PUT'})
 return h.api(`/api/portability/imports/${id}/finalize`,{archiveHash:lines.at(-1).archiveHash,contentHash:lines.at(-1).contentHash,...(laterJournal?{laterJournal}:{})},{status})
}
const fixture=name=>readFile(`tests/fixtures/stripe/${name}.json`,'utf8').then(JSON.parse)
export async function stripe(){return {customers:[await fixture('customers')],charges:[await fixture('charges-2025-q4'),await fixture('charges-2026')]}}
export async function imported(h,{noGoodsOrServices=true}={}) {
 const input={...await stripe(),noGoodsOrServices},plan=await h.api('/api/coffer/imports/preview',input)
 let job=await h.api('/api/coffer/imports/apply',{...input,fingerprint:plan.fingerprint})
 while(job.state!=='completed')job=await h.api('/api/coffer/imports/resume',{id:job.id})
 return {input,plan,job}
}
export const settings={organisation:'Riverbend Literacy Project',ein:'12-3456789',timezone:'America/New_York',threshold:'250.00',targetDays:14,letterSubject:'Thank you from {{organization}}',
 letterTemplate:'{{date}}\n\nDear {{donor_name}},\n\nThank you for your gift of {{amount}} on {{gift_date}} to {{organization}}.\n\n{{goods_statement}}\n\nEIN {{ein}}.',
 noneStatement:'No goods or services were provided in exchange for this contribution.',
 goodsStatement:'You received {{goods_description}} worth {{goods_value}}; {{deductible_amount}} may be deductible.'}
export async function reviewed(h){const current=await h.get('/api/coffer/settings');return h.command('settings.update',{...settings,version:current.version})}
export const donor=(h,name,extra={},options={})=>h.command('donor.create',{name,email:`${name.toLowerCase().replace(/[^a-z]/g,'.')}@example.org`,addressLine1:'1 Main Street',city:'Springfield',region:'IL',postalCode:'62701',...extra},options)
export const csvRows=text=>text.trim().split('\r\n')
