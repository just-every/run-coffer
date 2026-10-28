import { requireRole } from '../auth'
import { choice, commit, event, fail, guard, newId, one, sha256, sql, text, type Context, type Row } from '../db'
import { openGiving, sealGiving } from '../giving/connections'
import type { GivingEnv } from '../giving/stripe'
import { authorizeUrl, base64url, profile, providers, scopes, token, type Provider } from './provider'

export const mailboxRole=(c:Context)=>requireRole(c.actor,['owner','admin'],'use personal mailboxes')
export const providerChoice=(value:unknown)=>choice(value,providers,'mailbox provider')
const appName=(p:Provider)=>'mailbox-app:'+p
const appRow=(c:Context,p:Provider)=>one(c,'SELECT sealed FROM cf_giving_connections WHERE name=?',appName(p))
const callback=(c:Context,p:Provider)=>new URL('/app/settings/mailboxes/'+p+'/callback',c.env!.AUTH_ORIGIN).href
const cryptEnv=(c:Context)=>c.env as GivingEnv
export async function mailboxState(c:Context) {
 mailboxRole(c)
 const rows=[]
 for(const provider of providers){
  const [app,saved]=await Promise.all([appRow(c,provider),one(c,"SELECT m.* FROM cf_mailbox_connections m JOIN oa_operators o ON o.id=m.operator_id AND o.version=m.operator_version AND o.status='active' AND o.role IN('owner','admin') WHERE m.operator_id=? AND m.provider=?",c.actor.id,provider)])
  const connected=!!saved&&saved.app_sealed===app?.sealed
  const domain=c.env?.COFFER_REPLY_DOMAIN
  rows.push({provider,configured:!!app,connected,account:connected?saved!.account:null,callback:callback(c,provider),bcc:connected&&domain?'coffer-bcc+'+saved!.bcc_token+'@'+domain:null})
 }
 return rows
}
export async function connectionCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(!['mailbox.configure','mailbox.start','mailbox.disconnect'].includes(command))return undefined
 mailboxRole(c)
 const provider=providerChoice(p.provider)
 if(command==='mailbox.disconnect'){
  await commit(c,[sql('DELETE FROM cf_mailbox_connections WHERE operator_id=? AND provider=?',c.actor.id,provider),sql('DELETE FROM cf_mailbox_oauth WHERE operator_id=? AND provider=?',c.actor.id,provider),event(c,command,'mailbox',provider,null)])
  return {connected:false}
 }
 if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm personal mailbox access before continuing.',400)
 if(command==='mailbox.configure'){
  const clientId=text(p.clientId,'Client ID',1000),clientSecret=text(p.clientSecret,'Client secret',4000)
  await commit(c,[sql('INSERT INTO cf_giving_connections(name,sealed,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at',appName(provider),await sealGiving(cryptEnv(c),{clientId,clientSecret}),c.now),sql('DELETE FROM cf_mailbox_oauth WHERE provider=?',provider),sql('DELETE FROM cf_mailbox_connections WHERE provider=?',provider),event(c,command,'settings',provider,null)])
  return {configured:true}
 }
 const app=await appRow(c,provider)
 if(!app)fail('MAILBOX_UNCONFIGURED','Configure this mailbox application in Settings first.',409)
 const details=await openGiving(cryptEnv(c),app.sealed),state=newId()+newId(),verifier=base64url(newId()+newId())
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),challenge=btoa(String.fromCharCode(...digest)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
 const operator=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id)
 await commit(c,[sql('INSERT INTO cf_mailbox_oauth VALUES(?,?,?,?,?,?,?) ON CONFLICT(operator_id,provider) DO UPDATE SET operator_version=excluded.operator_version,state_hash=excluded.state_hash,app_sealed=excluded.app_sealed,verifier=excluded.verifier,expires_at=excluded.expires_at',c.actor.id,provider,operator!.version,await sha256(state),app.sealed,verifier,new Date(Date.parse(c.now)+600000).toISOString()),event(c,command,'mailbox',provider,null)])
 const url=new URL(authorizeUrl(provider))
 url.search=new URLSearchParams({client_id:details.clientId,redirect_uri:callback(c,provider),response_type:'code',scope:scopes(provider),state,code_challenge:challenge,code_challenge_method:'S256',...(provider==='gmail'?{access_type:'offline',prompt:'consent'}:{response_mode:'query'})}).toString()
 return {authorizeUrl:url.href,provider}
}
export async function mailboxCallback(c:Context,url:URL,provider:Provider) {
 mailboxRole(c)
 const state=await sha256(text(url.searchParams.get('state'),'Mailbox authorization state',300))
 const pending=await one(c,'SELECT * FROM cf_mailbox_oauth WHERE operator_id=? AND provider=? AND state_hash=?',c.actor.id,provider,state)
 if(!pending)fail('MAILBOX_STATE','This mailbox authorization does not belong to your session. Connect again.',409)
 const checks=[guard("EXISTS(SELECT 1 FROM oa_operators o JOIN cf_giving_connections a ON a.name=? AND a.sealed=? WHERE o.id=? AND o.version=? AND o.status='active' AND o.role IN('owner','admin'))",'MAILBOX_CHANGED','Mailbox authority changed. Connect again.',appName(provider),pending.app_sealed,c.actor.id,pending.operator_version)]
 await commit(c,[...checks,guard('EXISTS(SELECT 1 FROM cf_mailbox_oauth WHERE operator_id=? AND provider=? AND state_hash=? AND expires_at>?)','MAILBOX_STATE','This mailbox authorization expired. Connect again.',c.actor.id,provider,state,c.now),sql('DELETE FROM cf_mailbox_oauth WHERE operator_id=? AND provider=?',c.actor.id,provider)])
 if(url.searchParams.has('error'))fail('MAILBOX_DECLINED','Mailbox access was not granted.',409)
 const app=await openGiving(cryptEnv(c),pending.app_sealed)
 const result=await token(provider,{grant_type:'authorization_code',code:text(url.searchParams.get('code'),'Authorization code',4000),client_id:app.clientId,client_secret:app.clientSecret,redirect_uri:callback(c,provider),code_verifier:pending.verifier})
 if(typeof result.refresh_token!=='string'||!result.refresh_token)fail('MAILBOX_REFRESH','The provider did not grant ongoing personal mailbox access.',409)
 const account=await profile(provider,result.access_token),native=await one(c,'SELECT email FROM oa_operators WHERE id=?',c.actor.id)
 if(account!==native?.email?.toLowerCase())fail('MAILBOX_IDENTITY','Connect the personal mailbox matching your Coffer sign-in address.',409)
 const sealed=await sealGiving(cryptEnv(c),{refreshToken:result.refresh_token})
 await commit(c,[...checks,sql('INSERT INTO cf_mailbox_connections VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(operator_id,provider) DO UPDATE SET operator_version=excluded.operator_version,account=excluded.account,grant_id=excluded.grant_id,app_sealed=excluded.app_sealed,sealed=excluded.sealed,bcc_token=excluded.bcc_token',c.actor.id,provider,pending.operator_version,account,newId(),pending.app_sealed,sealed,newId()),event(c,'mailbox.connected','mailbox',provider,null)])
 return {connected:true}
}
export function connectionGuards(row:Row) {
 return [guard("EXISTS(SELECT 1 FROM cf_mailbox_connections m JOIN oa_operators o ON o.id=m.operator_id AND o.version=m.operator_version AND o.status='active' AND o.role IN('owner','admin') JOIN cf_giving_connections a ON a.name=('mailbox-app:'||m.provider) AND a.sealed=m.app_sealed WHERE m.operator_id=? AND m.provider=? AND m.grant_id=? AND m.sealed=?)",'MAILBOX_CHANGED','The personal mailbox connection changed or was revoked.',row.operator_id,row.provider,row.grant_id,row.sealed)]
}
export async function mailboxAccess(c:Context,p:Provider) {
 mailboxRole(c)
 const row=await one(c,'SELECT * FROM cf_mailbox_connections WHERE operator_id=? AND provider=?',c.actor.id,p)
 if(!row)fail('MAILBOX_UNCONNECTED','Connect your personal mailbox in Settings first.',409)
 await commit(c,connectionGuards(row))
 const app=await openGiving(cryptEnv(c),row.app_sealed),connection=await openGiving(cryptEnv(c),row.sealed)
 const result=await token(p,{grant_type:'refresh_token',refresh_token:connection.refreshToken,client_id:app.clientId,client_secret:app.clientSecret,...(p==='microsoft'?{scope:scopes(p)}:{})})
 if(result.refresh_token&&result.refresh_token!==connection.refreshToken){
  const sealed=await sealGiving(cryptEnv(c),{refreshToken:result.refresh_token})
  await commit(c,[...connectionGuards(row),sql('UPDATE cf_mailbox_connections SET sealed=? WHERE operator_id=? AND provider=?',sealed,c.actor.id,p)])
  row.sealed=sealed
 }
 await commit(c,connectionGuards(row))
 return {row,token:result.access_token as string,checks:connectionGuards(row)}
}
