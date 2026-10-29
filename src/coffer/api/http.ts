import { runtimeBindings, type Bindings } from '../../auth.server'
import { originGuard } from '../auth'
import { CofferError, commit, event, fail, object, type Context, type Row } from '../db'
import { apiIdentity, apiKeyCommand, keyState } from './keys'
import { readResource } from './reads'
import { writeOperation, writeScope, prepareWrite } from './writes'
import { idempotentWrite, rateLimit, RATE_LIMIT } from './transaction'
import { openApiDocument } from './openapi'
import { apiAuditPath } from './custody'
import { completeNativeEffects } from './effects'
import { verifyWebhookReceipt } from './webhook-receipt'

const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-coffer-api-version':'1','x-ratelimit-limit':String(RATE_LIMIT)}
const json=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{...headers,...extra}})
const PREFIX='/api/coffer/v1'
async function input(request:Request):Promise<Row>{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))fail('JSON_REQUIRED','Send application/json.',415)
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0
 if(reader)try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)fail('BODY_TOO_LARGE','API JSON is limited to 64 KiB.',413);chunks.push(part.value)}}finally{await reader.cancel();reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)))}catch(error){if(error instanceof CofferError)throw error;return fail('INVALID_JSON','Send a JSON object.',400)}
}

/** Called before the legacy bearer-agent dispatcher. Captures the exact
 * authority that produced this response for the shared request audit. */
export async function restApiResponse(request:Request,original:Bindings):Promise<{response:Response;context?:Context}|null>{
 const url=new URL(request.url)
 if(url.pathname!==PREFIX&&!url.pathname.startsWith(PREFIX+'/'))return null
 let c:Context|undefined
 try{
  const env=runtimeBindings(original)
  originGuard(request,env,true)
  if(request.headers.has('origin')&&request.headers.get('origin')!==env.AUTH_ORIGIN)fail('INVALID_ORIGIN','This API request came from another origin.',403)
  const auth=await apiIdentity(request,env);c=auth.context
  originGuard(request,env,auth.bearer)
  await rateLimit(c,auth.principal)
  const path=url.pathname.slice(PREFIX.length)||'/'
  if(path==='/keys'||/^\/keys\/[^/]+\/revoke$/.test(path)){
   if(auth.bearer)fail('SESSION_REQUIRED','Use your signed-in owner or admin session to manage API keys.',403)
   if(path==='/keys'&&request.method==='GET')return {response:json(await keyState(c)),context:c}
   if(path==='/keys'&&request.method==='POST')return {response:json(await apiKeyCommand(c,'apiKey.create',await input(request)),201),context:c}
   if(request.method==='POST'&&path.endsWith('/revoke'))return {response:json(await apiKeyCommand(c,'apiKey.revoke',{id:decodeURIComponent(path.split('/')[2])})),context:c}
   fail('METHOD_NOT_ALLOWED','Use a documented API key method.',405)
  }
  if(path==='/webhook-receipts/verify'&&request.method==='POST')return {response:json(await verifyWebhookReceipt(c,auth.scope,await input(request))),context:c}
  if(request.method==='GET'){
   const result=path==='/openapi.json'?openApiDocument(url.origin):await readResource(c,auth.scope,path,url)
   if(!result)fail('NOT_FOUND','That API resource does not exist.',404)
   await commit(c,[event(c,'api.read','route',apiAuditPath(url),null,{},'cf_access_events')])
   return {response:json(result),context:c}
  }
  if(!['POST','PUT'].includes(request.method))fail('METHOD_NOT_ALLOWED','Use a documented API method.',405)
  const body=await input(request),operation=writeOperation(request.method,path,body)
  if(!operation)fail('OPERATION_FORBIDDEN','This operation is outside the public API allowlist.',403)
  writeScope(auth.scope,operation)
  const saved=await idempotentWrite(c,request,auth.principal,body,staged=>prepareWrite(staged,operation))
  await completeNativeEffects(c,operation,saved.result.id)
  return {response:json(saved.result,200,{'idempotency-replayed':String(saved.replayed)}),context:c}
 }catch(error){
  if(error instanceof CofferError)return {response:json({error:error.code,message:error.message},error.status,error.status===429?{'retry-after':String(60-Math.floor(Date.now()/1000)%60)}:{}),context:c}
  throw error
 }
}
