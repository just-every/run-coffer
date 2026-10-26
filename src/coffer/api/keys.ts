import { digest, identity, requireRole, type Authority } from '../auth'
import { all, choice, commit, date, event, fail, id, newId, one, sql, text, type Context, type Row } from '../db'
import { runtimeBindings, type Bindings } from '../../auth.server'

export const API_SCOPES = ['read-only','gift-entry','full'] as const
export type ApiScope = typeof API_SCOPES[number]
const TOKEN = /^Bearer cfv1_[A-Za-z0-9_-]{43}$/
const currentKey = `EXISTS(SELECT 1 FROM cf_api_keys k JOIN oa_operators o ON o.id=k.created_by
 WHERE k.id=? AND k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>MAX(?,unixepoch('now')*1000)
 AND o.status='active' AND o.version=k.creator_version AND o.role IN ('owner','admin'))`

/** No caller can mint another key with a key, including a full public key. */
export async function apiKeyCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(!['apiKey.create','apiKey.revoke'].includes(command))return undefined
 requireRole(c.actor,['owner','admin'],'manage public API keys')
 if(c.actor.apiKey)fail('SESSION_REQUIRED','Use your signed-in session to manage public API keys.',403)
 if(command==='apiKey.revoke'){
  const keyId=id(p.id,'API key')
  if(!await one(c,'SELECT id FROM cf_api_keys WHERE id=?',keyId))fail('NOT_FOUND','That API key does not exist.',404)
  await commit(c,[sql('UPDATE cf_api_keys SET revoked_at=COALESCE(revoked_at,?),revoked_by=COALESCE(revoked_by,?) WHERE id=?',Date.now(),c.actor.id,keyId),event(c,command,'apiKey',keyId,null)])
  return {id:keyId,revoked:true}
 }
 const label=text(p.label,'API key label',100),scope=choice(p.scope,API_SCOPES,'API key scope'),now=Date.now()
 const expiresAt=p.expiresOn?Date.parse(date(p.expiresOn,'Expiry date')+'T23:59:59.999Z'):now+30*86400000
 if(expiresAt<=now||expiresAt>now+90*86400000)fail('INPUT','Choose a future expiry within 90 days.',400)
 const token='cfv1_'+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
 const keyId=newId()
 await commit(c,[sql(`INSERT INTO cf_api_keys(id,token_hash,label,scope,created_by,creator_version,created_at,expires_at)
 SELECT ?,?,?,?,id,version,?,? FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')`,keyId,await digest(token),label,scope,now,expiresAt,c.actor.id),event(c,command,'apiKey',keyId,null,{scope,expiresAt})])
 return {id:keyId,label,scope,token,expiresAt}
}

export async function keyState(c:Context){
 requireRole(c.actor,['owner','admin'],'review public API keys')
 if(c.actor.apiKey)fail('SESSION_REQUIRED','Use your signed-in session to review public API keys.',403)
 const keys=await all(c,`SELECT k.id,k.label,k.scope,k.created_by,k.created_at,k.expires_at,k.revoked_at,
 CASE WHEN k.revoked_at IS NULL AND k.expires_at>MAX(?,unixepoch('now')*1000) AND o.version=k.creator_version AND o.status='active' AND o.role IN ('owner','admin') THEN 1 ELSE 0 END AS usable
 FROM cf_api_keys k JOIN oa_operators o ON o.id=k.created_by ORDER BY k.created_at DESC,k.id`,Date.now())
 await commit(c,[event(c,'api.keysRead','apiKey','keys',null,{},'cf_access_events')])
 return {keys}
}

export async function apiIdentity(request:Request,original:Bindings):Promise<{context:Context;scope:ApiScope;bearer:boolean;principal:string}>{
 const env=runtimeBindings(original),header=request.headers.get('authorization')
 if(header?.startsWith('Bearer cfv1_')){
  if(!TOKEN.test(header))fail('INVALID_API_KEY','Supply a valid public API key.',401)
  const hash=await digest(header.slice(7)),now=Date.now()
  const key=await one<{id:string;label:string;scope:ApiScope;created_by:string;display_name:string;role:'owner'|'admin'}>({db:env.DB},`SELECT k.id,k.label,k.scope,k.created_by,o.display_name,o.role FROM cf_api_keys k JOIN oa_operators o ON o.id=k.created_by WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>MAX(?,unixepoch('now')*1000) AND o.status='active' AND o.version=k.creator_version AND o.role IN ('owner','admin')`,hash,now)
  if(!key)fail('INVALID_API_KEY','This public API key is unknown, expired or revoked.',401)
  const authority:Authority={sql:currentKey+' AND EXISTS(SELECT 1 FROM cf_api_keys WHERE id=? AND scope=?)',params:[key.id,hash,now,key.id,key.scope]}
  return {context:{db:env.DB,env,now:new Date().toISOString(),actor:{id:key.created_by,name:key.display_name+' (API: '+key.label+')',role:key.role,apiKey:{id:key.id,scope:key.scope}},authority},scope:key.scope,bearer:true,principal:'key:'+key.id}
 }
 const auth=await identity(request,env)
 if(auth.actor.role==='agent')fail('FORBIDDEN','Agent preparation credentials cannot use the public API. Use the granted agent door.',403)
 return {context:{db:env.DB,env,now:new Date().toISOString(),actor:auth.actor,authority:auth.authority},scope:'full',bearer:false,principal:'operator:'+auth.actor.id}
}
